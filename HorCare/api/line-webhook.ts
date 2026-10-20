import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db, admin } from './_firebase.js';
import { verifyLineSignature, lineReply, buildBillFlex, getLineImageContent } from './_line.js';
import { decodeSlipQR, slipFingerprint, compressSlipToDataUrl, type SlipQR } from './_slip.js';
import { isInvitationToken, redeemInvitation } from './_invitations.js';
import { getTenantLink, recordBotReply, recordInbound } from './_line-inbox.js';
import { findFaqAnswer } from './_chatbot.js';
import { raiseBindingAlert } from './_security-alerts.js';
import { latestAnnouncementsText } from './_announcements.js';
import { evaluateSlip, loadReceiverCandidates } from './_slip-flow.js';
import { billLabel, buildSlipFlex } from './_slip-reply.js';
import { SLIP_WINDOW_MS, isSlipImage, saveMedia } from './_line-media.js';
import { portalLinkFor } from './_portal-link.js';
import type { MonthlyBill } from '../src/types/index.js';

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
    // (The old GET ?lid= lookup is gone: it trusted a LINE user id sent by the browser. The LIFF gateway now proves
    // the LINE account with an access token through /api/portal `liff`.)
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
    const events: LineEvent[] = Array.isArray(body.events) ? body.events : [];

    await Promise.all(events.map(handleEvent));

    res.status(200).send('OK');
}

/** The parts of a LINE webhook event this handler reads. */
interface LineEvent {
    type?: string;
    replyToken?: string;
    source?: { userId?: string };
    message?: { type?: string; id: string; text?: string };
}

async function handleEvent(event: LineEvent) {
    if (event.type !== 'message') return;
    const lineUserId = event.source?.userId;
    const replyToken = event.replyToken;
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

async function dispatchEvent(event: LineEvent, lineUserId: string, replyToken: string) {
    // ── Slip image: tenant sends a payment slip photo ─────────────
    if (event.message?.type === 'image') {
        await handleImage(lineUserId, replyToken, event.message.id);
        return;
    }

    // Voice messages and other files go to the HorCare inbox (never treated as slips).
    if (event.message?.type === 'audio') {
        await handleInboxMedia(lineUserId, replyToken, event.message.id, 'audio');
        return;
    }
    if (event.message?.type === 'video' || event.message?.type === 'file') {
        const kind = event.message.type as 'video' | 'file';
        await recordInbound(lineUserId, { kind, text: kind === 'video' ? '[วิดีโอ]' : '[ไฟล์]', messageId: String(event.message.id) }).catch(() => undefined);
        return;
    }

    // Stickers carry no command but are still part of the conversation in the HorCare inbox.
    if (event.message?.type === 'sticker') {
        await recordInbound(lineUserId, { kind: 'sticker', text: '[สติกเกอร์]' }).catch(() => undefined);
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
        // For the next 30 minutes any photo from this tenant is treated as a slip, even if its QR is unreadable.
        if (isRegistered) {
            await db.collection('line_rooms').doc(lineUserId).update({ slip_expected_until: Date.now() + SLIP_WINDOW_MS });
        }
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

    // ── 2c2. ประกาศ — latest notices from the property (registered tenants only) ──
    if (text === 'ประกาศ') {
        const link = await getTenantLink(lineUserId);
        const msg = link ? await latestAnnouncementsText(link).catch(() => null) : null;
        await lineReply(replyToken, [{ type: 'text', text: link ? (msg ?? 'ตอนนี้ยังไม่มีประกาศค่ะ') : 'กรุณาลงทะเบียนกับหอพักก่อนนะคะ' }]);
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

    // ── 2e. Room invitation: HCI-XXXXXXXXXX (owner-issued, room is bound server-side) ──
    if (isInvitationToken(text)) {
        await handleInvitation(lineUserId, replyToken, text);
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
    // Free text from a registered tenant is a message for the property: it goes to the
    // HorCare inbox, and the tenant gets one short acknowledgement (throttled to once per
    // few hours so a chatty conversation isn't answered by a bot every time).
    const inbound = await recordInbound(lineUserId, { kind: 'text', text }).catch(err => {
        console.error('recordInbound failed:', (err as Error).message);
        return { recorded: false, shouldAck: false };
    });
    if (inbound.recorded) {
        // The owner's own Q&A answers first; anything it can't answer is left for a person.
        const link = await getTenantLink(lineUserId);
        const answer = link ? await findFaqAnswer(link, text).catch(() => null) : null;
        if (answer) {
            await lineReply(replyToken, [{ type: 'text', text: answer }]);
            await recordBotReply(lineUserId, answer).catch(() => undefined);
            return;
        }
        if (inbound.shouldAck) {
            await lineReply(replyToken, [{
                type: 'text',
                text: 'ได้รับข้อความแล้วค่ะ 🙏 เจ้าของหอจะตอบกลับโดยเร็วที่สุด\n\nพิมพ์ "บิล" เพื่อดูบิลล่าสุดได้เลยนะคะ',
            }]);
        }
        return;
    }
    const isRegistered = (await db.collection('line_rooms').doc(lineUserId).get()).exists;
    if (isRegistered) {
        // Registered, but the message couldn't be stored — keep the old helpful reply.
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

async function getOldestUnpaidFine(
    uid: string,
    buildingId: string,
    roomId: string,
): Promise<FirebaseFirestore.QueryDocumentSnapshot | null> {
    const snap = await db
        .collection(`users/${uid}/buildings/${buildingId}/fines`)
        .where('room_id', '==', roomId)
        .get();
    const unpaid = snap.docs
        .filter(d => d.data().status !== 'paid')
        .sort((a, b) => String(a.data().date).localeCompare(String(b.data().date)));
    return unpaid[0] ?? null;
}

/** รับรหัสเชิญรายห้อง (HCI-...) — ห้องถูกกำหนดจากฝั่งเซิร์ฟเวอร์ ผู้เช่าเลือกเองไม่ได้ */
async function handleInvitation(lineUserId: string, replyToken: string, token: string) {
    const r = await redeemInvitation(lineUserId, token);
    if (r.ok) {
        await db.collection('line_pending').doc(lineUserId).delete();
        await lineReply(replyToken, [{
            type: 'text',
            text: `🎉 ลงทะเบียนสำเร็จ!\n\n🏠 หอพัก: ${r.dormName || '-'}\n🚪 ห้อง: ${r.roomNumber}\n\nพิมพ์ "บิล" เพื่อดูบิลล่าสุดได้เลย 💬`,
        }]);
        return;
    }
    const messages: Record<string, string> = {
        not_found: '❌ ไม่พบรหัสเชิญนี้ กรุณาตรวจสอบรหัส หรือขอรหัสใหม่จากเจ้าของหอ',
        expired: '⌛ รหัสเชิญนี้หมดอายุแล้ว กรุณาขอรหัสใหม่จากเจ้าของหอ',
        used: '⚠️ รหัสเชิญนี้ถูกใช้ไปแล้ว กรุณาขอรหัสใหม่จากเจ้าของหอ',
        revoked: '⚠️ รหัสเชิญนี้ถูกยกเลิกแล้ว กรุณาขอรหัสใหม่จากเจ้าของหอ',
        room_unavailable: '⚠️ ห้องนี้ไม่พร้อมใช้งาน กรุณาติดต่อเจ้าของหอ',
        room_taken: '⚠️ ห้องนี้มีผู้ลงทะเบียน LINE ไว้แล้ว กรุณาติดต่อเจ้าของหอ',
    };
    await lineReply(replyToken, [{ type: 'text', text: messages[r.reason] ?? messages.not_found }]);
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

    // Typing a room number is not a safe way to claim a room (wrong/forged numbers).
    // Unless the owner explicitly opted into the legacy flow, require an invitation.
    const cfg = await db.doc(`users/${uid}/buildings/${building_id}/data/config`).get();
    if (cfg.data()?.claim_mode !== 'legacy') {
        await lineReply(replyToken, [{
            type: 'text',
            text: `✅ พบหอพัก: ${dorm_name || dormCode}\n\nหอพักนี้ลงทะเบียนผ่านลิงก์เชิญเฉพาะห้องเท่านั้น\nกรุณาขอ "ลิงก์เชิญ" หรือรหัสเชิญ (HCI-...) จากเจ้าของหอ แล้วกดลิงก์หรือพิมพ์รหัสมาในแชทนี้ค่ะ`,
        }]);
        return;
    }
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

    const prevLink = (await db.collection('line_rooms').doc(lineUserId).get()).data();
    const alreadyBound = existingLineUserId === lineUserId && prevLink?.room_id === roomDoc.id;

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

    if (!alreadyBound) {
        await raiseBindingAlert(uid, building_id, {
            roomId: roomDoc.id, roomNumber: roomNumberInput, lineUserId, via: 'room_number',
            replacedExisting: false,
            movedFromRoomNumber: prevLink && prevLink.room_id !== roomDoc.id ? String(prevLink.room_number ?? '') || null : null,
        });
    }

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
    await lineReply(replyToken, [buildBillFlex(bill as MonthlyBill, dorm_name || '-', due_day ?? 5, bill.month as string)]);
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
    const portalUrl = `${appUrl}/?p=${encodeURIComponent(await portalLinkFor({ ownerUid: uid, buildingId: building_id, roomId: room_id }))}`;

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
                        text: 'ดูบิล · สถานะการชำระ · แจ้งซ่อม · QR โอนเงิน',
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

const MEDIA_ACK_TEXT = 'ได้รับรูปแล้วค่ะ 🙏 เจ้าของหอจะดูและตอบกลับโดยเร็วที่สุด\n\nหากเป็นสลิปโอนเงิน กรุณากดเมนู "ส่งสลิป" แล้วส่งรูปที่เห็น QR ชัดเจนนะคะ';
const VOICE_ACK_TEXT = 'ได้รับข้อความเสียงแล้วค่ะ 🙏 เจ้าของหอจะฟังและตอบกลับโดยเร็วที่สุด';

/** Download a tenant's photo / voice message, keep it in Storage and add it to the inbox. */
async function storeInboxMedia(
    lineUserId: string,
    messageId: string,
    kind: 'image' | 'audio',
    content: { buffer: Buffer; contentType: string },
    caption?: string,
) {
    const link = await getTenantLink(lineUserId);
    if (!link) return { recorded: false, shouldAck: false };
    const saved = await saveMedia({
        ownerUid: link.uid, buildingId: link.building_id, lineUserId, messageId,
        kind, buffer: content.buffer, contentType: content.contentType,
    });
    if (!saved.ok) console.warn('[line-inbox] media not stored:', saved.reason, kind);
    const label = kind === 'image' ? (caption ?? '[รูปภาพ]') : '[ข้อความเสียง]';
    // If the file can't be stored the tenant's message still reaches the owner, as text.
    return recordInbound(lineUserId, {
        kind, text: saved.ok ? label : `${label} (เปิดไฟล์ไม่ได้)`, messageId,
        ...(saved.ok ? { media: saved.media } : {}),
    });
}

/**
 * Photos from a tenant. A payment slip (readable Thai slip QR, or the tenant just pressed
 * "ส่งสลิป") goes through the slip flow exactly as before; any other photo is a chat
 * message for the owner. Both end up in the inbox so the owner sees the whole conversation.
 */
async function handleImage(lineUserId: string, replyToken: string, messageId: string) {
    const link = await getTenantLink(lineUserId);
    if (!link) {
        // Unregistered: keep the old behaviour (asks them to register).
        await handleSlipImage(lineUserId, replyToken, messageId);
        return;
    }
    const img = await getLineImageContent(messageId);
    if (!img) {
        await lineReply(replyToken, [{ type: 'text', text: 'ขออภัยค่ะ โหลดรูปไม่สำเร็จ กรุณาส่งใหม่อีกครั้งนะคะ' }]);
        return;
    }
    const qr = await decodeSlipQR(img.buffer);
    const slip = isSlipImage({ hasQr: !!qr.payload, expectedUntil: link.slip_expected_until });

    const inbound = await storeInboxMedia(lineUserId, messageId, 'image', img, slip ? '[รูปภาพ — สลิปโอนเงิน]' : undefined)
        .catch(err => { console.error('storeInboxMedia failed:', (err as Error).message); return { recorded: false, shouldAck: false }; });

    if (slip) {
        await handleSlipImage(lineUserId, replyToken, messageId, { img, qr });
        return;
    }
    if (inbound.shouldAck) await lineReply(replyToken, [{ type: 'text', text: MEDIA_ACK_TEXT }]);
}

async function handleInboxMedia(lineUserId: string, replyToken: string, messageId: string, kind: 'audio') {
    const link = await getTenantLink(lineUserId);
    if (!link) {
        await lineReply(replyToken, [{ type: 'text', text: 'สวัสดีค่ะ 😊\n\nกดลิ้งก์ที่เจ้าของหอส่งให้เพื่อลงทะเบียนก่อนนะคะ' }]);
        return;
    }
    const content = await getLineImageContent(messageId);
    if (!content) return;
    const inbound = await storeInboxMedia(lineUserId, messageId, kind, content)
        .catch(err => { console.error('storeInboxMedia failed:', (err as Error).message); return { recorded: false, shouldAck: false }; });
    if (inbound.shouldAck) await lineReply(replyToken, [{ type: 'text', text: VOICE_ACK_TEXT }]);
}

/**
 * รับสลิปจากลูกหอ → decode QR กันสลิปซ้ำ (ฟรี ไม่จำกัด) → ตั้งเป็น "รอตรวจสอบ"
 * ให้เจ้าของยืนยันยอดในแอป. สลิปซ้ำ/เคยใช้แล้วจะถูกปฏิเสธทันที.
 */
async function handleSlipImage(
    lineUserId: string,
    replyToken: string,
    messageId: string,
    preloaded?: { img: { buffer: Buffer; contentType: string }; qr: SlipQR },
) {
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
    let targetDoc = billDoc;
    let targetData = bill;
    let isFine = false;

    if (bill.payment_status === 'paid') {
        const fineDoc = await getOldestUnpaidFine(uid, building_id, room_id);
        if (!fineDoc) {
            await lineReply(replyToken, [{
                type: 'text',
                text: `✅ บิลห้อง ${room_number} รอบล่าสุดชำระเรียบร้อยแล้วค่ะ ขอบคุณค่ะ 🙏`,
            }]);
            return;
        }
        targetDoc = fineDoc;
        targetData = fineDoc.data();
        isFine = true;
    }

    // 3. โหลดรูปสลิปจาก LINE
    const img = preloaded?.img ?? await getLineImageContent(messageId);
    if (!img) {
        await lineReply(replyToken, [{
            type: 'text',
            text: 'ขออภัยค่ะ โหลดรูปสลิปไม่สำเร็จ กรุณาส่งใหม่อีกครั้งนะคะ',
        }]);
        return;
    }

    // 4. decode QR ในสลิป (ฟรี ไม่จำกัด)
    const qr = preloaded?.qr ?? await decodeSlipQR(img.buffer);

    // 5. กันสลิปซ้ำ — claim fingerprint แบบ atomic ด้วย create()
    let duplicate = false;
    let fingerprint: string | null = null;
    if (qr.payload) {
        fingerprint = slipFingerprint(qr.payload);
        const refDoc = db.doc(`users/${uid}/buildings/${building_id}/slip_refs/${fingerprint}`);
        try {
            await refDoc.create({
                bill_id: targetDoc.id,
                room_id,
                room_number,
                created_at: admin.firestore.FieldValue.serverTimestamp(),
            });
        } catch (e) {
            const code = (e as { code?: unknown } | null)?.code;
            // ซ้ำจริงเฉพาะ ALREADY_EXISTS (gRPC code 6) — error อื่น (network/quota)
            // ต้อง throw ให้ handler ชั้นนอกตอบ "ระบบขัดข้อง" ไม่ใช่หลอกว่าสลิปซ้ำ
            if (code === 6 || code === 'already-exists') {
                duplicate = true;
            } else {
                throw e;
            }
        }
    }

    // Everything the tenant is told about this slip is one Flex card (api/_slip-reply.ts)
    const dormName: string = (await db.doc(`users/${uid}/buildings/${building_id}/data/config`).get()).data()?.bill_customization?.dorm_name || 'หอพัก';
    const targetLabel = billLabel(targetData.month, isFine);
    const expectedAmount: number = isFine ? targetData.amount : targetData.total_bill;

    if (duplicate) {
        const used = (await db.doc(`users/${uid}/buildings/${building_id}/slip_refs/${fingerprint}`).get()).data() as { room_id?: string; created_at?: { toDate?: () => Date } } | undefined;
        const usedAt = used?.created_at?.toDate?.().toISOString() ?? null;
        await lineReply(replyToken, [buildSlipFlex({
            roomNumber: room_number, dormName, targetLabel, expectedAmount, evaluation: null, qrPresent: true,
            duplicate: { sameRoom: used?.room_id === room_id, usedAt },
        })]);
        return;
    }

    // 6. ย่อ+เก็บภาพสลิปเป็น base64 ใน Firestore (ฟรี ไม่ต้องเปิด Storage) ให้เจ้าของเปิดดูบนเว็บ
    const dataUrl = await compressSlipToDataUrl(img.buffer);
    if (dataUrl) {
        await db.doc(`users/${uid}/buildings/${building_id}/slip_images/${targetDoc.id}`).set({
            data_url: dataUrl,
            room_number,
            bill_id: targetDoc.id,
            created_at: admin.firestore.FieldValue.serverTimestamp(),
        });
    }

    // 7. Auto Slip Verification for Pro Users (Gemini OCR)
    const userSnap = await db.collection('users').doc(uid).get();
    const license = userSnap.data()?.license || 'free';
    // อนุญาตให้ทุกแพ็กเกจที่จ่ายเงิน (small, medium, large) หรือ active ได้ใช้งาน AI 
    const isPro = license === 'active' || !!license.match(/^(monthly|yearly)_(small|medium|large)$/);

    // Read the slip with AI and compare it with the bill and the property's receiving accounts
    // (amount, receiver name / account, date-time). Auto-approval needs every check to hold, and the
    // payment is then recorded as "slip only — not yet confirmed against the bank".
    const slipMatch = dataUrl ? dataUrl.match(/^data:(image\/\w+);base64,(.+)$/) : null;
    const evaluation = await evaluateSlip({
        ownerUid: uid, buildingId: building_id,
        imageBase64: slipMatch ? slipMatch[2] : null, mimeType: slipMatch ? slipMatch[1] : 'image/jpeg',
        qrPayload: qr.payload,
        expectedAmount: isFine ? targetData.amount : targetData.total_bill,
        billCreatedAt: targetData.created_at as string | undefined,
        isPro,
    });
    const autoVerified = evaluation.autoApprove;
    const geminiAmount = evaluation.aiAmount;

    // 8. Pending for the owner to confirm, or "paid" when the slip checks all passed
    const now = new Date().toISOString();
    const qrPassed = !!qr.payload;
    const statusField = isFine ? 'status' : 'payment_status';

    await targetDoc.ref.update({
        [statusField]: autoVerified ? 'paid' : 'pending',
        slip_submitted_at: now,
        ...(autoVerified ? { paid_at: now, payment_date: now.split('T')[0] } : {}),
        ...(dataUrl ? { slip_image: true } : {}),
        ...(fingerprint ? { slip_ref: fingerprint.slice(0, 12) } : {}),
        ...evaluation.fields,
        verify_note: evaluation.verifyNote,
    });
    // paid / wrong amount / wrong account / old slip / needs a look — said right away, in one card
    const { candidates } = await loadReceiverCandidates(uid, building_id);
    await lineReply(replyToken, [buildSlipFlex({
        roomNumber: room_number, dormName, targetLabel, expectedAmount, evaluation, duplicate: null, qrPresent: qrPassed,
        receiverHint: candidates[0] ? `${candidates[0].label}${candidates[0].name ? ` · ${candidates[0].name}` : ''}` : null,
    })]);
    void geminiAmount;

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
