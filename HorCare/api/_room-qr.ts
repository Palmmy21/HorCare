/**
 * The permanent registration QR of a room: printed once, stuck on the door or the welcome pack, good for every tenant.
 *
 *   GET  /r/<code>      the QR's address. Goes through HorCare, not straight to LINE, so how a scan works and the
 *                       Official Account behind a property can change without reprinting anything.
 *   POST /api/room-qr   codes | rotate | status | approve | reject (owner / staff)
 *                       liff_scan (the scanner, proven by a LINE access token)
 *
 * Two ways a scan arrives. On the shared OA it opens the LIFF app and registers with nothing else to do. The LIFF app
 * knows LINE ids only for its own provider, so a team's OA or the vendor OA opens the chat with the code ready to send.
 *
 * A code is not a secret that grants a room: it sits on a door, and a past tenant may have a photo of it. So it binds on
 * its own only while the room has no LINE account. When the room is taken the scan becomes a request and nobody loses
 * the room until someone with `tenant.update` on that property approves it.
 *
 * The same rules decide a room named another way — the property's code followed by the room number typed in the chat
 * (`claimRoom`, used by the webhook): nothing has to be switched on for it, and it is exactly as safe as a scan.
 *
 * One LINE account may hold several rooms (a teacher renting three for students). A first room, or a tenant changing
 * rooms, binds as above. Someone who already has a room and scans another is asked which they mean: moving binds as
 * before, an ADDED room always goes to an admin first — a QR on a door is no proof the owner wants this person to
 * collect rooms. (A one-time invitation from the owner adds straight away: see _invitations.ts.)
 *
 * `room_codes/{code}`                    code → room (backend only)
 * `.../buildings/{b}/room_qr/{roomId}`   room → its code, for reprinting
 * `.../buildings/{b}/line_requests/{id}` scans of a taken room
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash, randomInt } from 'node:crypto';
import { db } from './_firebase.js';
import { rateLimit } from './_abuse-guard.js';
import { appBaseUrl } from './_app-url.js';
import { writeAudit } from './_audit.js';
import { bindingDisplay, prepareBinding, recordFriendship } from './_line-binding.js';
import { channelAllowsOwner, currentLineChannel, isLineFriend, linePush, resolveLineToken, roomLineChannel, runInLineChannel, type LineChannel } from './_line.js';
import { propertyOaId } from './_line-oa.js';
import { raiseAlert } from './_alerts.js';
import { authorize, buildingExists } from './_rbac.js';
import { raiseBindingAlert, raiseRequestAlert } from './_security-alerts.js';
import { MAX_PENDING_PER_ROOM, QR_CHUNK, REJECT_COOLDOWN_MS, type RoomLineRequest } from '../src/shared/roomQr.js';
import { isBindMode, roomNumbersText, type BindMode } from '../src/shared/lineRooms.js';

export const config = { maxDuration: 15 };

const CODES = 'room_codes';
const CODE_RE = /^HCR-[A-HJ-NP-Z2-9]{10}$/;
// No 0/O/1/I so a code read off paper can't be misread.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const isRoomCode = (text: string): boolean => CODE_RE.test(text.trim().toUpperCase());

function generateCode(): string {
    let out = 'HCR-';
    for (let i = 0; i < 10; i++) out += ALPHABET[randomInt(ALPHABET.length)];
    return out;
}

const isRoomId = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 128 && !x.includes('/');
const requestId = (lineUserId: string, roomId: string) => createHash('sha256').update(`${lineUserId}|${roomId}`).digest('hex').slice(0, 32);
const base = (ownerUid: string, buildingId: string) => `users/${ownerUid}/buildings/${buildingId}`;

function deadEnd(res: VercelResponse, status: number, message: string) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(status).send(`<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>HorCare</title><body style="font-family:sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;padding:16px;text-align:center;color:#102A43"><p>${message}</p></body></html>`);
}

async function openQr(req: VercelRequest, res: VercelResponse) {
    const limited = await rateLimit(req, 'room_qr:open', 300, 3600);
    if (!limited.ok) { deadEnd(res, 429, 'สแกนถี่เกินไป กรุณาลองใหม่อีกครั้งในภายหลัง'); return; }
    const raw = Array.isArray(req.query.c) ? req.query.c[0] : req.query.c;
    const code = String(raw ?? '').trim().toUpperCase();
    const entry = isRoomCode(code) ? (await db.collection(CODES).doc(code).get()).data() : undefined;
    if (!entry || entry.status !== 'active') { deadEnd(res, 404, 'QR นี้ใช้ไม่ได้แล้ว กรุณาขอใบใหม่จากเจ้าของหอ'); return; }
    const oaId = await propertyOaId(entry.owner_uid, entry.building_id);
    if (!oaId) { deadEnd(res, 503, 'ระบบยังไม่พร้อม กรุณาติดต่อเจ้าของหอ'); return; }
    res.setHeader('Cache-Control', 'no-store');
    // the LIFF app that knows the scanner on this property's OA — HorCare's (tenant or vendor OA) or the team's own —
    // and only the chat when there is none (api/_liff-join.ts)
    const { joinDestination } = await import('./_liff-join.js');
    res.redirect(302, (await joinDestination(code)) ?? chatLink(oaId, code));
}

const chatLink = (oaId: string, code: string) => `https://line.me/R/oaMessage/${encodeURIComponent(oaId)}/?${encodeURIComponent(code)}`;

/** The scan-only path: the LIFF app proves the LINE account, so nobody has to send anything. */
async function liffScan(req: VercelRequest, res: VercelResponse, body: Body) {
    // a whole building can register from one Wi-Fi on move-in day
    const limited = await rateLimit(req, 'room_qr:liff', 600, 3600);
    if (!limited.ok) { res.status(429).json({ error: 'too_many_requests' }); return; }
    const token = body.access_token;
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
    if (typeof token !== 'string' || !token || token.length > 2000 || !isRoomCode(code)) { res.status(400).json({ error: 'invalid_input' }); return; }

    const { lineUserFromAccessToken } = await import('./_portal.js');
    let lineUserId: string | null;
    try {
        lineUserId = await lineUserFromAccessToken(token);
    } catch {
        res.status(503).json({ error: 'liff_not_configured' });
        return;
    }
    if (!lineUserId) { res.status(401).json({ error: 'invalid_token' }); return; }

    const entry = (await db.collection(CODES).doc(code).get()).data();
    const oaId = entry ? await propertyOaId(entry.owner_uid, entry.building_id) : undefined;
    // this LINE id means nothing to a team's OA: such a room can only be registered from its own chat
    if (entry?.status === 'active' && oaId && oaId !== process.env.VITE_LINE_OA_ID) { res.status(409).json({ error: 'use_chat', url: chatLink(oaId, code) }); return; }

    const mode = isBindMode(body.mode) ? body.mode : undefined;
    const scan = await runInLineChannel('tenant', () => scanRoomCode(lineUserId, code, mode));
    const friend = scan.outcome === 'bound' || scan.outcome === 'already_yours' ? await isLineFriend(lineUserId, await resolveLineToken('tenant')) : null;
    if (friend !== null) await recordFriendship(lineUserId, friend);
    if (scan.outcome === 'bound' && friend) await notify(lineUserId, 'tenant', `🎉 ลงทะเบียนห้อง ${scan.roomNumber} สำเร็จ!\n\nพิมพ์ "บิล" เพื่อดูบิลล่าสุดได้เลย 💬`);
    res.status(200).json({
        outcome: scan.outcome,
        room_number: 'roomNumber' in scan ? scan.roomNumber : undefined,
        dorm_name: 'dormName' in scan ? scan.dormName : undefined,
        current_rooms: scan.outcome === 'choose' ? scan.currentRoomNumbers : undefined,
        adding: scan.outcome === 'requested' || scan.outcome === 'already_requested' ? scan.adding : undefined,
        add_friend_url: friend === false && oaId ? `https://line.me/R/ti/p/${encodeURIComponent(oaId)}` : undefined,
    });
}

export type ScanResult =
    | { outcome: 'bound'; roomNumber: string; dormName: string }
    | { outcome: 'already_yours'; roomNumber: string; dormName: string }
    /** `adding`: the room is free, but this account already has another, so an admin decides. */
    | { outcome: 'requested' | 'already_requested'; roomNumber: string; dormName: string; adding: boolean }
    | { outcome: 'recently_rejected' | 'too_many_requests'; roomNumber: string; dormName: string }
    /** Has one other room and did not say what this scan means: ask "ย้ายห้อง" or "เพิ่มห้อง", then scan again with a mode. */
    | { outcome: 'choose'; roomNumber: string; dormName: string; currentRoomNumbers: string[] }
    | { outcome: 'too_many_rooms'; roomNumber: string; dormName: string }
    | { outcome: 'invalid' | 'room_unavailable' };

/**
 * A LINE user sent a room's code (the QR pre-fills it, or they typed it off the card).
 * `mode` is their answer when they already have a room: 'move' leaves it, 'add' keeps it.
 */
export async function scanRoomCode(lineUserId: string, rawCode: string, mode?: BindMode): Promise<ScanResult> {
    const code = rawCode.trim().toUpperCase();
    if (!isRoomCode(code)) return { outcome: 'invalid' };
    const entry = (await db.collection(CODES).doc(code).get()).data();
    if (!entry || entry.status !== 'active') return { outcome: 'invalid' };
    return claimRoom(lineUserId, { ownerUid: entry.owner_uid as string, buildingId: entry.building_id as string, roomId: entry.room_id as string }, { mode, via: 'room_qr' });
}

/**
 * A LINE account asks for a room. The room may have been named by its QR, or by the property's code and a room number
 * typed in the chat: neither proves the person lives there, so both follow the same rules.
 *   • the room has no LINE account and this is the person's first room (or they are moving) → registered at once
 *   • the room already has someone, or this would be one more room for the account → a request an admin decides
 *   • the person has one other room and has not said what they mean → 'choose'
 */
export async function claimRoom(
    lineUserId: string, target: { ownerUid: string; buildingId: string; roomId: string },
    opts: { mode?: BindMode; via: 'room_qr' | 'room_number' },
): Promise<ScanResult> {
    const { ownerUid, buildingId, roomId } = target;
    const { mode, via } = opts;
    if (!channelAllowsOwner(ownerUid)) return { outcome: 'invalid' };
    const { dormName, dueDay } = await bindingDisplay(ownerUid, buildingId);
    const channel = currentLineChannel();

    const bound = await db.runTransaction(async tx => {
        const b = await prepareBinding(tx, { lineUserId, ownerUid, buildingId, roomId, mode });
        if (!b.room || b.room.is_active === false) return { unavailable: true as const };
        const roomNumber = String(b.room.room_number);
        if (b.effects.alreadyBound) return { roomNumber, already: true as const };
        if (b.choice === 'full') return { roomNumber, full: true as const };
        if (b.choice === 'ask' && !mode) return { roomNumber, ask: b.currentRooms.map(r => r.room_number) };
        const adding = b.effects.keptRoomNumbers.length > 0;
        // taken by someone else, or one more room for an account that has some: an admin decides
        if (b.effects.replacedExisting || adding) return { roomNumber, taken: true as const, adding, kept: b.effects.keptRoomNumbers };
        b.commit({ channel, dormName, dueDay, extra: { via } });
        return { roomNumber, effects: b.effects };
    });

    if ('unavailable' in bound) return { outcome: 'room_unavailable' };
    const { roomNumber } = bound;
    if ('already' in bound) return { outcome: 'already_yours', roomNumber, dormName };
    if ('full' in bound) return { outcome: 'too_many_rooms', roomNumber, dormName };
    if ('ask' in bound) return { outcome: 'choose', roomNumber, dormName, currentRoomNumbers: bound.ask! };
    const adding = 'adding' in bound && bound.adding === true;

    if ('effects' in bound) {
        await raiseBindingAlert(ownerUid, buildingId, {
            roomId, roomNumber, lineUserId, via,
            replacedExisting: false, movedFromRoomNumber: bound.effects!.movedFromRoomNumber,
        });
        await writeAudit({
            ownerUid, propertyId: buildingId, userId: `line:${lineUserId}`, role: 'tenant', action: 'UPDATE',
            resourceType: 'line_link', resourceId: roomId, resourceLabel: `Room ${roomNumber}`,
            note: via === 'room_qr' ? 'registered with room QR' : 'registered with property code and room number',
        });
        return { outcome: 'bound', roomNumber, dormName };
    }

    // ── the room is taken: an admin decides ──
    const col = db.collection(`${base(ownerUid, buildingId)}/line_requests`);
    const id = requestId(lineUserId, roomId);
    const prev = (await col.doc(id).get()).data() as RoomLineRequest | undefined;
    if (prev?.status === 'pending') return { outcome: 'already_requested', roomNumber, dormName, adding };
    if (prev?.status === 'rejected' && Date.now() - Date.parse(prev.decided_at ?? '') < REJECT_COOLDOWN_MS) {
        return { outcome: 'recently_rejected', roomNumber, dormName };
    }
    // anyone can hold a photo of a door; they must not be able to bury the real tenant's request
    const pending = await col.where('room_id', '==', roomId).where('status', '==', 'pending').get();
    if (pending.size >= MAX_PENDING_PER_ROOM) return { outcome: 'too_many_requests', roomNumber, dormName };

    const token = await resolveLineToken(channel);
    const profile = token ? await lineProfileName(lineUserId, token) : '';
    const request: RoomLineRequest = {
        id, room_id: roomId, room_number: roomNumber, line_user_id: lineUserId, line_ref: lineUserId.slice(-4),
        display_name: profile, channel, status: 'pending', created_at: new Date().toISOString(),
        ...(adding && 'kept' in bound ? { add: true, other_rooms: roomNumbersText((bound.kept ?? []).map(n => ({ room_number: n }))) } : {}),
    };
    await col.doc(id).set(request);
    await raiseRequestAlert(ownerUid, buildingId, { roomId, roomNumber, lineUserId, displayName: profile });
    await raiseAlert({
        ownerUid, buildingId, type: 'line_request',
        title: adding ? `📝 ขอเพิ่มห้อง ${roomNumber} ให้ LINE เดิม` : `📝 ขอลงทะเบียน LINE ห้อง ${roomNumber} (มีคนอยู่แล้ว)`,
        body: `${profile || 'ไม่ทราบชื่อ'} — กดเพื่ออนุมัติหรือปฏิเสธ`,
    });
    return { outcome: 'requested', roomNumber, dormName, adding };
}

async function lineProfileName(lineUserId: string, token: string): Promise<string> {
    try {
        const res = await fetch(`https://api.line.me/v2/bot/profile/${encodeURIComponent(lineUserId)}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return '';
        return String(((await res.json()) as { displayName?: string }).displayName ?? '').slice(0, 80);
    } catch {
        return '';
    }
}

interface Body {
    action?: 'codes' | 'rotate' | 'status' | 'approve' | 'reject' | 'liff_scan';
    owner_uid?: string;
    building_id?: string;
    room_ids?: unknown;
    request_id?: string;
    access_token?: unknown;
    code?: unknown;
    /** liff_scan: the scanner's answer when they already have a room ('move' | 'add'). */
    mode?: unknown;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method === 'GET' || req.method === 'HEAD') { await openQr(req, res); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const body = (req.body ?? {}) as Body;
    if (body.action === 'liff_scan') { await liffScan(req, res, body); return; }
    const buildingId = body.building_id;
    if (!buildingId || typeof buildingId !== 'string') { res.status(400).json({ error: 'building_id is required' }); return; }

    if (body.action === 'status') {
        const ctx = await authorize(req, res, { ownerUid: body.owner_uid, buildingId, permission: 'invitation.read' });
        if (!ctx) return;
        const snap = await db.collection(`${base(ctx.ownerUid, buildingId)}/line_requests`).where('status', '==', 'pending').get();
        // the full LINE id stays on the server: staff see enough to tell accounts apart
        const requests = snap.docs
            .map(d => ({ ...(d.data() as RoomLineRequest), line_user_id: undefined }))
            .sort((a, b) => a.created_at.localeCompare(b.created_at));
        res.status(200).json({ requests });
        return;
    }

    if (body.action === 'codes' || body.action === 'rotate') {
        const ctx = await authorize(req, res, { ownerUid: body.owner_uid, buildingId, permission: 'invitation.create' });
        if (!ctx) return;
        if (!(await buildingExists(ctx.ownerUid, buildingId))) { res.status(404).json({ error: 'property_not_found' }); return; }
        const roomIds = Array.isArray(body.room_ids) ? [...new Set(body.room_ids.filter(isRoomId))] : [];
        if (roomIds.length === 0) { res.status(400).json({ error: 'invalid_input' }); return; }
        if (roomIds.length > QR_CHUNK) { res.status(400).json({ error: 'too_many_rooms', max: QR_CHUNK }); return; }
        const rotate = body.action === 'rotate';
        const b = base(ctx.ownerUid, buildingId);
        const roomRefs = roomIds.map(id => db.doc(`${b}/rooms/${id}`));
        const qrRefs = roomIds.map(id => db.doc(`${b}/room_qr/${id}`));
        const nowIso = new Date().toISOString();

        // A transaction so two people printing at once get the same code for a room, never two.
        const out = await db.runTransaction(async tx => {
            const rooms = await tx.getAll(...roomRefs);
            const qrs = await tx.getAll(...qrRefs);
            const codes: { room_id: string; room_number: string; code: string }[] = [];
            let changed = 0;
            rooms.forEach((r, i) => {
                const room = r.data();
                if (!room || room.is_active === false) return;
                const roomNumber = String(room.room_number ?? r.id);
                const current = qrs[i].data()?.code as string | undefined;
                if (current && !rotate) { codes.push({ room_id: r.id, room_number: roomNumber, code: current }); return; }
                const code = generateCode();
                if (current) tx.set(db.collection(CODES).doc(current), { status: 'revoked', revoked_at: nowIso, revoked_by: ctx.uid }, { merge: true });
                tx.set(db.collection(CODES).doc(code), { owner_uid: ctx.ownerUid, building_id: buildingId, room_id: r.id, status: 'active', created_at: nowIso, created_by: ctx.uid });
                tx.set(qrRefs[i], { code, created_at: nowIso });
                codes.push({ room_id: r.id, room_number: roomNumber, code });
                changed++;
            });
            return { codes, changed };
        });
        if (out.changed > 0) {
            await writeAudit({
                ownerUid: ctx.ownerUid, propertyId: buildingId, userId: ctx.uid, userName: ctx.displayName, role: ctx.role,
                action: rotate ? 'UPDATE' : 'CREATE', resourceType: 'invitation', resourceId: null,
                resourceLabel: `Room QR ${out.changed} rooms`, note: rotate ? 'room QR replaced' : 'room QR created', req,
            });
        }
        res.status(200).json({ codes: out.codes, base_url: appBaseUrl() });
        return;
    }

    if (body.action === 'approve' || body.action === 'reject') {
        const ctx = await authorize(req, res, { ownerUid: body.owner_uid, buildingId, permission: 'tenant.update' });
        if (!ctx) return;
        if (typeof body.request_id !== 'string' || !/^[0-9a-f]{32}$/.test(body.request_id)) { res.status(400).json({ error: 'invalid_input' }); return; }
        const reqRef = db.doc(`${base(ctx.ownerUid, buildingId)}/line_requests/${body.request_id}`);
        const decided = { decided_by: ctx.displayName, decided_at: new Date().toISOString() };

        if (body.action === 'reject') {
            const r = await db.runTransaction(async tx => {
                const s = await tx.get(reqRef);
                const data = s.data() as RoomLineRequest | undefined;
                if (!data || data.status !== 'pending') return null;
                tx.update(reqRef, { status: 'rejected', ...decided });
                return data;
            });
            if (!r) { res.status(409).json({ error: 'request_not_pending' }); return; }
            await writeAudit({
                ownerUid: ctx.ownerUid, propertyId: buildingId, userId: ctx.uid, userName: ctx.displayName, role: ctx.role,
                action: 'UPDATE', resourceType: 'line_link', resourceId: r.room_id, resourceLabel: `Room ${r.room_number}`, note: 'LINE registration request rejected', req,
            });
            await notify(r.line_user_id, roomLineChannel({ line_channel: r.channel }), `❌ คำขอลงทะเบียนห้อง ${r.room_number} ไม่ได้รับการอนุมัติ\n\nหากเป็นผู้เช่าห้องนี้ กรุณาติดต่อเจ้าของหอค่ะ`);
            res.status(200).json({ ok: true });
            return;
        }

        const first = (await reqRef.get()).data() as RoomLineRequest | undefined;
        if (!first || first.status !== 'pending') { res.status(409).json({ error: 'request_not_pending' }); return; }
        const { dormName, dueDay } = await bindingDisplay(ctx.ownerUid, buildingId);
        const others = await db.collection(`${base(ctx.ownerUid, buildingId)}/line_requests`)
            .where('room_id', '==', first.room_id).where('status', '==', 'pending').get();

        const result = await db.runTransaction(async tx => {
            const s = await tx.get(reqRef);
            const r = s.data() as RoomLineRequest | undefined;
            if (!r || r.status !== 'pending') return { error: 'request_not_pending' as const };
            const b = await prepareBinding(tx, { lineUserId: r.line_user_id, ownerUid: ctx.ownerUid, buildingId, roomId: r.room_id, mode: r.add ? 'add' : 'move' });
            if (!b.room || b.room.is_active === false) return { error: 'room_unavailable' as const };
            b.commit({ channel: roomLineChannel({ line_channel: r.channel }), dormName, dueDay, extra: { via: 'room_qr_approved', approved_by: ctx.uid } });
            tx.update(reqRef, { status: 'approved', ...decided });
            // the room is decided: the rest of the queue for it would otherwise approve over this tenant
            for (const o of others.docs) if (o.id !== reqRef.id) tx.update(o.ref, { status: 'rejected', ...decided });
            return { r, replaced: b.effects.replacedExisting ? b.existingLine! : null, moved: b.effects.movedFromRoomNumber, kept: b.effects.keptRoomNumbers, oldChannel: b.room.line_channel };
        });
        if ('error' in result) { res.status(409).json({ error: result.error }); return; }

        const { r } = result;
        await raiseBindingAlert(ctx.ownerUid, buildingId, {
            roomId: r.room_id, roomNumber: r.room_number, lineUserId: r.line_user_id, via: 'room_qr',
            replacedExisting: !!result.replaced, movedFromRoomNumber: result.moved,
        });
        await writeAudit({
            ownerUid: ctx.ownerUid, propertyId: buildingId, userId: ctx.uid, userName: ctx.displayName, role: ctx.role,
            action: 'UPDATE', resourceType: 'line_link', resourceId: r.room_id, resourceLabel: `Room ${r.room_number}`,
            note: 'LINE registration request approved', req,
        });
        if (await isLineFriend(r.line_user_id, await resolveLineToken(roomLineChannel({ line_channel: r.channel }))) === false) {
            await db.doc(`${base(ctx.ownerUid, buildingId)}/rooms/${r.room_id}`).update({ line_unreachable: true }).catch(() => undefined);
        }
        await notify(r.line_user_id, roomLineChannel({ line_channel: r.channel }), result.kept.length > 0
            ? `🎉 เพิ่มห้อง ${r.room_number} ให้ LINE นี้แล้วค่ะ\n\nตอนนี้คุณดูแลห้อง ${roomNumbersText([...result.kept, r.room_number].map(n => ({ room_number: n })))} บิลของทุกห้องจะส่งมาที่แชทนี้ พิมพ์ "บิล" เพื่อดูได้เลย 💬`
            : `🎉 ลงทะเบียนห้อง ${r.room_number} สำเร็จแล้วค่ะ\n\nพิมพ์ "บิล" เพื่อดูบิลล่าสุดได้เลย 💬`);
        if (result.replaced) {
            await notify(result.replaced, roomLineChannel({ line_channel: result.oldChannel }), `ℹ️ บัญชี LINE นี้ไม่ได้ผูกกับห้อง ${r.room_number} แล้ว หากไม่ถูกต้อง กรุณาติดต่อเจ้าของหอค่ะ`);
        }
        res.status(200).json({ ok: true });
        return;
    }

    res.status(400).json({ error: 'unknown_action' });
}

/** Best effort: a person who has blocked the OA must not fail a decision that is already saved. */
async function notify(lineUserId: string, channel: LineChannel, text: string) {
    await linePush(lineUserId, [{ type: 'text', text }], await resolveLineToken(channel)).catch(() => undefined);
}
