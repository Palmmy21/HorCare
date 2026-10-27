import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db, admin } from './_firebase.js';
import { linePush, buildBillFlex, thaiMonthLabel, runPooled } from './_line.js';
import { invoicePay, loadPayAccount } from './_payment-qr.js';
import { appBaseUrl } from './_notify.js';
import type { BillLanguage, MonthlyBill } from '../src/types/index.js';

/**
 * ทวงบิลอัตโนมัติ (Vercel Cron — ดู vercel.json, รันทุกวัน 09:00 เวลาไทย)
 *
 * สแกนบิลที่บันทึกแล้วแต่ยังไม่จ่ายของเดือนนี้+เดือนก่อน แล้วส่งแจ้งเตือน LINE
 * ให้ลูกหอที่ผูกห้องไว้ ตามจังหวะ:
 *   • 2 วันก่อนครบกำหนด  → เตือนล่วงหน้า
 *   • วันครบกำหนด        → เตือนวันสุดท้าย
 *   • เลยกำหนด           → เตือนซ้ำทุก 3 วัน (เพดานรวม MAX_REMINDERS ครั้ง กันสแปม)
 *
 * ข้ามบิลที่ payment_status เป็น 'paid' (จ่ายแล้ว) และ 'pending' (ส่งสลิปแล้ว
 * รอเจ้าของยืนยัน — ลูกหอทำหน้าที่ของเขาแล้ว ไม่ควรโดนทวง)
 */

const PUSH_CONCURRENCY = 8;
const MAX_REMINDERS = 6;          // เพดานรวมต่อบิล กันทวงไม่รู้จบ
const OVERDUE_EVERY_DAYS = 3;

export const config = { maxDuration: 60 };

function pad(n: number): string { return String(n).padStart(2, '0'); }

/** วันนี้ตามเวลาไทย (cron/serverless รันเป็น UTC) */
function todayICT(): { y: number; m: number; d: number } {
    const t = new Date(Date.now() + 7 * 3600_000);
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

function daysInMonth(y: number, m: number): number {
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // fail closed เหมือน prune-slips — ไม่มี secret = ปฏิเสธทุก request
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers['authorization'] !== `Bearer ${secret}`) {
        res.status(401).send('Unauthorized');
        return;
    }

    const today = todayICT();
    const curMonth = `${today.y}-${pad(today.m)}`;
    const prevMonth = today.m === 1 ? `${today.y - 1}-12` : `${today.y}-${pad(today.m - 1)}`;
    const todayKey = `${today.y}-${pad(today.m)}-${pad(today.d)}`;

    try {
        // ต้องมี composite index แบบ COLLECTION_GROUP (month, is_saved) — ดู firestore.indexes.json
        const snap = await db
            .collectionGroup('bills')
            .where('month', 'in', [prevMonth, curMonth])
            .where('is_saved', '==', true)
            .get();

        // เฉพาะบิลใต้ users/{uid}/buildings/{bid}/bills ที่ยังไม่จ่ายและยังไม่ส่งสลิป
        const candidates = snap.docs.filter(d => {
            const status = d.data().payment_status;
            if (status === 'paid' || status === 'pending') return false;
            const parts = d.ref.path.split('/');
            return parts.length === 6 && parts[0] === 'users' && parts[2] === 'buildings';
        });

        // โหลด config + rooms ครั้งเดียวต่อตึก (ไม่ใช่ต่อบิล)
        const byBuilding = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>();
        for (const d of candidates) {
            const [, uid, , bid] = d.ref.path.split('/');
            const key = `${uid}/${bid}`;
            if (!byBuilding.has(key)) byBuilding.set(key, []);
            byBuilding.get(key)!.push(d);
        }

        let reminded = 0, skipped = 0, failed = 0;

        for (const [key, bills] of byBuilding) {
            const [uid, bid] = key.split('/');
            const base = `users/${uid}/buildings/${bid}`;

            const [cfgSnap, roomsSnap, payAccount] = await Promise.all([
                db.doc(`${base}/data/config`).get(),
                db.collection(`${base}/rooms`).get(),
                loadPayAccount(uid, bid),
            ]);
            const cfg = cfgSnap.data() ?? {};
            const dormName = cfg.bill_customization?.dorm_name || 'หอพัก';
            const dueDay = Number(cfg.bill_customization?.due_day) || 5;
            const lineByRoom = new Map<string, string>();
            const langByRoom = new Map<string, BillLanguage>();
            roomsSnap.docs.forEach(r => {
                const rdata = r.data();
                if (rdata.line_user_id) lineByRoom.set(r.id, rdata.line_user_id);
                if (rdata.language) langByRoom.set(r.id, rdata.language as BillLanguage);
            });

            await runPooled(bills, PUSH_CONCURRENCY, async (billDoc) => {
                const bill = billDoc.data();
                const lineUserId = lineByRoom.get(bill.room_id);
                if (!lineUserId) { skipped++; return; }

                const count = Number(bill.reminder_count) || 0;
                if (count >= MAX_REMINDERS) { skipped++; return; }

                // กันยิงซ้ำวันเดียวกัน (เผื่อ cron ถูก retry)
                const last = bill.last_reminded_at as string | undefined;
                if (last) {
                    const lastICT = new Date(new Date(last).getTime() + 7 * 3600_000);
                    const lastKey = `${lastICT.getUTCFullYear()}-${pad(lastICT.getUTCMonth() + 1)}-${pad(lastICT.getUTCDate())}`;
                    if (lastKey === todayKey) { skipped++; return; }
                }

                // กำหนดชำระ = วันที่ due_day ของเดือนบิล (กันเดือนสั้นด้วย clamp)
                const [by, bm] = String(bill.month).split('-').map(Number);
                const due = Math.min(dueDay, daysInMonth(by, bm));
                const daysUntilDue = Math.round(
                    (Date.UTC(by, bm - 1, due) - Date.UTC(today.y, today.m - 1, today.d)) / 86400000,
                );

                let text: string | null = null;
                const monthThai = thaiMonthLabel(bill.month as string);
                const amount = `฿${Number(bill.total_bill ?? 0).toLocaleString()}`;
                if (daysUntilDue === 2) {
                    text = `🔔 แจ้งเตือนค่ะ บิลห้อง ${bill.room_number} รอบ ${monthThai} ยอด ${amount}\nจะครบกำหนดชำระในอีก 2 วัน (วันที่ ${due})\n\nชำระแล้วส่งสลิปในแชทนี้ได้เลยค่ะ 🙏`;
                } else if (daysUntilDue === 0) {
                    text = `📢 วันนี้ครบกำหนดชำระบิลห้อง ${bill.room_number} รอบ ${monthThai} ยอด ${amount} ค่ะ\n\nชำระแล้วส่งสลิปในแชทนี้ได้เลยนะคะ 🙏`;
                } else if (daysUntilDue < 0 && (-daysUntilDue) % OVERDUE_EVERY_DAYS === 0) {
                    text = `⚠️ บิลห้อง ${bill.room_number} รอบ ${monthThai} เลยกำหนดชำระมา ${-daysUntilDue} วันแล้วค่ะ\nยอดค้างชำระ ${amount}\n\nรบกวนชำระและส่งสลิปในแชทนี้นะคะ 🙏`;
                }
                if (!text) { skipped++; return; }

                const roomLang = langByRoom.get(bill.room_id) || cfg.bill_customization?.default_language || 'th';
                const bilingual = !!cfg.bill_customization?.bilingual_mode;
                const secLang = cfg.bill_customization?.secondary_language || 'en';

                try {
                    await linePush(lineUserId, [
                        { type: 'text', text },
                        buildBillFlex(bill as MonthlyBill, dormName, dueDay, bill.month as string, {
                            lang: roomLang, bilingual, secLang, pay: invoicePay(payAccount, bill.total_bill as number, appBaseUrl()),
                        }),
                    ]);
                    await billDoc.ref.update({
                        last_reminded_at: new Date().toISOString(),
                        reminder_count: admin.firestore.FieldValue.increment(1),
                    });
                    reminded++;
                } catch (err) {
                    failed++;
                    console.error(`remind-bills push failed (${billDoc.ref.path}):`, (err as Error).message);
                }
            });
        }

        console.log(`remind-bills: reminded=${reminded} skipped=${skipped} failed=${failed} candidates=${candidates.length}`);
        res.status(200).json({ ok: true, reminded, skipped, failed });
    } catch (err) {
        console.error('remind-bills failed:', (err as Error).message);
        res.status(500).json({ ok: false, error: (err as Error).message });
    }
}
