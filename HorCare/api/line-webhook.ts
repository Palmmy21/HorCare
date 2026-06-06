import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db, admin } from './_firebase';
import { verifyLineSignature, lineReply, buildBillFlex } from './_line';

export const config = {
    api: {
        bodyParser: false,
    },
};

async function getRawBody(req: VercelRequest): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks);
}

/** HC-XXXXXX pattern (6 alphanumeric chars after HC-) */
const DORM_CODE_RE = /^HC-[A-Z0-9]{6}$/;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    const secret = process.env.LINE_CHANNEL_SECRET;
    if (!secret) {
        res.status(500).send('LINE_CHANNEL_SECRET not set');
        return;
    }

    const sig = req.headers['x-line-signature'] as string;
    const rawBodyBuffer = await getRawBody(req);
    const rawBodyString = rawBodyBuffer.toString('utf8');

    if (!verifyLineSignature(rawBodyBuffer, secret, sig)) {
        res.status(401).send('Invalid signature');
        return;
    }

    const body = JSON.parse(rawBodyString);
    const events: any[] = body.events ?? [];

    await Promise.all(events.map(handleEvent));

    res.status(200).send('OK');
}

async function handleEvent(event: any) {
    if (event.type !== 'message' || event.message?.type !== 'text') return;
    const lineUserId: string = event.source?.userId;
    const text: string = event.message.text?.trim() ?? '';
    const replyToken: string = event.replyToken;
    if (!lineUserId || !replyToken) return;

    // ── 1. บิล / ดูบิล ────────────────────────────────────────────
    if (['บิล', 'ดูบิล', 'bill'].includes(text.toLowerCase())) {
        await handleBillCommand(lineUserId, replyToken);
        return;
    }

    // ── 2. ยกเลิก ──────────────────────────────────────────────────
    if (['ยกเลิก', 'cancel'].includes(text.toLowerCase())) {
        await db.collection('line_pending').doc(lineUserId).delete();
        await lineReply(replyToken, [{ type: 'text', text: 'ยกเลิกแล้วค่ะ 👋\n\nพิมพ์ "บิล" เพื่อดูบิลล่าสุด หรือกดลิ้งก์จากเจ้าของหอเพื่อลงทะเบียน' }]);
        return;
    }

    // ── 3. Invite Link: HC-XXXXXX pattern ─────────────────────────
    //    ลูกหอกดลิ้งก์ → LINE pre-fills รหัสหอ → กด Send
    if (DORM_CODE_RE.test(text.toUpperCase())) {
        await handleDormCode(lineUserId, replyToken, text.toUpperCase());
        return;
    }

    // ── 4. ลงทะเบียน (manual flow — fallback) ─────────────────────
    if (text === 'ลงทะเบียน' || text.toLowerCase() === 'register') {
        await db.collection('line_pending').doc(lineUserId).set({
            step: 'waiting_dorm_code',
            expires_at: admin.firestore.Timestamp.fromMillis(Date.now() + 10 * 60 * 1000),
        });
        await lineReply(replyToken, [{
            type: 'text',
            text: '🏠 ยินดีต้อนรับสู่ HorCare!\n\nกรุณาพิมพ์รหัสหอพักที่ได้รับจากเจ้าของหอ\n(เช่น HC-K7MN2P)\n\nหรือพิมพ์ "ยกเลิก" เพื่อออก',
        }]);
        return;
    }

    // ── 5. ตรวจ pending session ────────────────────────────────────
    const pendingSnap = await db.collection('line_pending').doc(lineUserId).get();
    if (pendingSnap.exists) {
        const pending = pendingSnap.data()!;

        // Step 1: รอรหัสหอ (manual flow)
        if (pending.step === 'waiting_dorm_code') {
            await handleDormCode(lineUserId, replyToken, text.toUpperCase());
            return;
        }

        // Step 2: รอเลขห้อง
        if (pending.step === 'waiting_room_number') {
            await handleRoomNumber(lineUserId, replyToken, text, pending);
            return;
        }
    }

    // ── 6. Default ─────────────────────────────────────────────────
    const isRegistered = (await db.collection('line_rooms').doc(lineUserId).get()).exists;
    if (isRegistered) {
        await lineReply(replyToken, [{
            type: 'text',
            text: 'สวัสดีค่ะ 😊\n\nพิมพ์ "บิล" เพื่อดูบิลล่าสุด',
        }]);
    } else {
        await lineReply(replyToken, [{
            type: 'text',
            text: 'สวัสดีค่ะ 😊\n\nกดลิ้งก์ที่เจ้าของหอส่งให้เพื่อลงทะเบียนรับบิลค่ะ\nหรือพิมพ์ "ลงทะเบียน" เพื่อใส่รหัสหอด้วยตนเอง',
        }]);
    }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/** รับรหัสหอ HC-XXXXXX แล้วย้ายไป step รอเลขห้อง */
async function handleDormCode(lineUserId: string, replyToken: string, dormCode: string) {
    const codeSnap = await db.collection('dorm_codes').doc(dormCode).get();
    if (!codeSnap.exists) {
        await lineReply(replyToken, [{
            type: 'text',
            text: '❌ ไม่พบรหัสหอพักนี้ กรุณาติดต่อเจ้าของหอ\n\nหรือพิมพ์ "ยกเลิก" เพื่อออก',
        }]);
        return;
    }
    const { uid, building_id, dorm_name, due_day } = codeSnap.data()!;
    await db.collection('line_pending').doc(lineUserId).set({
        step: 'waiting_room_number',
        dorm_code: dormCode,
        uid, building_id, dorm_name, due_day,
        expires_at: admin.firestore.Timestamp.fromMillis(Date.now() + 10 * 60 * 1000),
    });
    await lineReply(replyToken, [{
        type: 'text',
        text: `✅ พบหอพัก: ${dorm_name || dormCode}\n\nกรุณาพิมพ์เลขห้องของคุณ (เช่น 101, A02)\n\nหรือพิมพ์ "ยกเลิก" เพื่อออก`,
    }]);
}

/** รับเลขห้อง บันทึกการลงทะเบียน (overwrite คนเก่าอัตโนมัติ) */
async function handleRoomNumber(
    lineUserId: string,
    replyToken: string,
    roomNumberInput: string,
    pending: FirebaseFirestore.DocumentData,
) {
    const { uid, building_id, dorm_name, due_day } = pending;

    const roomsSnap = await db
        .collection(`users/${uid}/buildings/${building_id}/rooms`)
        .where('room_number', '==', roomNumberInput)
        .where('is_active', '==', true)
        .limit(1)
        .get();

    if (roomsSnap.empty) {
        await lineReply(replyToken, [{
            type: 'text',
            text: `❌ ไม่พบห้อง "${roomNumberInput}" กรุณาตรวจสอบเลขห้องแล้วลองใหม่\n\nหรือพิมพ์ "ยกเลิก" เพื่อออก`,
        }]);
        return;
    }

    const roomDoc = roomsSnap.docs[0];
    const existingLineUserId = roomDoc.data().line_user_id as string | undefined;

    const batch = db.batch();

    // ── ลบการลงทะเบียนเก่า (ถ้ามีคนอื่นอยู่ในห้องนี้แล้ว) ────────
    // ยึดคนล่าสุดเสมอ — คนเก่าจะไม่ได้รับบิลอีกต่อไป
    if (existingLineUserId && existingLineUserId !== lineUserId) {
        batch.delete(db.collection('line_rooms').doc(existingLineUserId));
        // Clear line_user_id ออกจาก room ด้วย (จะถูก overwrite ทันที)
    }

    // ── บันทึกการลงทะเบียนใหม่ ────────────────────────────────────
    batch.update(roomDoc.ref, { line_user_id: lineUserId });
    batch.set(db.collection('line_rooms').doc(lineUserId), {
        uid,
        building_id,
        room_id: roomDoc.id,
        room_number: roomNumberInput,
        dorm_name,
        due_day,
        registered_at: admin.firestore.FieldValue.serverTimestamp(),
    });
    batch.delete(db.collection('line_pending').doc(lineUserId));

    await batch.commit();

    await lineReply(replyToken, [{
        type: 'text',
        text: `🎉 ลงทะเบียนสำเร็จ!\n\n🏠 หอพัก: ${dorm_name || '-'}\n🚪 ห้อง: ${roomNumberInput}\n\nเดือนนี้เจ้าของหอจะส่งบิลค่าน้ำ-ไฟมาให้ทาง LINE ค่ะ\n\nพิมพ์ "บิล" เพื่อดูบิลล่าสุดได้เลย 💬`,
    }]);
}

/** ดูบิลล่าสุดของห้องที่ลงทะเบียน */
async function handleBillCommand(lineUserId: string, replyToken: string) {
    const lineRoomSnap = await db.collection('line_rooms').doc(lineUserId).get();
    if (!lineRoomSnap.exists) {
        await lineReply(replyToken, [{
            type: 'text',
            text: '🏠 ยังไม่ได้ลงทะเบียนค่ะ\n\nกดลิ้งก์ที่เจ้าของหอส่งให้ แล้วพิมพ์เลขห้องของคุณได้เลย\nหรือพิมพ์ "ลงทะเบียน" เพื่อใส่รหัสเอง',
        }]);
        return;
    }

    const { uid, building_id, room_id, room_number, dorm_name, due_day } = lineRoomSnap.data()!;

    const billsSnap = await db
        .collection(`users/${uid}/buildings/${building_id}/bills`)
        .where('room_id', '==', room_id)
        .where('is_saved', '==', true)
        .orderBy('month', 'desc')
        .limit(1)
        .get();

    if (billsSnap.empty) {
        await lineReply(replyToken, [{
            type: 'text',
            text: `📋 ยังไม่มีบิลสำหรับห้อง ${room_number} ค่ะ\nรอเจ้าของหอออกบิลประจำเดือนได้เลย`,
        }]);
        return;
    }

    const bill = billsSnap.docs[0].data();
    await lineReply(replyToken, [buildBillFlex(bill, dorm_name || '-', due_day ?? 5, bill.month as string)]);
}
