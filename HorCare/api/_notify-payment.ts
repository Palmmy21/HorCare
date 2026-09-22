import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db, admin } from './_firebase.js';
import { linePush, buildReceiptFlex } from './_line.js';

// ส่งใบเสร็จรับเงินให้ลูกหอทาง LINE เมื่อเจ้าของกด "ยืนยันจ่าย" ในหน้า Payments.
// เจ้าของยืนยันใน Firestore ฝั่ง client ไปแล้ว — endpoint นี้แค่ push ใบเสร็จ
// (LINE token อยู่ฝั่ง server เท่านั้น). best-effort: ถ้าห้องยังไม่ผูก LINE ก็ข้ามไป.

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
        const decoded = await admin.auth().verifyIdToken(idToken);
        const uid = decoded.uid;

        const bodyData = req.body?.data || req.body || {};
        const { building_id, bill_id } = bodyData;
        if (!building_id || !bill_id) {
            res.status(400).json({ error: 'Missing building_id or bill_id' });
            return;
        }

        // อ่านบิลเพื่อเอาเลขห้อง/ยอด/รอบเดือน — เชื่อข้อมูลใน Firestore ไม่เชื่อ client
        const billSnap = await db.doc(`users/${uid}/buildings/${building_id}/bills/${bill_id}`).get();
        if (!billSnap.exists) {
            res.status(404).json({ error: 'bill not found' });
            return;
        }
        const bill = billSnap.data()!;

        // ห้องที่ผูก LINE ไว้หรือยัง
        const roomSnap = await db.doc(`users/${uid}/buildings/${building_id}/rooms/${bill.room_id}`).get();
        const lineUserId = roomSnap.data()?.line_user_id as string | undefined;
        if (!lineUserId) {
            res.status(200).json({ data: { notified: false, reason: 'no_line_user' } });
            return;
        }

        const cfgSnap = await db.doc(`users/${uid}/buildings/${building_id}/data/config`).get();
        const dormName = cfgSnap.data()?.bill_customization?.dorm_name || 'หอพัก';

        // ใช้เวลาที่เจ้าของกดยืนยัน (paid_at) ถ้ามี — ไม่งั้นใช้เวลาปัจจุบัน
        const paidAt = bill.paid_at ? new Date(bill.paid_at as string) : new Date();
        const roomLang = roomSnap.data()?.language || cfgSnap.data()?.bill_customization?.default_language || 'th';
        const bilingual = !!cfgSnap.data()?.bill_customization?.bilingual_mode;
        const secLang = cfgSnap.data()?.bill_customization?.secondary_language || 'en';
        await linePush(lineUserId, [buildReceiptFlex(bill, dormName, paidAt, { lang: roomLang, bilingual, secLang })]);
        res.status(200).json({ data: { notified: true } });

    } catch (error: any) {
        console.error('notify-payment error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}
