import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db, admin } from './_firebase.js';
import { buildBillFlex, buildPromptpayMessages, linePush, runPooled, thaiMonthLabel } from './_line.js';

const PUSH_CONCURRENCY = 8;
export const config = { maxDuration: 60 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');
    
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            res.status(401).json({ error: 'unauthenticated' });
            return;
        }

        const idToken = authHeader.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const uid = decodedToken.uid;

        const bodyData = req.body?.data || req.body || {};
        const { building_id, month } = bodyData;
        
        if (!building_id || !month) {
            res.status(400).json({ error: 'Missing building_id or month' });
            return;
        }

        const configSnap = await db.doc(`users/${uid}/buildings/${building_id}/data/config`).get();
        const cfg = configSnap.data() ?? {};
        const dormName       = cfg.bill_customization?.dorm_name || 'หอพัก';
        const dueDay         = Number(cfg.bill_customization?.due_day) || 5;
        const promptpayNumber = (cfg.bill_customization?.promptpay_number ?? '') as string;
        const promptpayName   = (cfg.bill_customization?.promptpay_name ?? '') as string;
        let appUrl = (process.env.APP_URL ?? '').replace(/\/$/, '');
        if (appUrl && !appUrl.startsWith('http')) appUrl = `https://${appUrl}`;

        const [allBillsSnap, roomsSnap] = await Promise.all([
            db.collection(`users/${uid}/buildings/${building_id}/bills`).get(),
            db.collection(`users/${uid}/buildings/${building_id}/rooms`).get(),
        ]);

        const billDocs = allBillsSnap.docs.filter(d => {
            const data = d.data();
            return String(data.month) === String(month) && data.is_saved === true && data.payment_status !== 'paid' && data.payment_status !== 'pending';
        });

        console.log(`remindManualBills uid=${uid} building=${building_id} month=${month} total_bills=${allBillsSnap.size} unpaid_matched=${billDocs.length}`);

        if (billDocs.length === 0) {
            res.status(200).json({ data: { sent: 0, skipped: 0, message: 'ไม่มีบิลที่ค้างชำระในเดือนนี้' } });
            return;
        }

        const roomsMap = new Map();
        roomsSnap.docs.forEach(doc => roomsMap.set(doc.id, doc.data()));

        let sent = 0;
        let skipped = 0;
        const results: string[] = [];

        await runPooled(billDocs, PUSH_CONCURRENCY, async (billDoc: FirebaseFirestore.QueryDocumentSnapshot) => {
            const bill = billDoc.data();
            const roomData = roomsMap.get(bill.room_id);
            const lineUserId = roomData?.line_user_id as string | undefined;

            if (!lineUserId) {
                skipped++;
                results.push(`⏭ ห้อง ${bill.room_number} (ยังไม่ลงทะเบียน LINE)`);
                return;
            }

            try {
                const monthThai = thaiMonthLabel(bill.month as string);
                const amount = `฿${Number(bill.total_bill ?? 0).toLocaleString()}`;
                
                // For manual reminder, we just send a gentle overdue/reminder message regardless of days until due
                const text = `⚠️ แจ้งเตือนยอดค้างชำระ\nบิลห้อง ${bill.room_number} รอบ ${monthThai}\nยอดค้างชำระ ${amount}\n\nรบกวนชำระและส่งสลิปในแชทนี้นะคะ 🙏`;

                const portalUrl = appUrl
                    ? `${appUrl}/?uid=${uid}&bid=${building_id}&rid=${bill.room_id}`
                    : undefined;
                
                const roomLang = roomData?.language || cfg.bill_customization?.default_language || 'th';
                const bilingual = !!cfg.bill_customization?.bilingual_mode;
                const secLang = cfg.bill_customization?.secondary_language || 'en';

                const messages: object[] = [
                    { type: 'text', text },
                    buildBillFlex(bill, dormName, dueDay, month, { portalUrl, lang: roomLang, bilingual, secLang })
                ];
                
                if (promptpayNumber) {
                    messages.push(...buildPromptpayMessages(promptpayNumber, promptpayName, bill.total_bill as number, roomLang));
                }

                await linePush(lineUserId, messages);
                
                await billDoc.ref.update({ 
                    last_reminded_at: new Date().toISOString(),
                    reminder_count: admin.firestore.FieldValue.increment(1),
                    is_notified: true 
                });
                
                sent++;
                results.push(`✅ ห้อง ${bill.room_number}`);
            } catch (err: any) {
                results.push(`❌ ห้อง ${bill.room_number}: ${err.message}`);
            }
        });

        res.status(200).json({ data: { sent, skipped, results } });

    } catch (error: any) {
        console.error('Manual remind error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}
