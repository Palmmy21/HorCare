import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db, admin } from './_firebase.js';
import { effectiveLicense } from '../src/shared/trial.js';
import { isPaidPlan } from '../src/shared/plans.js';
import { verifyLineSignature, lineReply, buildBillFlex, getLineImageContent, getLineContent, parseSplitModePostback, currentLineChannel, currentTeamSecret, channelAllowsOwner, isLineFriend } from './_line.js';
import { decodeSlipQR, slipFingerprint, compressSlipToDataUrl, type SlipQR } from './_slip.js';
import { isInvitationToken, redeemInvitation } from './_invitations.js';
import { isRoomCode, scanRoomCode } from './_room-qr.js';
import { propertyOaId } from './_line-oa.js';
import { linkedRooms, recordFriendship } from './_line-binding.js';
import { roomNumbersText, roomsOfLink, sameRoom, type BindMode, type LinkedRoom } from '../src/shared/lineRooms.js';
import { readSlipDetails } from './_slip-ai.js';
import { getTenantLink, recordBotReply, recordInbound } from './_line-inbox.js';
import { findFaqAnswer } from './_chatbot.js';
import { raiseBindingAlert } from './_security-alerts.js';
import { latestAnnouncementsText } from './_announcements.js';
import { evaluateSlip } from './_slip-flow.js';
import { portalLinkFor } from './_portal-link.js';
import { buildSlipResultFlex, buildSplitPaidFlex, parseSplitPostback, splitPostbackData } from './_slip-flex.js';
import { applySlipSplit, outstandingSatang, recordSlipPayment } from './_slip-payment.js';
import type { PaidItem } from './_accounting-data.js';
import { formatMonthLabel } from './_translations.js';
import { MAX_MEDIA_BYTES, MAX_VIDEO_BYTES, SLIP_WINDOW_MS, fileContentType, isSlipImage, saveMedia } from './_line-media.js';
import { fileSizeText, type LineMessage, type MessageKind } from '../src/shared/messages.js';
import type { MonthlyBill } from '../src/types/index.js';
import { autoPostSafe } from './_ledger-auto.js';
import { invoicePay, loadPayAccount } from './_payment-qr.js';
import { appBaseUrl } from './_notify.js';
import { GUEST_QUICK, TENANT_QUICK, ackText, botText, botVocab, helpText, notRegisteredText, parseTenantCommand, welcomeText } from '../src/shared/tenantBot.js';

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
    // (The old GET ?lid= lookup is gone: even view-only, it gave out a room for a LINE user id typed into a browser.
    // The LIFF gateway now proves the LINE account with an access token through /api/portal `liff`.)

    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    // the vendor OA (/api/line-market-webhook) runs this same handler with its own channel secret
    const market = currentLineChannel() === 'market';
    const secret = currentTeamSecret() ?? (market ? process.env.LINE_MARKET_CHANNEL_SECRET : process.env.LINE_CHANNEL_SECRET);
    if (!secret) {
        res.status(500).send(market ? 'LINE_MARKET_CHANNEL_SECRET not set' : 'LINE_CHANNEL_SECRET not set');
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
    message?: {
        type?: string; id: string; text?: string;
        /** audio / video */
        duration?: number;
        /** file */
        fileName?: string; fileSize?: number;
        /** location */
        title?: string; address?: string; latitude?: number; longitude?: number;
        /** sticker */
        packageId?: string; stickerId?: string;
    };
    postback?: { data?: string };
}

async function handleEvent(event: LineEvent) {
    if (event.type === 'follow' || event.type === 'unfollow') {
        if (event.source?.userId) await recordFriendship(event.source.userId, event.type === 'follow');
        if (event.type === 'follow' && event.source?.userId && event.replyToken) {
            try {
                const link = (await db.collection('line_rooms').doc(event.source.userId).get()).data() ?? null;
                const mine = roomsOfLink(link);
                const shown = link && mine.length > 1 ? { ...link, room_number: roomNumbersText(mine) } : link;
                await lineReply(event.replyToken, [botText(welcomeText(shown, isMarket()), link ? TENANT_QUICK : GUEST_QUICK)]);
            } catch (err) {
                console.error('LINE welcome failed:', (err as Error).message);
            }
        }
        return;
    }
    if (event.type !== 'message' && event.type !== 'postback') return;
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

/** The vendor OA words its replies for a market (ตลาด / แผง), the others for a dorm. */
const isMarket = () => currentLineChannel() === 'market';

async function dispatchEvent(event: LineEvent, lineUserId: string, replyToken: string) {
    // ── "แบ่งจ่าย" buttons: on an invoice (split mode) or on a slip card ─────────────
    if (event.type === 'postback') {
        const modeReq = parseSplitModePostback(event.postback?.data);
        const slipRoom = parseSlipRoomPostback(event.postback?.data);
        if (slipRoom) await handleSlipRoomChoice(lineUserId, replyToken, slipRoom);
        else if (modeReq) await handleSplitMode(lineUserId, replyToken, modeReq);
        else await handleSplitPostback(lineUserId, replyToken, event.postback?.data);
        return;
    }

    // ── Slip image: tenant sends a payment slip photo ─────────────
    if (event.message?.type === 'image') {
        await handleImage(lineUserId, replyToken, event.message.id);
        return;
    }

    // Voice messages, videos, documents, places and stickers are conversation: they go to the HorCare inbox, each in
    // a form the owner can open (never treated as slips). Someone not registered is told how to register instead.
    const type = event.message?.type;
    if (type === 'audio' || type === 'video' || type === 'file' || type === 'location' || type === 'sticker') {
        if (!(await getTenantLink(lineUserId))) {
            if (type !== 'sticker') await lineReply(replyToken, [botText(notRegisteredText(isMarket()), GUEST_QUICK)]);
            return;
        }
        const m = event.message!;
        if (type === 'audio') await handleInboxAudio(lineUserId, replyToken, m.id, m.duration);
        else if (type === 'video') await handleInboxVideo(lineUserId, replyToken, m.id, m.duration);
        else if (type === 'file') await handleInboxFile(lineUserId, replyToken, m.id, m.fileName, m.fileSize);
        else if (type === 'location') await handleInboxLocation(lineUserId, replyToken, m);
        else {
            // a sticker carries no command, but the owner sees which one it was
            const sticker = m.packageId && m.stickerId ? { package_id: String(m.packageId), sticker_id: String(m.stickerId) } : undefined;
            await recordInbound(lineUserId, { kind: 'sticker', text: '[สติกเกอร์]', ...(sticker ? { extra: { sticker } } : {}) }).catch(() => undefined);
        }
        return;
    }

    if (event.message?.type !== 'text') return;
    const text: string = event.message.text?.trim() ?? '';

    // What the message asks for, tolerant of spacing, case and polite particles ("ขอดูบิลหน่อยครับ" = บิล).
    const cmd = parseTenantCommand(text);
    const market = isMarket();

    // ── 1. บิล / ดูบิล ────────────────────────────────────────────
    if (cmd === 'bill') {
        await handleBillCommand(lineUserId, replyToken);
        return;
    }

    // ── 2. ยกเลิก ──────────────────────────────────────────────────
    if (cmd === 'cancel') {
        await db.collection('line_pending').doc(lineUserId).delete();
        const registered = (await db.collection('line_rooms').doc(lineUserId).get()).exists;
        await lineReply(replyToken, [botText(
            registered ? 'ยกเลิกแล้วค่ะ 👋\n\nพิมพ์ "บิล" เพื่อดูบิลล่าสุดได้เลย' : `ยกเลิกแล้วค่ะ 👋\n\nเมื่อพร้อม สแกน QR หรือกดลิงก์จาก${botVocab(market).owner}เพื่อลงทะเบียนได้เลย`,
            registered ? TENANT_QUICK : GUEST_QUICK,
        )]);
        return;
    }

    // ── 2b. Rich Menu — ส่งสลิป ──────────────────────────────────
    if (cmd === 'slip') {
        const isRegistered = (await db.collection('line_rooms').doc(lineUserId).get()).exists;
        // For the next 30 minutes any photo from this tenant is treated as a slip, even if its QR is unreadable.
        if (isRegistered) {
            await db.collection('line_rooms').doc(lineUserId).update({ slip_expected_until: Date.now() + SLIP_WINDOW_MS });
        }
        await lineReply(replyToken, [isRegistered
            ? botText('📷 กรุณาถ่ายรูปสลิปการโอนเงิน แล้วส่งมาในแชทนี้ได้เลยค่ะ\n\n(ส่งรูปได้โดยตรง ไม่ต้องพิมพ์ข้อความ)')
            : botText(notRegisteredText(market), GUEST_QUICK)]);
        return;
    }

    // ── 2c. Rich Menu — พอร์ทัล ──────────────────────────────────
    if (cmd === 'portal') {
        await handlePortalCommand(lineUserId, replyToken);
        return;
    }

    // ── 2c2. ประกาศ — latest notices from the property (registered tenants only) ──
    if (cmd === 'announcements') {
        const link = await getTenantLink(lineUserId);
        const msg = link ? await latestAnnouncementsText(link).catch(() => null) : null;
        await lineReply(replyToken, [link
            ? botText(msg ?? 'ตอนนี้ยังไม่มีประกาศค่ะ', TENANT_QUICK)
            : botText(notRegisteredText(market), GUEST_QUICK)]);
        return;
    }
    // ── 2d. Rich Menu — ติดต่อแอดมิน ──────────────────────────────
    if (cmd === 'contact') {
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

    // ── 2f. A room's permanent QR: HCR-XXXXXXXXXX ──
    if (isRoomCode(text)) {
        await handleRoomCode(lineUserId, replyToken, text);
        return;
    }

    // ── 3. Invite Link: HC-XXXXXX pattern ─────────────────────────
    //    ลูกหอกดลิ้งก์ → LINE pre-fills รหัสหอ → กด Send
    if (DORM_CODE_RE.test(text.toUpperCase())) {
        await handleDormCode(lineUserId, replyToken, text.toUpperCase());
        return;
    }

    // ── 4. ลงทะเบียน (manual flow — fallback) ─────────────────────
    if (cmd === 'register') {
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

    // ── 4b. เมนู / แจ้งซ่อม: the owner's own Q&A answer wins when it has one ──
    if (cmd === 'help' || cmd === 'repair') {
        const link = await getTenantLink(lineUserId);
        if (link && await answerFromFaq(lineUserId, replyToken, link, text)) return;
        if (cmd === 'repair' && link) {
            await handlePortalCommand(lineUserId, replyToken, '🔧 แจ้งซ่อมได้ในพอร์ทัลค่ะ กดปุ่มด้านล่าง แล้วเลือกหัวข้อ "แจ้งซ่อม"');
            return;
        }
        await lineReply(replyToken, [botText(helpText(!!link, market), link ? TENANT_QUICK : GUEST_QUICK)]);
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

        // Already has a room and sent the code of another: are they moving, or taking one more?
        if (pending.step === 'choose_bind' && typeof pending.code === 'string') {
            if (Number(pending.until ?? 0) < Date.now()) {
                await pendingSnap.ref.delete();
            } else {
                const mode: BindMode | null = text === BIND_ADD ? 'add' : text === BIND_MOVE ? 'move' : null;
                if (!mode) {
                    await lineReply(replyToken, [botText(`กรุณาเลือก "${BIND_ADD}" หรือ "${BIND_MOVE}" ค่ะ (หรือพิมพ์ "ยกเลิก")`, [BIND_ADD, BIND_MOVE, 'ยกเลิก'])]);
                    return;
                }
                if (pending.kind === 'invite') await handleInvitation(lineUserId, replyToken, pending.code, mode);
                else await handleRoomCode(lineUserId, replyToken, pending.code, mode);
                return;
            }
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
        if (inbound.shouldAck) await lineReply(replyToken, [botText(ackText(market), TENANT_QUICK)]);
        return;
    }
    const isRegistered = (await db.collection('line_rooms').doc(lineUserId).get()).exists;
    if (isRegistered) {
        // Registered, but the message couldn't be stored: say what the chat can do.
        await lineReply(replyToken, [botText(helpText(true, market), TENANT_QUICK)]);
    } else {
        await lineReply(replyToken, [botText(notRegisteredText(market), GUEST_QUICK)]);
    }
}

/**
 * A soft command (เมนู, แจ้งซ่อม) the property has its own Q&A answer for: store the question in the inbox and send that
 * answer, exactly as ordinary conversation is handled. False when there is no such answer.
 */
async function answerFromFaq(lineUserId: string, replyToken: string, link: { uid: string; building_id: string }, text: string): Promise<boolean> {
    const answer = await findFaqAnswer(link, text).catch(() => null);
    if (!answer) return false;
    await recordInbound(lineUserId, { kind: 'text', text }).catch(() => undefined);
    await lineReply(replyToken, [{ type: 'text', text: answer }]);
    await recordBotReply(lineUserId, answer).catch(() => undefined);
    return true;
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
/** The welcome message. The chat link does not require adding the OA, but bills are pushed: catch a non-friend now, not at billing. */
const BIND_ADD = 'เพิ่มห้อง';
const BIND_MOVE = 'ย้ายห้อง';

/** Someone with a room sent the code of another: keep the code for ten minutes and ask what they mean by it. */
async function askMoveOrAdd(lineUserId: string, replyToken: string, kind: 'room' | 'invite', code: string, roomNumber: string, current: string[]) {
    await db.collection('line_pending').doc(lineUserId).set({ step: 'choose_bind', kind, code, until: Date.now() + 10 * 60 * 1000 });
    const mine = current.join(', ');
    await lineReply(replyToken, [botText(
        `คุณลงทะเบียนห้อง ${mine} ไว้แล้วค่ะ ต้องการทำอย่างไรกับห้อง ${roomNumber}?\n\n` +
        `• ${BIND_ADD} — ดูแลทั้งห้อง ${mine} และ ${roomNumber} บิลของทุกห้องส่งมาที่แชทนี้\n` +
        `• ${BIND_MOVE} — เลิกห้อง ${mine} แล้วใช้ห้อง ${roomNumber} แทน`,
        [BIND_ADD, BIND_MOVE, 'ยกเลิก'],
    )]);
}

async function replyRegistered(lineUserId: string, replyToken: string, dormName: string, roomNumber: string, kept: string[] = []) {
    await db.collection('line_pending').doc(lineUserId).delete();
    const friend = await isLineFriend(lineUserId);
    if (friend !== null) await recordFriendship(lineUserId, friend);
    const link = (await db.collection('line_rooms').doc(lineUserId).get()).data();
    const oaId = link ? await propertyOaId(link.uid, link.building_id) : undefined;
    const addFriend = friend === false
        ? `\n\n⚠️ ขั้นตอนสุดท้าย: กดเพิ่มเพื่อนบัญชีนี้ ไม่อย่างนั้นบิลจะส่งมาไม่ถึงค่ะ${oaId ? `\nhttps://line.me/R/ti/p/${encodeURIComponent(oaId)}` : ''}`
        : '';
    await lineReply(replyToken, [{
        type: 'text',
        text: kept.length > 0
            ? `🎉 เพิ่มห้อง ${roomNumber} สำเร็จ!\n\n🏠 ${dormName || '-'}\n🚪 LINE นี้ดูแลห้อง ${roomNumbersText([...kept, roomNumber].map(n => ({ room_number: n })))}\n\nบิลของทุกห้องจะส่งมาที่แชทนี้ พิมพ์ "บิล" เพื่อดูได้เลย 💬${addFriend}`
            : `🎉 ลงทะเบียนสำเร็จ!\n\n🏠 หอพัก: ${dormName || '-'}\n🚪 ห้อง: ${roomNumber}\n\nพิมพ์ "บิล" เพื่อดูบิลล่าสุดได้เลย 💬${addFriend}`,
    }]);
}

async function handleRoomCode(lineUserId: string, replyToken: string, code: string, mode?: BindMode) {
    const r = await scanRoomCode(lineUserId, code, mode);
    if (r.outcome === 'bound') { await replyRegistered(lineUserId, replyToken, r.dormName, r.roomNumber); return; }
    if (r.outcome === 'choose') { await askMoveOrAdd(lineUserId, replyToken, 'room', code, r.roomNumber, r.currentRoomNumbers); return; }
    await db.collection('line_pending').doc(lineUserId).delete();
    const room = 'roomNumber' in r ? r.roomNumber : '';
    const adding = (r.outcome === 'requested' || r.outcome === 'already_requested') && r.adding;
    const text = {
        already_yours: `✅ คุณลงทะเบียนห้อง ${room} ไว้แล้วค่ะ\n\nพิมพ์ "บิล" เพื่อดูบิลล่าสุดได้เลย 💬`,
        requested: adding
            ? `📝 ส่งคำขอเพิ่มห้อง ${room} ให้แอดมินแล้วค่ะ\n\nเมื่ออนุมัติแล้วจะแจ้งในแชทนี้ ระหว่างนี้ห้องเดิมของคุณใช้งานได้ตามปกติ`
            : `📝 ห้อง ${room} มีผู้ลงทะเบียนอยู่แล้ว ระบบส่งคำขอให้แอดมินแล้วค่ะ\n\nเมื่ออนุมัติแล้วจะแจ้งในแชทนี้`,
        already_requested: `⏳ คำขอลงทะเบียนห้อง ${room} กำลังรอแอดมินอนุมัติอยู่ค่ะ`,
        too_many_rooms: '⚠️ LINE นี้ลงทะเบียนไว้หลายห้องเต็มจำนวนแล้ว กรุณาติดต่อเจ้าของหอค่ะ',
        choose: '',
        recently_rejected: `⚠️ คำขอลงทะเบียนห้อง ${room} ไม่ได้รับการอนุมัติ กรุณาติดต่อเจ้าของหอค่ะ`,
        too_many_requests: `⚠️ ห้อง ${room} มีคำขอรออนุมัติหลายรายการ กรุณาติดต่อเจ้าของหอค่ะ`,
        room_unavailable: '⚠️ ห้องนี้ไม่พร้อมใช้งาน กรุณาติดต่อเจ้าของหอ',
        invalid: '❌ QR นี้ใช้ไม่ได้แล้ว กรุณาขอใบใหม่จากเจ้าของหอ',
    }[r.outcome];
    await lineReply(replyToken, [{ type: 'text', text }]);
}

async function handleInvitation(lineUserId: string, replyToken: string, token: string, mode?: BindMode) {
    const r = await redeemInvitation(lineUserId, token, mode);
    if (r.ok) {
        await replyRegistered(lineUserId, replyToken, r.dormName, r.roomNumber, r.keptRoomNumbers);
        return;
    }
    if (r.reason === 'choose') { await askMoveOrAdd(lineUserId, replyToken, 'invite', token, r.roomNumber, r.currentRoomNumbers); return; }
    await db.collection('line_pending').doc(lineUserId).delete();
    const messages: Record<string, string> = {
        not_found: '❌ ไม่พบรหัสเชิญนี้ กรุณาตรวจสอบรหัส หรือขอรหัสใหม่จากเจ้าของหอ',
        expired: '⌛ รหัสเชิญนี้หมดอายุแล้ว กรุณาขอรหัสใหม่จากเจ้าของหอ',
        used: '⚠️ รหัสเชิญนี้ถูกใช้ไปแล้ว กรุณาขอรหัสใหม่จากเจ้าของหอ',
        revoked: '⚠️ รหัสเชิญนี้ถูกยกเลิกแล้ว กรุณาขอรหัสใหม่จากเจ้าของหอ',
        room_unavailable: '⚠️ ห้องนี้ไม่พร้อมใช้งาน กรุณาติดต่อเจ้าของหอ',
        room_taken: '⚠️ ห้องนี้มีผู้ลงทะเบียน LINE ไว้แล้ว กรุณาติดต่อเจ้าของหอ',
        too_many_rooms: '⚠️ LINE นี้ลงทะเบียนไว้หลายห้องเต็มจำนวนแล้ว กรุณาติดต่อเจ้าของหอค่ะ',
    };
    await lineReply(replyToken, [{ type: 'text', text: messages[r.reason] ?? messages.not_found }]);
}

/** รับรหัสหอ HC-XXXXXX แล้วย้ายไป step รอเลขห้อง */
async function handleDormCode(lineUserId: string, replyToken: string, dormCode: string) {
    const codeSnap = await db.collection('dorm_codes').doc(dormCode).get();
    if (!codeSnap.exists || !channelAllowsOwner(codeSnap.data()!.uid)) {
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
    // typing a room number replaces the registration: not something to do to an account that holds several rooms
    if (roomsOfLink(prevLink).length > 1) {
        await db.collection('line_pending').doc(lineUserId).delete();
        await lineReply(replyToken, [{ type: 'text', text: '⚠️ LINE นี้ลงทะเบียนไว้หลายห้องแล้วค่ะ หากต้องการเพิ่มหรือเปลี่ยนห้อง กรุณาขอลิงก์เชิญจากเจ้าของหอ' }]);
        return;
    }
    const alreadyBound = existingLineUserId === lineUserId && prevLink?.room_id === roomDoc.id;

    const batch = db.batch();

    // ── บันทึกการลงทะเบียนใหม่ ────────────────────────────────────
    batch.update(roomDoc.ref, { line_user_id: lineUserId, line_channel: currentLineChannel() });
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
        await lineReply(replyToken, [botText(notRegisteredText(isMarket()), GUEST_QUICK)]);
        return;
    }

    const mine = await linkedRooms(lineUserId);
    if (mine.length > 1) { await replyBillsOfRooms(replyToken, mine); return; }

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
    const pay = invoicePay(await loadPayAccount(uid, building_id), bill.total_bill as number, appBaseUrl());
    await lineReply(replyToken, [buildBillFlex(bill as MonthlyBill, dorm_name || '-', due_day ?? 5, bill.month as string, { pay })]);
}

/** LINE takes five messages in a reply: up to four bill cards, then a line about whatever did not fit. */
const MAX_BILL_CARDS = 4;

/** The latest bill of every room one LINE account looks after, unpaid ones first. */
async function replyBillsOfRooms(replyToken: string, rooms: LinkedRoom[]) {
    const accounts = new Map<string, Awaited<ReturnType<typeof loadPayAccount>>>();
    const cards: { card: object; paid: boolean; room: string }[] = [];
    const noBill: string[] = [];
    for (const r of rooms) {
        const billDoc = await getLatestSavedBill(r.uid, r.building_id, r.room_id);
        if (!billDoc) { noBill.push(r.room_number); continue; }
        const bill = billDoc.data();
        const key = `${r.uid}/${r.building_id}`;
        if (!accounts.has(key)) accounts.set(key, await loadPayAccount(r.uid, r.building_id));
        const pay = invoicePay(accounts.get(key)!, bill.total_bill as number, appBaseUrl());
        cards.push({
            card: buildBillFlex(bill as MonthlyBill, r.dorm_name || '-', r.due_day ?? 5, bill.month as string, { pay }),
            paid: bill.payment_status === 'paid', room: r.room_number,
        });
    }
    cards.sort((a, b) => Number(a.paid) - Number(b.paid));
    const shown = cards.slice(0, MAX_BILL_CARDS);
    const rest = cards.slice(MAX_BILL_CARDS);
    const notes: string[] = [];
    if (shown.length > 0) notes.push(`📋 บิลล่าสุดของห้อง ${roomNumbersText(shown.map(c => ({ room_number: c.room })))} (ห้องละ 1 ใบ โอนแยกทีละห้องนะคะ)`);
    if (rest.length > 0) notes.push(`ยังมีบิลของห้อง ${roomNumbersText(rest.map(c => ({ room_number: c.room })))} พิมพ์ "พอร์ทัล" แล้วเลือกห้องเพื่อดูได้ค่ะ`);
    if (noBill.length > 0) notes.push(`ห้อง ${roomNumbersText(noBill.map(n => ({ room_number: n })))} ยังไม่มีบิลค่ะ`);
    await lineReply(replyToken, [botText(notes.join('\n\n')), ...shown.map(c => c.card)]);
}

/** One button per room, for an account that looks after several. */
async function replyPortalChoice(replyToken: string, rooms: LinkedRoom[], intro?: string) {
    const appUrl = (process.env.APP_URL ?? '').replace(/\/$/, '');
    const unit = botVocab(isMarket()).unit;
    const buttons = await Promise.all(rooms.slice(0, 10).map(async r => ({
        type: 'button', style: 'primary', color: '#0A6CC2', height: 'sm', margin: 'sm',
        action: {
            type: 'uri', label: `${unit} ${r.room_number}`.slice(0, 20),
            uri: `${appUrl}/?p=${encodeURIComponent(await portalLinkFor({ ownerUid: r.uid, buildingId: r.building_id, roomId: r.room_id }))}`,
        },
    })));
    await lineReply(replyToken, [...(intro ? [botText(intro)] : []), {
        type: 'flex',
        altText: `🏠 พอร์ทัลผู้เช่า ${unit} ${roomNumbersText(rooms)}`,
        contents: {
            type: 'bubble', size: 'kilo',
            header: {
                type: 'box', layout: 'vertical', paddingAll: '16px', backgroundColor: '#0A6CC2',
                contents: [
                    { type: 'text', text: '🏠 พอร์ทัลผู้เช่า', color: '#ffffff', size: 'sm', weight: 'bold' },
                    { type: 'text', text: `เลือก${unit}ที่ต้องการเปิด`, color: '#ffffffcc', size: 'xs' },
                ],
            },
            body: { type: 'box', layout: 'vertical', paddingAll: '12px', contents: buttons },
        },
    }]);
}

/** ส่งลิงก์พอร์ทัลส่วนตัวของลูกหอ */
async function handlePortalCommand(lineUserId: string, replyToken: string, intro?: string) {
    const lineRoomSnap = await db.collection('line_rooms').doc(lineUserId).get();
    if (!lineRoomSnap.exists) {
        await lineReply(replyToken, [botText(notRegisteredText(isMarket()), GUEST_QUICK)]);
        return;
    }

    const mine = await linkedRooms(lineUserId);
    if (mine.length > 1) { await replyPortalChoice(replyToken, mine, intro); return; }

    const { uid, building_id, room_id, room_number, dorm_name } = lineRoomSnap.data()!;
    const appUrl = (process.env.APP_URL ?? '').replace(/\/$/, '');
    const portalUrl = `${appUrl}/?p=${encodeURIComponent(await portalLinkFor({ ownerUid: uid, buildingId: building_id, roomId: room_id }))}`;

    await lineReply(replyToken, [...(intro ? [botText(intro)] : []), {
        type: 'flex',
        altText: `🏠 พอร์ทัลผู้เช่า ${botVocab(isMarket()).unit} ${room_number}`,
        contents: {
            type: 'bubble',
            size: 'kilo',
            header: {
                type: 'box',
                layout: 'vertical',
                paddingAll: '16px',
                backgroundColor: '#0A6CC2',
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
                            { type: 'text', text: botVocab(isMarket()).unit, color: '#888888', size: 'sm', flex: 2 },
                            { type: 'text', text: String(room_number), size: 'sm', weight: 'bold', flex: 3, align: 'end' },
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
                    color: '#0A6CC2',
                    height: 'sm',
                }],
            },
        },
    }]);
}

const MEDIA_ACK_TEXT = 'ได้รับรูปแล้วค่ะ 🙏 เจ้าของหอจะดูและตอบกลับโดยเร็วที่สุด\n\nหากเป็นสลิปโอนเงิน กรุณากดเมนู "ส่งสลิป" แล้วส่งรูปที่เห็น QR ชัดเจนนะคะ';
const VOICE_ACK_TEXT = 'ได้รับข้อความเสียงแล้วค่ะ 🙏 เจ้าของหอจะฟังและตอบกลับโดยเร็วที่สุด';

const KIND_LABEL: Partial<Record<MessageKind, string>> = { image: '[รูปภาพ]', audio: '[ข้อความเสียง]', video: '[วิดีโอ]', file: '[ไฟล์]' };
const NOT_STORED = { recorded: false, shouldAck: false };
const logStoreFailure = (err: unknown) => { console.error('storeInboxMedia failed:', (err as Error).message); return NOT_STORED; };

/** Keep a file a tenant sent (photo, voice message, short video, document) and add it to the inbox. */
async function storeInboxMedia(
    lineUserId: string,
    messageId: string,
    kind: 'image' | 'audio' | 'video' | 'file',
    content: { buffer: Buffer; contentType: string },
    caption?: string,
    extra?: Pick<LineMessage, 'file_name' | 'duration_ms'>,
) {
    const link = await getTenantLink(lineUserId);
    if (!link) return NOT_STORED;
    const saved = await saveMedia({
        ownerUid: link.uid, buildingId: link.building_id, lineUserId, messageId,
        kind, buffer: content.buffer, contentType: content.contentType, fileName: extra?.file_name,
    });
    if (!saved.ok) console.warn('[line-inbox] media not stored:', saved.reason, kind);
    const label = caption ?? KIND_LABEL[kind] ?? '[ไฟล์]';
    // If the file can't be stored the tenant's message still reaches the owner, as text.
    return recordInbound(lineUserId, {
        kind, text: saved.ok ? label : `${label} (เปิดไฟล์ไม่ได้)`, messageId,
        ...(saved.ok ? { media: saved.media } : {}),
        ...(extra ? { extra } : {}),
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
        .catch(logStoreFailure);

    if (slip) {
        await handleSlipImage(lineUserId, replyToken, messageId, { img, qr });
        return;
    }
    if (inbound.shouldAck) await lineReply(replyToken, [{ type: 'text', text: MEDIA_ACK_TEXT }]);
}

// The handlers below are only reached for a registered tenant (dispatchEvent checks first).

async function handleInboxAudio(lineUserId: string, replyToken: string, messageId: string, duration?: number) {
    const content = await getLineImageContent(messageId);
    if (!content) return;
    const inbound = await storeInboxMedia(lineUserId, messageId, 'audio', content, undefined, duration ? { duration_ms: duration } : undefined).catch(logStoreFailure);
    if (inbound.shouldAck) await lineReply(replyToken, [{ type: 'text', text: VOICE_ACK_TEXT }]);
}

const ownerWord = () => botVocab(isMarket()).owner;

/**
 * A video. A short clip is kept and plays in the inbox. A long one cannot be (files live in the database, with a hard
 * size limit): the owner gets LINE's still picture of it and its size, and the tenant is told, so nobody waits for an
 * answer to a video that was never seen.
 */
async function handleInboxVideo(lineUserId: string, replyToken: string, messageId: string, duration?: number) {
    const extra = duration ? { duration_ms: duration } : undefined;
    const content = await getLineContent(messageId, MAX_VIDEO_BYTES);
    if (content.status === 'ok') {
        const inbound = await storeInboxMedia(lineUserId, messageId, 'video', content, undefined, extra).catch(logStoreFailure);
        if (inbound.shouldAck) await lineReply(replyToken, [botText(`ได้รับวิดีโอแล้วค่ะ 🙏 ${ownerWord()}จะดูและตอบกลับโดยเร็วที่สุด`)]);
        return;
    }
    if (content.status === 'unavailable') {
        await recordInbound(lineUserId, { kind: 'video', text: '[วิดีโอ] (เปิดไฟล์ไม่ได้)', messageId, ...(extra ? { extra } : {}) }).catch(() => undefined);
        await lineReply(replyToken, [botText('ขออภัยค่ะ โหลดวิดีโอไม่สำเร็จ กรุณาส่งใหม่อีกครั้งนะคะ')]);
        return;
    }
    // too large: keep the still picture so the owner at least sees what it is about
    const label = `[วิดีโอ ${fileSizeText(content.size)} — ใหญ่เกินกว่าจะเก็บ แสดงเฉพาะภาพตัวอย่าง]`;
    const still = await getLineContent(messageId, MAX_MEDIA_BYTES, { preview: true });
    const link = await getTenantLink(lineUserId);
    const saved = still.status === 'ok' && link
        ? await saveMedia({ ownerUid: link.uid, buildingId: link.building_id, lineUserId, messageId, kind: 'image', buffer: still.buffer, contentType: still.contentType })
        : null;
    await recordInbound(lineUserId, {
        kind: 'video', text: label, messageId,
        ...(saved?.ok ? { media: { ...saved.media, preview: true } } : {}),
        ...(extra ? { extra } : {}),
    }).catch(() => undefined);
    await lineReply(replyToken, [botText(
        `ได้รับวิดีโอแล้วค่ะ แต่ไฟล์ใหญ่เกินไป (${fileSizeText(content.size)}) ${ownerWord()}จะเห็นเฉพาะภาพตัวอย่าง\n\nหากเป็นเรื่องสำคัญ กรุณาส่งเป็นคลิปสั้น ๆ (ประมาณ 10 วินาที) หรือถ่ายเป็นรูปภาพแทนนะคะ`,
    )]);
}

/** A document (PDF, picture, Word / Excel, text). Kept when it is a kind the inbox can hand back and small enough. */
async function handleInboxFile(lineUserId: string, replyToken: string, messageId: string, fileName?: string, fileSize?: number) {
    const name = (fileName ?? 'ไฟล์').slice(0, 120);
    const extra = { file_name: name };
    const placeholder = async (why: string, tell: string) => {
        await recordInbound(lineUserId, { kind: 'file', text: `[ไฟล์] ${name} (${why})`, messageId, extra }).catch(() => undefined);
        await lineReply(replyToken, [botText(tell)]);
    };
    if (!fileContentType(name)) {
        await placeholder('ชนิดไฟล์นี้เปิดในระบบไม่ได้', `ได้รับไฟล์ "${name}" แล้วค่ะ แต่ระบบเปิดไฟล์ชนิดนี้ไม่ได้ กรุณาส่งเป็น PDF หรือรูปภาพแทนนะคะ`);
        return;
    }
    const content = typeof fileSize === 'number' && fileSize > MAX_MEDIA_BYTES
        ? { status: 'too_large' as const, size: fileSize }
        : await getLineContent(messageId, MAX_MEDIA_BYTES);
    if (content.status === 'too_large') {
        await placeholder(`${fileSizeText(content.size)} ใหญ่เกิน ${fileSizeText(MAX_MEDIA_BYTES)}`, `ได้รับไฟล์ "${name}" แล้วค่ะ แต่ไฟล์ใหญ่เกินไป (${fileSizeText(content.size)}) กรุณาส่งไฟล์ที่เล็กกว่า ${fileSizeText(MAX_MEDIA_BYTES)} หรือถ่ายเป็นรูปภาพแทนนะคะ`);
        return;
    }
    if (content.status === 'unavailable') {
        await placeholder('เปิดไฟล์ไม่ได้', 'ขออภัยค่ะ โหลดไฟล์ไม่สำเร็จ กรุณาส่งใหม่อีกครั้งนะคะ');
        return;
    }
    const inbound = await storeInboxMedia(lineUserId, messageId, 'file', content, `[ไฟล์] ${name}`, extra).catch(logStoreFailure);
    if (inbound.shouldAck) await lineReply(replyToken, [botText(`ได้รับไฟล์แล้วค่ะ 🙏 ${ownerWord()}จะดูและตอบกลับโดยเร็วที่สุด`)]);
}

/** A place shared from LINE's map: the owner gets the address and a pin they can open. */
async function handleInboxLocation(lineUserId: string, replyToken: string, m: NonNullable<LineEvent['message']>) {
    const lat = Number(m.latitude);
    const lng = Number(m.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
    const title = typeof m.title === 'string' ? m.title.trim().slice(0, 100) : '';
    const address = typeof m.address === 'string' ? m.address.trim().slice(0, 300) : '';
    const inbound = await recordInbound(lineUserId, {
        kind: 'location', text: `[ตำแหน่ง] ${[title, address].filter(Boolean).join(' · ') || `${lat.toFixed(5)}, ${lng.toFixed(5)}`}`, messageId: m.id,
        extra: { location: { lat, lng, ...(title ? { title } : {}), ...(address ? { address } : {}) } },
    }).catch(() => NOT_STORED);
    if (inbound.shouldAck) await lineReply(replyToken, [botText(`ได้รับตำแหน่งแล้วค่ะ 🙏 ${ownerWord()}จะดูและตอบกลับโดยเร็วที่สุด`)]);
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
    /** The room this slip pays, when the account has several and the person (or the amount) already said which. */
    chosen?: LinkedRoom,
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
    // One room: exactly as before. Several: find out which room the money is for before anything is written.
    let target: LinkedRoom | undefined = chosen;
    if (!target && roomsOfLink(lineRoomSnap.data()).length > 1) {
        const mine = await linkedRooms(lineUserId);
        if (mine.length > 1) {
            target = await pickSlipRoom(lineUserId, replyToken, messageId, mine, lineRoomSnap.data()!, preloaded) ?? undefined;
            if (!target) return;   // asked which room, or already answered
        }
    }
    const { uid, building_id, room_id, room_number, dorm_name } = (target ?? lineRoomSnap.data()!) as LinkedRoom;

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

    // "แบ่งจ่าย" pressed on an invoice in the last 30 minutes: this slip pays part of that bill / fine.
    const mode = lineRoomSnap.data()!.split_mode as { kind?: string; item_id?: string; until?: string } | undefined;
    let splitMode = false;
    if (mode?.item_id && (mode.kind === 'bill' || mode.kind === 'fine') && Date.parse(mode.until ?? '') > Date.now()) {
        const snap = await db.doc(`users/${uid}/buildings/${building_id}/${mode.kind === 'bill' ? 'bills' : 'fines'}/${mode.item_id}`).get();
        const d = snap.data();
        if (d && d.room_id === room_id && outstandingSatang(mode.kind, d as PaidItem) > 0) {
            targetDoc = snap as unknown as typeof targetDoc;
            targetData = d as typeof targetData;
            isFine = mode.kind === 'fine';
            splitMode = true;
        }
    }

    if (!splitMode && bill.payment_status === 'paid') {
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
        await db.doc(`users/${uid}/buildings/${building_id}/slip_images/${targetDoc.id}`).set({
            data_url: dataUrl,
            room_number,
            bill_id: targetDoc.id,
            created_at: admin.firestore.FieldValue.serverTimestamp(),
        });
    }

    // 7. Auto Slip Verification for Pro Users (Gemini OCR)
    const userSnap = await db.collection('users').doc(uid).get();
    const license = effectiveLicense(userSnap.data());
    // อนุญาตให้ทุกแพ็กเกจที่จ่ายเงิน (small, medium, large) หรือ active ได้ใช้งาน AI 
    const isPro = isPaidPlan(license);

    // Read the slip with AI and compare it with the bill and the property's receiving accounts
    // (amount, receiver name / account, date-time). Auto-approval needs every check to hold, and the
    // payment is then recorded as "slip only — not yet confirmed against the bank".
    // A bill already part-paid (split payment) is checked against what is still owed.
    const kind = isFine ? 'fine' : 'bill';
    const partPaid = !!targetData.payments_recorded;
    const owed = outstandingSatang(kind, targetData as PaidItem) / 100;
    const slipMatch = dataUrl ? dataUrl.match(/^data:(image\/\w+);base64,(.+)$/) : null;
    const evaluation = await evaluateSlip({
        ownerUid: uid, buildingId: building_id,
        imageBase64: slipMatch ? slipMatch[2] : null, mimeType: slipMatch ? slipMatch[1] : 'image/jpeg',
        qrPayload: qr.payload,
        expectedAmount: owed,
        billCreatedAt: targetData.created_at as string | undefined,
        isPro,
    });
    const autoVerified = evaluation.autoApprove;
    const geminiAmount = evaluation.aiAmount;

    // 8. Pending for the owner to confirm, or "paid" when the slip checks all passed
    const now = new Date().toISOString();
    const statusField = isFine ? 'status' : 'payment_status';
    const slipRef = fingerprint ? fingerprint.slice(0, 12) : null;
    // the last part of a split payment is recorded as a payment too, so the bill's parts add up
    const settleAsPayment = autoVerified && partPaid && !!slipRef && typeof evaluation.fields.slip_account_id === 'string';

    await targetDoc.ref.update({
        [statusField]: autoVerified && !settleAsPayment ? 'paid' : 'pending',
        slip_submitted_at: now,
        ...(autoVerified && !settleAsPayment ? { paid_at: now, payment_date: now.split('T')[0] } : {}),
        ...(dataUrl ? { slip_image: true } : {}),
        ...(slipRef ? { slip_ref: slipRef } : {}),
        ...evaluation.fields,
        verify_note: evaluation.verifyNote,
    });
    if (settleAsPayment) {
        await recordSlipPayment({
            ownerUid: uid, buildingId: building_id, kind, itemId: targetDoc.id, amountSatang: Math.round(owed * 100),
            bankAccountId: evaluation.fields.slip_account_id as string, slipRef: slipRef!,
            paidAt: evaluation.details?.datetime_iso ?? now, transactionRef: (evaluation.fields.transaction_ref as string | undefined) ?? null,
            note: 'ชำระส่วนที่เหลือจากสลิป',
        });
    }

    // In split mode a genuine part payment is recorded straight away — the tenant already chose to split.
    const split = splitMode && evaluation.splitAmount != null && slipRef
        ? await applySlipSplit({ ownerUid: uid, buildingId: building_id, kind, itemId: targetDoc.id, roomId: room_id, slipRef })
        : null;
    if (splitMode && (split?.status === 'ok' || autoVerified)) {
        await lineRoomSnap.ref.update({ split_mode: admin.firestore.FieldValue.delete() });
    }
    if (split?.status === 'ok') {
        await lineReply(replyToken, [buildSplitPaidFlex({
            roomNumber: String(room_number), dormName: dorm_name, itemLabel: slipItemLabel(isFine, targetData),
            paid: split.paid, total: split.total, outstanding: split.outstanding,
        })]);
    } else {
        await lineReply(replyToken, [buildSlipResultFlex({
            roomNumber: String(room_number),
            dormName: dorm_name,
            itemLabel: slipItemLabel(isFine, targetData),
            expectedAmount: owed,
            evaluation,
            splitPostback: slipRef ? splitPostbackData(kind, targetDoc.id, slipRef) : null,
        })]);
    }

    if (autoVerified || split?.status === 'ok') await autoPostSafe(uid, building_id);

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
                    body: evaluation.outcome === 'approved' ? `รับยอดอัตโนมัติแล้ว ฿${geminiAmount ?? ''}`
                        : evaluation.outcome === 'mismatch' ? `สลิปไม่ตรง: ${evaluation.problems.join(' · ')}`
                        : 'AI ตรวจไม่ได้ — กรุณาดูสลิปและยืนยันยอด',
                },
                webpush: { notification: { icon: '/logo-icon.png', badge: '/logo-icon.png', lang: 'th' }, fcmOptions: { link: '/' } },
            });
        }
    } catch { /* best-effort */ }
}

const slipItemLabel = (isFine: boolean, item: object) =>
    isFine ? 'ค่าปรับ' : `บิล ${formatMonthLabel(String((item as { month?: unknown }).month ?? ''), 'th')}`;

/**
 * Tenant pressed "แบ่งจ่าย" on a slip card: record that slip's amount as a part payment. Only the slip
 * the button was made for (same fingerprint still on the bill, AI-read amount, matched account) counts.
 */
const SPLIT_MODE_MS = 30 * 60_000;

/** Tenant pressed "แบ่งจ่าย" on an invoice: the next slip (within 30 minutes) is taken as a part payment of it. */
async function handleSplitMode(lineUserId: string, replyToken: string, req: { kind: 'bill' | 'fine'; itemId: string }) {
    const lineRoomSnap = await db.collection('line_rooms').doc(lineUserId).get();
    if (!lineRoomSnap.exists) return;
    const found = await findItemRoom(await linkedRooms(lineUserId), req.kind, req.itemId);
    const item = found?.item;
    if (!item) { await lineReply(replyToken, [{ type: 'text', text: 'ไม่พบรายการนี้ค่ะ' }]); return; }
    const owed = outstandingSatang(req.kind, item as PaidItem) / 100;
    if (owed <= 0) { await lineReply(replyToken, [{ type: 'text', text: '✅ รายการนี้ชำระครบแล้วค่ะ ขอบคุณค่ะ 🙏' }]); return; }

    await lineRoomSnap.ref.update({
        split_mode: { kind: req.kind, item_id: req.itemId, until: new Date(Date.now() + SPLIT_MODE_MS).toISOString() },
    });
    const paidSoFar = (item.allocated_satang ?? 0) / 100;
    await lineReply(replyToken, [{
        type: 'text',
        text: `💸 แบ่งจ่าย ${slipItemLabel(req.kind === 'fine', item)}\n\n`
            + `ยอดคงเหลือ ฿${owed.toLocaleString()}${paidSoFar > 0 ? ` (ชำระแล้ว ฿${paidSoFar.toLocaleString()})` : ''}\n\n`
            + 'โอนยอดที่สะดวกแล้วส่งสลิปมาในแชทนี้ภายใน 30 นาทีได้เลยค่ะ ระบบจะตัดยอดให้อัตโนมัติ',
    }]);
}

async function handleSplitPostback(lineUserId: string, replyToken: string, data: string | undefined) {
    const req = parseSplitPostback(data);
    if (!req) return;
    const lineRoomSnap = await db.collection('line_rooms').doc(lineUserId).get();
    if (!lineRoomSnap.exists) return;
    const mine = await linkedRooms(lineUserId);
    // the room the item belongs to; with one room this is that room, as before
    const owner = (await findItemRoom(mine, req.kind, req.itemId))?.room ?? mine[0];
    if (!owner) return;
    const { uid, building_id, room_id, room_number, dorm_name } = owner;
    const r = await applySlipSplit({ ownerUid: uid, buildingId: building_id, kind: req.kind, itemId: req.itemId, roomId: room_id, slipRef: req.slipRef });
    if (r.status !== 'ok') {
        const text = r.status === 'not_found' ? 'ไม่พบรายการนี้ค่ะ'
            : r.status === 'stale' ? 'สลิปนี้แบ่งจ่ายไม่ได้แล้วค่ะ (มีสลิปใหม่กว่า หรือเจ้าของหอตรวจสอบไปแล้ว) กรุณาติดต่อเจ้าของหอนะคะ'
            : 'บันทึกแบ่งจ่ายไม่ได้ค่ะ ยอดอาจเกินยอดคงเหลือ หรือบิลถูกชำระไปแล้ว';
        await lineReply(replyToken, [{ type: 'text', text }]);
        return;
    }
    await lineReply(replyToken, [buildSplitPaidFlex({
        roomNumber: String(room_number), dormName: dorm_name, itemLabel: slipItemLabel(req.kind === 'fine', r.item),
        paid: r.paid, total: r.total, outstanding: r.outstanding,
    })]);
    await autoPostSafe(uid, building_id);
}

// ── One LINE account, several rooms ───────────────────────────────────────────

/** The room among `rooms` that a bill / fine belongs to, with the item. Null when it is none of theirs. */
async function findItemRoom(rooms: LinkedRoom[], kind: 'bill' | 'fine', itemId: string): Promise<{ room: LinkedRoom; item: FirebaseFirestore.DocumentData } | null> {
    const seen = new Set<string>();
    for (const r of rooms) {
        const key = `${r.uid}/${r.building_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const item = (await db.doc(`users/${r.uid}/buildings/${r.building_id}/${kind === 'bill' ? 'bills' : 'fines'}/${itemId}`).get()).data();
        if (!item) continue;
        const room = rooms.find(x => x.uid === r.uid && x.building_id === r.building_id && x.room_id === item.room_id);
        if (room) return { room, item };
    }
    return null;
}

const SLIP_CHOICE_MS = 30 * 60_000;
const slipRoomPostbackData = (r: LinkedRoom) => `sliproom|${r.uid}|${r.building_id}|${r.room_id}`;
function parseSlipRoomPostback(data: string | undefined): Pick<LinkedRoom, 'uid' | 'building_id' | 'room_id'> | null {
    const p = (data ?? '').split('|');
    return p.length === 4 && p[0] === 'sliproom' && p.slice(1).every(x => x && !x.includes('/')) ? { uid: p[1], building_id: p[2], room_id: p[3] } : null;
}

/** What a room still owes on its latest bill, else on its oldest unpaid fine. Null when nothing is due. */
async function roomDue(r: LinkedRoom): Promise<{ room: LinkedRoom; owed: number } | null> {
    const billDoc = await getLatestSavedBill(r.uid, r.building_id, r.room_id);
    if (billDoc && billDoc.data().payment_status !== 'paid') return { room: r, owed: outstandingSatang('bill', billDoc.data() as PaidItem) / 100 };
    const fineDoc = billDoc ? await getOldestUnpaidFine(r.uid, r.building_id, r.room_id) : null;
    return fineDoc ? { room: r, owed: outstandingSatang('fine', fineDoc.data() as PaidItem) / 100 } : null;
}

/**
 * Which room a slip pays, for an account that looks after several. In order: the room whose "แบ่งจ่าย" is open; the only
 * room with something due; the only room whose amount due equals the amount on the slip. Otherwise the person is asked
 * (the photo is kept by its LINE message id for half an hour) and null is returned.
 */
async function pickSlipRoom(
    lineUserId: string, replyToken: string, messageId: string, rooms: LinkedRoom[], link: FirebaseFirestore.DocumentData,
    preloaded?: { img: { buffer: Buffer; contentType: string }; qr: SlipQR },
): Promise<LinkedRoom | null> {
    const mode = link.split_mode as { kind?: string; item_id?: string; until?: string } | undefined;
    if (mode?.item_id && (mode.kind === 'bill' || mode.kind === 'fine') && Date.parse(mode.until ?? '') > Date.now()) {
        const found = await findItemRoom(rooms, mode.kind, mode.item_id);
        if (found) return found.room;
    }

    const dues = (await Promise.all(rooms.map(roomDue))).filter((d): d is { room: LinkedRoom; owed: number } => !!d && d.owed > 0);
    if (dues.length === 0) {
        await lineReply(replyToken, [botText(`✅ ห้อง ${roomNumbersText(rooms)} ไม่มียอดค้างชำระค่ะ ขอบคุณค่ะ 🙏`)]);
        return null;
    }
    if (dues.length === 1) return dues[0].room;

    // the amount on the slip settles it when exactly one room owes that much (AI reading: paid plans, as for checking slips)
    try {
        const owner = (await db.collection('users').doc(dues[0].room.uid).get()).data();
        if (isPaidPlan(effectiveLicense(owner))) {
            const img = preloaded?.img ?? await getLineImageContent(messageId);
            const dataUrl = img ? await compressSlipToDataUrl(img.buffer) : null;
            const m = dataUrl ? dataUrl.match(/^data:(image\/\w+);base64,(.+)$/) : null;
            const amount = m ? (await readSlipDetails(m[2], m[1]))?.amount : null;
            if (typeof amount === 'number') {
                const same = dues.filter(d => Math.abs(d.owed - amount) < 0.005);
                if (same.length === 1) return same[0].room;
            }
        }
    } catch (err) {
        console.warn('[slip-room] could not read the amount:', (err as Error).message);
    }

    await db.collection('line_rooms').doc(lineUserId).update({ slip_choice: { message_id: messageId, until: Date.now() + SLIP_CHOICE_MS } });
    const unit = botVocab(isMarket()).unit;
    await lineReply(replyToken, [{
        type: 'flex',
        altText: `สลิปนี้จ่ายของ${unit}ไหนคะ`,
        contents: {
            type: 'bubble', size: 'kilo',
            body: {
                type: 'box', layout: 'vertical', paddingAll: '16px', spacing: 'sm',
                contents: [
                    { type: 'text', text: `สลิปนี้จ่ายของ${unit}ไหนคะ`, weight: 'bold', size: 'md', wrap: true },
                    { type: 'text', text: 'กดเลือกด้านล่าง ระบบจะตัดยอดให้ถูกห้อง', size: 'xs', color: '#888888', wrap: true },
                    ...dues.slice(0, 10).map(d => ({
                        type: 'button', style: 'primary', color: '#0A6CC2', height: 'sm', margin: 'sm',
                        action: {
                            type: 'postback', data: slipRoomPostbackData(d.room),
                            label: `${unit} ${d.room.room_number} · ฿${d.owed.toLocaleString()}`.slice(0, 20),
                            displayText: `${unit} ${d.room.room_number}`,
                        },
                    })),
                ],
            },
        },
    }]);
    return null;
}

/** The person pressed a room under "สลิปนี้จ่ายของห้องไหนคะ": run the slip they sent against that room. */
async function handleSlipRoomChoice(lineUserId: string, replyToken: string, key: Pick<LinkedRoom, 'uid' | 'building_id' | 'room_id'>) {
    const ref = db.collection('line_rooms').doc(lineUserId);
    const choice = (await ref.get()).data()?.slip_choice as { message_id?: string; until?: number } | undefined;
    const room = (await linkedRooms(lineUserId)).find(r => sameRoom(r, key));
    if (!room) return;                       // not a room of theirs (any more)
    if (!choice?.message_id || Number(choice.until ?? 0) < Date.now()) {
        await lineReply(replyToken, [botText('ไม่พบสลิปที่รออยู่ค่ะ กรุณาส่งรูปสลิปอีกครั้งนะคะ')]);
        return;
    }
    await ref.update({ slip_choice: admin.firestore.FieldValue.delete() });
    await handleSlipImage(lineUserId, replyToken, choice.message_id, undefined, room);
}
