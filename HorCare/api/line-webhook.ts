import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db, admin } from './_firebase.js';
import { verifyLineSignature, lineReply, buildBillFlex, getLineImageContent } from './_line.js';
import { decodeSlipQR, slipFingerprint, compressSlipToDataUrl } from './_slip.js';

export const config = {
    api: {
        bodyParser: false,
    },
    // decode QR + บีบอัดรูปสลิป (Jimp) อาจใช้เวลาหลายวินาทีตอน cold start —
    // เผื่อเวลาไว้ไม่ให้ webhook timeout แล้ว LINE retry ซ้ำ (กันสลิปเด้งซ้ำ)
    maxDuration: 30,
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
    // GET /api/line-webhook?lid=... — tenant portal lookup (used by TenantGateway)
    if (req.method === 'GET') {
        const lid = String(req.query.lid ?? '').trim();
        // LINE user IDs are always "U" followed by 32 hex characters
        if (!lid || !/^U[0-9a-f]{32}$/.test(lid)) {
            return res.status(400).json({ error: 'bad_request' });
        }
        const snap = await db.collection('line_rooms').doc(lid).get();
        if (!snap.exists) {
            return res.status(404).json({ error: 'not_found' });
        }
        const { uid, building_id, room_id, room_number, dorm_name } = snap.data()!;
        return res.status(200).json({ uid, building_id, room_id, room_number, dorm_name });
    }

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
    if (event.type !== 'message') return;
    const lineUserId: string = event.source?.userId;
    const replyToken: string = event.replyToken;
    if (!lineUserId || !replyToken) return;

    // กันทั้ง webhook ล้มเพราะ event เดียว — log แล้วตอบข้อความสุภาพแทนการเงียบหาย
    try {
        await dispatchEvent(event, lineUserId, replyToken);
    } catch (err) {
        console.error('LINE event handler failed:', (err as Error).message, err);
        try {
            await lineReply(replyToken, [{
                type: 'text',
                text: 'ขออภัยค่ะ ระบบขัดข้องชั่วคราว 🙏 กรุณาลองใหม่อีกครั้งในอีกสักครู่นะคะ',
            }]);
        } catch { /* reply token อาจหมดอายุ — ปล่อยผ่าน */ }
    }
}

async function dispatchEvent(event: any, lineUserId: string, replyToken: string) {
    // ── Slip image: tenant sends a payment slip photo ─────────────
    if (event.message?.type === 'image') {
        await handleSlipImage(lineUserId, replyToken, event.message.id);
        return;
    }

    if (event.message?.type !== 'text') return;
    const text: string = event.message.text?.trim() ?? '';

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

    // ── 2b. Rich Menu — ส่งสลิป ──────────────────────────────────
    if (text === 'ส่งสลิป') {
        const isRegistered = (await db.collection('line_rooms').doc(lineUserId).get()).exists;
        await lineReply(replyToken, [{
            type: 'text',
            text: isRegistered
                ? '📷 กรุณาถ่ายรูปสลิปการโอนเงิน แล้วส่งมาในแชทนี้ได้เลยค่ะ\n\n(ส่งรูปได้โดยตรง ไม่ต้องพิมพ์ข้อความ)'
                : '🏠 ยังไม่ได้ลงทะเบียนค่ะ\n\nกดลิ้งก์ที่เจ้าของหอส่งให้เพื่อลงทะเบียนก่อนนะคะ',
        }]);
        return;
    }

    // ── 2c. Rich Menu — พอร์ทัล ──────────────────────────────────
    if (text === 'พอร์ทัล' || text.toLowerCase() === 'portal') {
        await handlePortalCommand(lineUserId, replyToken);
        return;
    }

    // ── 2d. Rich Menu — ติดต่อแอดมิน ──────────────────────────────
    if (text === 'ติดต่อแอดมิน') {
        await lineReply(replyToken, [{
            type: 'text',
            text: '📞 ติดต่อทีมงาน HorCare\n\n💬 LINE Official: @060iuutx\n⏰ เวลาทำการ: จ-ศ 9:00–18:00 น.\n\nหากมีปัญหาการใช้งานหรือต้องการความช่วยเหลือ พิมพ์มาได้เลยค่ะ เราพร้อมช่วยเสมอ 🙏',
        }]);
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

/**
 * หาบิลล่าสุดที่ "บันทึกแล้ว" ของห้อง.
 *
 * จงใจ query ด้วย field เดียว (room_id) แล้วกรอง is_saved + เรียง month ใน memory
 * แทนการใช้ .where('is_saved').orderBy('month') ซึ่งต้องมี composite index —
 * ถ้า index ยังไม่ถูก deploy บน Firebase, query นั้นจะ throw และลูกหอจะพิมพ์ "บิล"
 * แล้วไม่ได้อะไรกลับเลย. ห้องหนึ่งมีบิลไม่กี่สิบรอบ การเรียงใน memory จึงถูกและชัวร์.
 */
async function getLatestSavedBill(
    uid: string,
    buildingId: string,
    roomId: string,
): Promise<FirebaseFirestore.QueryDocumentSnapshot | null> {
    const snap = await db
        .collection(`users/${uid}/buildings/${buildingId}/bills`)
        .where('room_id', '==', roomId)
        .get();
    const saved = snap.docs
        .filter(d => d.data().is_saved === true)
        .sort((a, b) => String(b.data().month).localeCompare(String(a.data().month)));
    return saved[0] ?? null;
}

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

    // ── ป้องกันการแย่งห้อง — ถ้าห้องมีคนลงทะเบียนอยู่แล้ว ปฏิเสธ ────
    if (existingLineUserId && existingLineUserId !== lineUserId) {
        await db.collection('line_pending').doc(lineUserId).delete();
        await lineReply(replyToken, [{
            type: 'text',
            text: `⚠️ ห้อง ${roomNumberInput} มีผู้ลงทะเบียน LINE ไว้แล้วค่ะ\n\nกรุณาติดต่อเจ้าของหอเพื่อยกเลิกการลงทะเบียนเก่าก่อนนะคะ`,
        }]);
        return;
    }

    const batch = db.batch();

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

    const billDoc = await getLatestSavedBill(uid, building_id, room_id);

    if (!billDoc) {
        await lineReply(replyToken, [{
            type: 'text',
            text: `📋 ยังไม่มีบิลสำหรับห้อง ${room_number} ค่ะ\nรอเจ้าของหอออกบิลประจำเดือนได้เลย`,
        }]);
        return;
    }

    const bill = billDoc.data();
    await lineReply(replyToken, [buildBillFlex(bill, dorm_name || '-', due_day ?? 5, bill.month as string)]);
}

/** ส่งลิงก์พอร์ทัลส่วนตัวของลูกหอ */
async function handlePortalCommand(lineUserId: string, replyToken: string) {
    const lineRoomSnap = await db.collection('line_rooms').doc(lineUserId).get();
    if (!lineRoomSnap.exists) {
        await lineReply(replyToken, [{
            type: 'text',
            text: '🏠 ยังไม่ได้ลงทะเบียนค่ะ\n\nกดลิ้งก์ที่เจ้าของหอส่งให้เพื่อลงทะเบียนก่อนนะคะ',
        }]);
        return;
    }

    const { uid, building_id, room_id, room_number, dorm_name } = lineRoomSnap.data()!;
    const appUrl = (process.env.APP_URL ?? '').replace(/\/$/, '');
    const portalUrl = `${appUrl}/?uid=${uid}&bid=${building_id}&rid=${room_id}`;

    await lineReply(replyToken, [{
        type: 'flex',
        altText: `🏠 พอร์ทัลผู้เช่า ห้อง ${room_number}`,
        contents: {
            type: 'bubble',
            size: 'kilo',
            header: {
                type: 'box',
                layout: 'vertical',
                paddingAll: '16px',
                backgroundColor: '#4F46E5',
                contents: [
                    { type: 'text', text: '🏠 พอร์ทัลผู้เช่า', color: '#ffffff', size: 'sm', weight: 'bold' },
                    { type: 'text', text: dorm_name || 'HorCare', color: '#ffffffcc', size: 'xs' },
                ],
            },
            body: {
                type: 'box',
                layout: 'vertical',
                spacing: 'sm',
                paddingAll: '16px',
                contents: [
                    {
                        type: 'box', layout: 'horizontal',
                        contents: [
                            { type: 'text', text: 'ห้อง', color: '#888888', size: 'sm', flex: 2 },
                            { type: 'text', text: room_number, size: 'sm', weight: 'bold', flex: 3, align: 'end' },
                        ],
                    },
                    { type: 'separator', margin: 'md' },
                    {
                        type: 'text',
                        text: 'ดูบิล · สถานะการชำระ · แจ้งซ่อม · QR PromptPay',
                        size: 'xs',
                        color: '#888888',
                        margin: 'md',
                        wrap: true,
                    },
                ],
            },
            footer: {
                type: 'box',
                layout: 'vertical',
                paddingAll: '12px',
                contents: [{
                    type: 'button',
                    action: { type: 'uri', label: '🔗 เปิดพอร์ทัล', uri: portalUrl },
                    style: 'primary',
                    color: '#4F46E5',
                    height: 'sm',
                }],
            },
        },
    }]);
}

/**
 * รับสลิปจากลูกหอ → decode QR กันสลิปซ้ำ (ฟรี ไม่จำกัด) → ตั้งเป็น "รอตรวจสอบ"
 * ให้เจ้าของยืนยันยอดในแอป. สลิปซ้ำ/เคยใช้แล้วจะถูกปฏิเสธทันที.
 */
async function handleSlipImage(lineUserId: string, replyToken: string, messageId: string) {
    // 1. ต้องลงทะเบียนก่อน
    const lineRoomSnap = await db.collection('line_rooms').doc(lineUserId).get();
    if (!lineRoomSnap.exists) {
        await lineReply(replyToken, [{
            type: 'text',
            text: '🏠 ยังไม่ได้ลงทะเบียนค่ะ\n\nกดลิ้งก์ที่เจ้าของหอส่งให้เพื่อลงทะเบียนก่อนส่งสลิปนะคะ',
        }]);
        return;
    }
    const { uid, building_id, room_id, room_number } = lineRoomSnap.data()!;

    // 2. หาบิลล่าสุดของห้อง
    const billDoc = await getLatestSavedBill(uid, building_id, room_id);

    if (!billDoc) {
        await lineReply(replyToken, [{
            type: 'text',
            text: `📋 ยังไม่มีบิลสำหรับห้อง ${room_number} ค่ะ\nรอเจ้าของหอออกบิลก่อนนะคะ`,
        }]);
        return;
    }

    const bill = billDoc.data();

    if (bill.payment_status === 'paid') {
        await lineReply(replyToken, [{
            type: 'text',
            text: `✅ บิลห้อง ${room_number} รอบล่าสุดชำระเรียบร้อยแล้วค่ะ ขอบคุณค่ะ 🙏`,
        }]);
        return;
    }

    // 3. โหลดรูปสลิปจาก LINE
    const img = await getLineImageContent(messageId);
    if (!img) {
        await lineReply(replyToken, [{
            type: 'text',
            text: 'ขออภัยค่ะ โหลดรูปสลิปไม่สำเร็จ กรุณาส่งใหม่อีกครั้งนะคะ',
        }]);
        return;
    }

    // 4. decode QR ในสลิป (ฟรี ไม่จำกัด)
    const qr = await decodeSlipQR(img.buffer);

    // 5. กันสลิปซ้ำ — claim fingerprint แบบ atomic ด้วย create()
    let duplicate = false;
    let fingerprint: string | null = null;
    if (qr.payload) {
        fingerprint = slipFingerprint(qr.payload);
        const refDoc = db.doc(`users/${uid}/buildings/${building_id}/slip_refs/${fingerprint}`);
        try {
            await refDoc.create({
                bill_id: billDoc.id,
                room_id,
                room_number,
                created_at: admin.firestore.FieldValue.serverTimestamp(),
            });
        } catch (e: any) {
            // ซ้ำจริงเฉพาะ ALREADY_EXISTS (gRPC code 6) — error อื่น (network/quota)
            // ต้อง throw ให้ handler ชั้นนอกตอบ "ระบบขัดข้อง" ไม่ใช่หลอกว่าสลิปซ้ำ
            if (e?.code === 6 || e?.code === 'already-exists') {
                duplicate = true;
            } else {
                throw e;
            }
        }
    }

    if (duplicate) {
        await lineReply(replyToken, [{
            type: 'text',
            text: `⚠️ สลิปนี้ถูกใช้ไปแล้วค่ะ\n\nหากเพิ่งโอนสำหรับห้อง ${room_number} กรุณาส่ง "สลิปจริงของรอบนี้" นะคะ`,
        }]);
        return;
    }

    // 6. ย่อ+เก็บภาพสลิปเป็น base64 ใน Firestore (ฟรี ไม่ต้องเปิด Storage) ให้เจ้าของเปิดดูบนเว็บ
    const dataUrl = await compressSlipToDataUrl(img.buffer);
    if (dataUrl) {
        await db.doc(`users/${uid}/buildings/${building_id}/slip_images/${billDoc.id}`).set({
            data_url: dataUrl,
            room_number,
            bill_id: billDoc.id,
            created_at: admin.firestore.FieldValue.serverTimestamp(),
        });
    }

    // 7. Auto Slip Verification for Pro Users (Gemini OCR)
    let autoVerified = false;
    let geminiAmount: number | null = null;
    
    const userSnap = await db.collection('users').doc(uid).get();
    const license = userSnap.data()?.license || 'free';
    const isPro = license === 'active' || !!license.match(/^(monthly|yearly)_large$/);

    if (isPro && dataUrl && !duplicate && qr.payload) {
        try {
            const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
            if (match) {
                const mimeType = match[1];
                const base64 = match[2];
                const apiKey = process.env.GEMINI_API_KEY;
                if (apiKey) {
                    const model = 'gemini-2.5-flash-preview-05-20';
                    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
                    
                    const prompt = `ดึงตัวเลข "จำนวนเงินที่โอน" จากสลิปโอนเงินนี้ (ไม่ต้องรวมค่าธรรมเนียม)
ตอบเป็น JSON เท่านั้น:
{
  "amount": <ตัวเลขทศนิยม เช่น 1500.00 หรือ null ถ้าอ่านไม่ได้>
}`;
                    const body = {
                        contents: [{
                            parts: [
                                { text: prompt },
                                { inline_data: { mime_type: mimeType, data: base64 } },
                            ],
                        }],
                        generationConfig: {
                            temperature: 0,
                            responseMimeType: 'application/json',
                        },
                    };

                    const resp = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body),
                    });

                    if (resp.ok) {
                        const data = await resp.json() as any;
                        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
                        try {
                            const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
                            const parsed = JSON.parse(cleanJson);
                            geminiAmount = parsed.amount;
                            if (typeof geminiAmount === 'number' && geminiAmount === bill.total_bill) {
                                autoVerified = true;
                            }
                        } catch (e) {
                            console.error('Parse Gemini slip error:', e);
                        }
                    }
                }
            }
        } catch (err) {
            console.error('Slip auto-verification failed:', err);
        }
    }

    // 8. ตั้งเป็น "รอตรวจสอบ" ให้เจ้าของยืนยันยอด หรือ "จ่ายแล้ว" (ถ้าออโต้ผ่าน)
    const now = new Date().toISOString();
    const qrPassed = !!qr.payload;

    await billDoc.ref.update({
        payment_status: autoVerified ? 'paid' : 'pending',
        slip_submitted_at: now,
        ...(autoVerified ? { payment_date: now.split('T')[0] } : {}),
        ...(dataUrl ? { slip_image: true } : {}),
        ...(fingerprint ? { slip_ref: fingerprint.slice(0, 12) } : {}),
        ...(geminiAmount !== null ? { slip_ai_amount: geminiAmount } : {}),
        verify_note: autoVerified 
            ? 'อนุมัติอัตโนมัติด้วย AI (ยอดเงินตรง)'
            : qrPassed
                ? 'ตรวจ QR ผ่าน (ไม่ซ้ำ) — รอเจ้าของยืนยันยอด'
                : 'อ่าน QR ไม่ได้ — โปรดตรวจสลิปด้วยตา',
    });

    if (autoVerified) {
        await lineReply(replyToken, [{
            type: 'text',
            text: `✨ ได้รับยอดชำระ ${geminiAmount} บาท เรียบร้อยแล้วค่ะ ✅\n\nบิลของห้อง ${room_number} ถูกอัปเดตสถานะเป็น "จ่ายแล้ว" โดยอัตโนมัติ ขอบคุณค่ะ 🙏`,
        }]);
    } else {
        await lineReply(replyToken, [{
            type: 'text',
            text: qrPassed
                ? `📨 รับสลิปห้อง ${room_number} แล้วค่ะ\n\n✅ ตรวจ QR ผ่าน (ไม่ซ้ำ)\nเจ้าของหอจะยืนยันยอดให้อีกครั้งค่ะ 🙏`
                : `📨 รับสลิปห้อง ${room_number} แล้วค่ะ\n\n⏳ ระบบอ่าน QR ไม่ชัด เจ้าของหอจะตรวจสอบให้นะคะ\n(ถ้าเป็นไปได้ ส่งภาพสลิปที่ชัดขึ้นจะตรวจไวกว่าค่ะ)`,
        }]);
    }

    // แจ้งเจ้าของหอผ่าน FCM (best-effort)
    try {
        const fcmDoc = await db.doc(`users/${uid}/data/fcm`).get();
        const tokensMap: Record<string, { token: string }> = fcmDoc.data()?.tokens ?? {};
        const tokens = Object.values(tokensMap).map(v => v.token).filter(Boolean);
        if (tokens.length > 0) {
            await admin.messaging().sendEachForMulticast({
                tokens,
                notification: {
                    title: `💳 สลิปใหม่ ห้อง ${room_number}`,
                    body: qrPassed ? 'ตรวจ QR ผ่านแล้ว — กรุณายืนยันยอด' : 'รอตรวจสอบ — กรุณาดูสลิป',
                },
                webpush: { notification: { icon: '/logo-icon.png', badge: '/logo-icon.png', lang: 'th' }, fcmOptions: { link: '/' } },
            });
        }
    } catch { /* best-effort */ }
}
