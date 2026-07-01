import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db, admin } from './_firebase.js';
import { buildBillFlex, buildPromptpayMessages, linePush, runPooled } from './_line.js';

async function fcmPushToOwner(uid: string, title: string, body: string) {
    try {
        const fcmDoc = await db.doc(`users/${uid}/data/fcm`).get();
        if (!fcmDoc.exists) return;
        const tokensMap: Record<string, { token: string }> = fcmDoc.data()?.tokens ?? {};
        const tokens = Object.values(tokensMap).map(v => v.token).filter(Boolean);
        if (tokens.length === 0) return;
        await admin.messaging().sendEachForMulticast({
            tokens,
            notification: { title, body },
            webpush: { notification: { icon: '/logo-icon.png', badge: '/logo-icon.png', lang: 'th' }, fcmOptions: { link: '/' } },
        });
    } catch { /* best-effort, don't fail the main operation */ }
}

// หอใหญ่อาจมี 100-200 ห้อง การยิง LINE push พร้อมกันทั้งหมดจะโดน rate-limit (429)
// และเปิด socket จำนวนมากพร้อมกัน — คุมให้ส่งทีละชุดเพื่อให้ scale ถึง 1000 หอได้นิ่ง
const PUSH_CONCURRENCY = 8;

// เผื่อเวลาให้หอใหญ่ส่งครบในครั้งเดียว (ค่า default 10s ของ Vercel ไม่พอสำหรับ 200 ห้อง)
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
        const dueDay         = cfg.bill_customization?.due_day || 5;
        const promptpayNumber = (cfg.bill_customization?.promptpay_number ?? '') as string;
        const promptpayName   = (cfg.bill_customization?.promptpay_name ?? '') as string;
        const appUrl          = (process.env.APP_URL ?? '').replace(/\/$/, '');

        const billsSnap = await db.collection(`users/${uid}/buildings/${building_id}/bills`)
            .where('month', '==', month)
            .where('is_saved', '==', true)
            .get();

        // debug: sample what's actually in Firestore
        const allBillsSnap = await db.collection(`users/${uid}/buildings/${building_id}/bills`).limit(3).get();
        const sampleBills = allBillsSnap.docs.map(d => ({ month: d.data().month, is_saved: d.data().is_saved, room_id: d.data().room_id }));
        console.log(`sendLineBills debug uid=${uid} building=${building_id} queried_month=${month} sample_bills=${JSON.stringify(sampleBills)}`);

        if (billsSnap.empty) {
            res.status(200).json({ data: { sent: 0, skipped: 0, message: `ไม่มีบิลที่บันทึกแล้วในเดือน ${month} (มีบิลทั้งหมด ${allBillsSnap.size} ใบในตัวอย่าง: ${JSON.stringify(sampleBills)})` } });
            return;
        }

        const roomsSnap = await db.collection(`users/${uid}/buildings/${building_id}/rooms`).get();
        const roomsMap = new Map();
        roomsSnap.docs.forEach(doc => roomsMap.set(doc.id, doc.data()));

        let sent = 0;
        let skipped = 0;
        const results: string[] = [];

        await runPooled(billsSnap.docs, PUSH_CONCURRENCY, async (billDoc) => {
            const bill = billDoc.data();
            const roomData = roomsMap.get(bill.room_id);
            const lineUserId = roomData?.line_user_id as string | undefined;

            if (!lineUserId) {
                skipped++;
                results.push(`⏭ ห้อง ${bill.room_number} (ยังไม่ลงทะเบียน LINE)`);
                return;
            }

            try {
                const portalUrl = appUrl
                    ? `${appUrl}/?uid=${uid}&bid=${building_id}&rid=${bill.room_id}`
                    : undefined;
                const messages: object[] = [buildBillFlex(bill, dormName, dueDay, month, { portalUrl })];
                if (promptpayNumber) {
                    messages.push(...buildPromptpayMessages(promptpayNumber, promptpayName, bill.total_bill as number));
                }
                await linePush(lineUserId, messages);
                await billDoc.ref.update({ is_notified: true });
                sent++;
                results.push(`✅ ห้อง ${bill.room_number}`);
            } catch (err: any) {
                results.push(`❌ ห้อง ${bill.room_number}: ${err.message}`);
            }
        });

        console.log(`sendLineBills uid=${uid} building=${building_id} month=${month} sent=${sent} skipped=${skipped}`);

        if (sent > 0) {
            await fcmPushToOwner(
                uid,
                `✅ ส่งบิลสำเร็จ ${sent} ห้อง`,
                `เดือน ${month} · ข้ามไป ${skipped} ห้อง (ยังไม่ลงทะเบียน LINE)`,
            );
        }

        res.status(200).json({ data: { sent, skipped, results } });

    } catch (error: any) {
        console.error('Send bills error:', error);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
}
