/**
 * Scan a QR, registered: every LINE registration through the LIFF app, so nobody types or sends a code.
 *
 *   GET  /j/<code>                 the QR's address (vercel.json → ?route=liff-join&c=<code>). Opens the LIFF app that
 *                                  knows the scanner on that code's OA, or — with none set up — the chat with the code.
 *   POST /api/liff-join  config    { team }                       → the team's LIFF id (the page initialises with it)
 *                        join      { access_token, code, team?, mode?, form? }
 *
 * The LIFF page proves who is scanning with a LINE access token; it is checked with LINE, and must come from the LINE
 * Login channel of the LIFF app that was opened: HorCare's (one provider for the tenant, vendor, Maintenance and Staff
 * OAs, so one LINE user id fits all four) or the team's own (api/_line-oa.ts liff_setup). Then the code goes to the same
 * function the chat uses, under the same rules — a scan is never more powerful than sending the code.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from './_firebase.js';
import { rateLimit } from './_abuse-guard.js';
import { isLineFriend, linePush, resolveLineToken, runInLineChannel, staffLineToken, type LineChannel } from './_line.js';
import { loadTeamOa, propertyOaId, teamLiffById, teamLiffOf } from './_line-oa.js';
import { isLiffId, joinKind, normalizeJoinCode, type JoinKind } from '../src/shared/joinCodes.js';
import { isBindMode } from '../src/shared/lineRooms.js';

export const config = { maxDuration: 30 };

const HORCARE_LIFF = () => (isLiffId(process.env.VITE_LIFF_ID) ? process.env.VITE_LIFF_ID : null);
const posToken = () => process.env.LINE_POS_CHANNEL_ACCESS_TOKEN;
const chatLink = (oaId: string, code: string) => `https://line.me/R/oaMessage/${encodeURIComponent(oaId)}/?${encodeURIComponent(code)}`;
const addFriend = (oaId: string | undefined | null) => (oaId ? `https://line.me/R/ti/p/${encodeURIComponent(oaId)}` : undefined);

/** Where a code's registration happens: the OA (for the chat fallback and add-friend), the channel and its LIFF app. */
interface Target {
    oaId: string | null;
    /** null: not a tenant-style OA (Maintenance / Staff are reached with their own tokens) */
    channel: LineChannel | null;
    /** set for a team's own OA */
    teamId: string | null;
    liffId: string | null;
}

async function ownerBuildingOf(kind: JoinKind, code: string): Promise<{ owner: string; building: string } | null> {
    const path = kind === 'room' ? `room_codes/${code}` : kind === 'walkin' ? `walkin_codes/${code}` : null;
    if (!path) return null;
    const d = (await db.doc(path).get()).data() as { owner_uid?: string; building_id?: string; status?: string } | undefined;
    if (!d?.owner_uid || !d.building_id) return null;
    if (kind === 'room' && d.status !== 'active') return null;
    return { owner: d.owner_uid, building: d.building_id };
}

async function targetOf(kind: JoinKind, code: string): Promise<Target | null> {
    if (kind === 'staff_reg' || kind === 'staff_link' || kind === 'owner_link') return { oaId: process.env.VITE_LINE_STAFF_OA_ID ?? null, channel: null, teamId: null, liffId: HORCARE_LIFF() };
    if (kind === 'pos_link') return { oaId: process.env.VITE_LINE_POS_OA_ID ?? null, channel: null, teamId: null, liffId: HORCARE_LIFF() };

    const place = await ownerBuildingOf(kind, code);
    if (!place) return null;
    const oaId = (await propertyOaId(place.owner, place.building)) ?? null;
    if (oaId && oaId === process.env.VITE_LINE_OA_ID) return { oaId, channel: 'tenant', teamId: null, liffId: HORCARE_LIFF() };
    if (oaId && oaId === process.env.VITE_LINE_MARKET_OA_ID) return { oaId, channel: 'market', teamId: null, liffId: HORCARE_LIFF() };
    const team = await teamLiffOf(place.owner);
    if (team) return { oaId: team.oaId, channel: `oa:${team.id}`, teamId: team.id, liffId: team.liffId };
    // a team OA without a LIFF app: only its chat knows the scanner
    const teamDoc = (await db.collection('line_oas').where('owner_uid', '==', place.owner).get()).docs[0];
    return { oaId, channel: teamDoc ? `oa:${teamDoc.id}` : 'tenant', teamId: teamDoc?.id ?? null, liffId: null };
}

function deadEnd(res: VercelResponse, status: number, message: string) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(status).send(`<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>HorCare</title><body style="font-family:sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;padding:16px;text-align:center;color:#102A43"><p>${message}</p></body></html>`);
}

/** The LIFF (or chat) address a registration QR leads to; null when the code means nothing. Shared with /r/<code>. */
export async function joinDestination(rawCode: string): Promise<string | null> {
    const code = normalizeJoinCode(rawCode);
    const kind = joinKind(code);
    if (!kind) return null;
    const t = await targetOf(kind, code);
    if (!t) return null;
    if (t.liffId) return `https://liff.line.me/${t.liffId}?join=${encodeURIComponent(code)}`;
    return t.oaId ? chatLink(t.oaId, code) : null;
}

async function openJoin(req: VercelRequest, res: VercelResponse) {
    const limited = await rateLimit(req, 'liff_join:open', 300, 3600);
    if (!limited.ok) { deadEnd(res, 429, 'สแกนถี่เกินไป กรุณาลองใหม่อีกครั้งในภายหลัง'); return; }
    const raw = Array.isArray(req.query.c) ? req.query.c[0] : req.query.c;
    const url = await joinDestination(String(raw ?? ''));
    if (!url) { deadEnd(res, 404, 'QR นี้ใช้ไม่ได้แล้ว กรุณาขอ QR ใหม่จากผู้ดูแล'); return; }
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, url);
}

interface Body { action?: 'config' | 'join'; team?: unknown; access_token?: unknown; code?: unknown; mode?: unknown; form?: { role?: unknown; name?: unknown; phone?: unknown } }

export interface JoinResponse {
    kind: JoinKind;
    ok: boolean;
    /** room: the scan's outcome (bound / requested / choose …); staff_reg: 'form' | 'pending' */
    outcome?: string;
    message: string;
    place?: string;
    room_number?: string;
    current_rooms?: string[];
    add_friend_url?: string;
}

/** Say it in the chat too, when the scanner is already a friend of that OA (a push to a non-friend fails anyway). */
async function pushIfFriend(lineUserId: string, token: string | undefined, messages: object[]): Promise<boolean | null> {
    if (!token) return null;
    const friend = await isLineFriend(lineUserId, token);
    if (friend) await linePush(lineUserId, messages, token).catch(() => undefined);
    return friend;
}
const text = (t: string) => ({ type: 'text', text: t });
/** The chat answers open with a mark (✅ ❌ ⚠️ ⌛); the page shows its own icon instead. */
const LEAD_MARK = /^(?:✅|❌|⚠️|⌛)\s*/u;

async function join(req: VercelRequest, res: VercelResponse, body: Body) {
    // a whole building can register from one Wi-Fi on move-in day
    const limited = await rateLimit(req, 'liff_join:join', 600, 3600);
    if (!limited.ok) { res.status(429).json({ error: 'too_many_requests' }); return; }
    const token = body.access_token;
    const code = normalizeJoinCode(body.code);
    const kind = joinKind(code);
    if (typeof token !== 'string' || !token || token.length > 2000 || !kind) { res.status(400).json({ error: 'invalid_input' }); return; }

    // which LIFF app the page ran in decides which LINE Login channel the token must come from
    const team = typeof body.team === 'string' && body.team ? await teamLiffById(body.team) : null;
    if (typeof body.team === 'string' && body.team && !team) { res.status(404).json({ error: 'unknown_team' }); return; }
    const { lineUserFromAccessToken } = await import('./_portal.js');
    let lineUserId: string | null;
    try {
        lineUserId = team ? await lineUserFromAccessToken(token, fetch, team.loginChannelId) : await lineUserFromAccessToken(token);
    } catch {
        res.status(503).json({ error: 'liff_not_configured' });
        return;
    }
    if (!lineUserId) { res.status(401).json({ error: 'invalid_token' }); return; }

    const target = await targetOf(kind, code);
    if (!target) { res.status(200).json({ kind, ok: false, message: 'QR นี้ใช้ไม่ได้แล้ว กรุณาขอ QR ใหม่จากผู้ดูแล' } satisfies JoinResponse); return; }
    // the LINE id only means something on the provider of the LIFF app it came from
    if ((target.teamId ?? null) !== (team?.id ?? null)) {
        if (target.liffId) { res.status(409).json({ error: 'wrong_liff', url: `https://liff.line.me/${target.liffId}?join=${encodeURIComponent(code)}` }); return; }
        res.status(409).json({ error: 'use_chat', url: target.oaId ? chatLink(target.oaId, code) : undefined });
        return;
    }

    const out = await runJoin(kind, code, lineUserId, target, body);
    res.status(200).json(out);
}

async function runJoin(kind: JoinKind, code: string, lineUserId: string, t: Target, body: Body): Promise<JoinResponse> {
    switch (kind) {
        case 'room': {
            const { scanRoomCode } = await import('./_room-qr.js');
            const mode = isBindMode(body.mode) ? body.mode : undefined;
            const teamOa = t.teamId ? await loadTeamOa(t.teamId) : null;
            const creds = teamOa ? { token: teamOa.token, secret: teamOa.secret, ownerUid: teamOa.ownerUid } : undefined;
            const channel = t.channel ?? 'tenant';
            const scan = await runInLineChannel(channel, () => scanRoomCode(lineUserId, code, mode), creds);
            const token = teamOa?.token ?? await resolveLineToken(channel);
            const bound = scan.outcome === 'bound' || scan.outcome === 'already_yours';
            const friend = bound ? await pushIfFriend(lineUserId, token, scan.outcome === 'bound'
                ? [text(`🎉 ลงทะเบียนห้อง ${scan.roomNumber} สำเร็จ!\n\nพิมพ์ "บิล" เพื่อดูบิลล่าสุดได้เลย 💬`)] : []) : null;
            if (friend !== null) {
                const { recordFriendship } = await import('./_line-binding.js');
                await recordFriendship(lineUserId, friend);
            }
            const roomNumber = 'roomNumber' in scan ? scan.roomNumber : undefined;
            const place = 'dormName' in scan ? scan.dormName : undefined;
            const messages: Record<string, string> = {
                bound: `ลงทะเบียนห้อง ${roomNumber} เรียบร้อย`,
                already_yours: `ห้อง ${roomNumber} เป็นของคุณอยู่แล้ว`,
                requested: 'ส่งคำขอแล้ว รอผู้ดูแลอนุมัติ จะแจ้งผลทาง LINE',
                already_requested: 'ส่งคำขอไว้แล้ว รอผู้ดูแลอนุมัติ',
                recently_rejected: 'คำขอห้องนี้ถูกปฏิเสธเมื่อไม่นานมานี้ กรุณาติดต่อผู้ดูแล',
                too_many_requests: 'มีคำขอค้างอยู่มากเกินไป กรุณาติดต่อผู้ดูแล',
                choose: 'คุณมีห้องอยู่แล้ว ต้องการย้ายมาห้องนี้ หรือเพิ่มห้องนี้?',
                too_many_rooms: 'บัญชีนี้มีห้องครบจำนวนแล้ว กรุณาติดต่อผู้ดูแล',
                invalid: 'QR นี้ใช้ไม่ได้แล้ว กรุณาขอ QR ใหม่จากผู้ดูแล',
                room_unavailable: 'ห้องนี้ลงทะเบียนไม่ได้ในตอนนี้ กรุณาติดต่อผู้ดูแล',
            };
            return {
                kind, ok: ['bound', 'already_yours', 'requested', 'already_requested'].includes(scan.outcome), outcome: scan.outcome,
                message: messages[scan.outcome] ?? 'ลงทะเบียนไม่สำเร็จ', place, room_number: roomNumber,
                current_rooms: scan.outcome === 'choose' ? scan.currentRoomNumbers : undefined,
                add_friend_url: friend === false ? addFriend(t.oaId) : undefined,
            };
        }
        case 'walkin': {
            const { bindWalkInCode } = await import('./_walkin.js');
            const registered = (await db.collection('line_rooms').doc(lineUserId).get()).exists;
            const teamOa = t.teamId ? await loadTeamOa(t.teamId) : null;
            const creds = teamOa ? { token: teamOa.token, secret: teamOa.secret, ownerUid: teamOa.ownerUid } : undefined;
            const channel = t.channel ?? 'market';
            const replies = await runInLineChannel(channel, () => bindWalkInCode(lineUserId, code, { registered }), creds) as { text?: string }[];
            const first = replies[0]?.text ?? '';
            const ok = first.startsWith('✅');
            const friend = ok ? await pushIfFriend(lineUserId, teamOa?.token ?? await resolveLineToken(channel), replies) : null;
            return { kind, ok, message: ok ? 'เชื่อม LINE กับคำขอเข้าขายแล้ว ผลการพิจารณาจะแจ้งในแชทของตลาด' : first, add_friend_url: friend === false ? addFriend(t.oaId) : undefined };
        }
        case 'staff_link': {
            const { redeemStaffLink } = await import('./_work-orders.js');
            const r = await redeemStaffLink(lineUserId, code);
            if (!r.ok) {
                const why: Record<string, string> = {
                    not_found: 'ไม่พบรหัสนี้ กรุณาขอ QR ใหม่จากผู้จัดการ', used: 'QR นี้ถูกใช้กับ LINE บัญชีอื่นแล้ว',
                    expired: 'QR หมดอายุแล้ว กรุณาขอใหม่จากผู้จัดการ', staff_unavailable: 'รายชื่อนี้ถูกปิดใช้งานแล้ว กรุณาติดต่อผู้จัดการ',
                };
                return { kind, ok: false, message: why[r.reason] ?? 'เชื่อมไม่สำเร็จ' };
            }
            const { syncStaffMenu } = await import('./_staff-menu.js');
            await syncStaffMenu(lineUserId);
            const friend = await pushIfFriend(lineUserId, staffLineToken(), [text(`✅ ลงทะเบียนสำเร็จ\n\nสวัสดีคุณ ${r.staffName}${r.dormName ? ` (${r.dormName})` : ''}\nกด "งานของฉัน" ในเมนูด้านล่างเพื่อดูงานได้เลย`)]);
            return { kind, ok: true, message: `สวัสดีคุณ ${r.staffName} เชื่อม LINE ทีมงานเรียบร้อย`, place: r.dormName || undefined, add_friend_url: friend === false ? addFriend(t.oaId) : undefined };
        }
        case 'owner_link': {
            const { redeemOwnerLink } = await import('./_owner-line.js');
            const answer = await redeemOwnerLink(lineUserId, code);
            const ok = answer.startsWith('✅');
            if (ok) { const { syncStaffMenu } = await import('./_staff-menu.js'); await syncStaffMenu(lineUserId); }
            const friend = ok ? await pushIfFriend(lineUserId, staffLineToken(), [text(answer)]) : null;
            return { kind, ok, message: answer.replace(LEAD_MARK, ''), add_friend_url: friend === false ? addFriend(t.oaId) : undefined };
        }
        case 'pos_link': {
            const { redeemPosLink } = await import('./_pos.js');
            const r = await redeemPosLink(lineUserId, code);
            const friend = r.ok ? await pushIfFriend(lineUserId, posToken(), [text(r.text)]) : null;
            return { kind, ok: r.ok, message: r.text.replace(LEAD_MARK, '').split('\n')[0], add_friend_url: friend === false ? addFriend(t.oaId) : undefined };
        }
        case 'staff_reg': {
            const { registerStaffFromLiff } = await import('./_staff-registration.js');
            const r = await registerStaffFromLiff(lineUserId, code, body.form ?? null);
            if (!r.ok) return { kind, ok: false, outcome: r.reason, message: r.message };
            if (r.status === 'form') return { kind, ok: true, outcome: 'form', message: 'กรอกข้อมูลเพื่อสมัคร', place: r.dormName || undefined };
            const friend = await pushIfFriend(lineUserId, staffLineToken(), [text('📨 ส่งใบสมัครแล้ว รอผู้จัดการอนุมัติ จะแจ้งผลในแชทนี้')]);
            return { kind, ok: true, outcome: 'pending', message: 'ส่งใบสมัครแล้ว รอผู้จัดการอนุมัติ', place: r.dormName || undefined, add_friend_url: friend === false ? addFriend(t.oaId) : undefined };
        }
    }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method === 'GET') { await openJoin(req, res); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return; }
    const body = (req.body ?? {}) as Body;
    if (body.action === 'config') {
        const team = typeof body.team === 'string' ? await teamLiffById(body.team) : null;
        if (!team) { res.status(404).json({ error: 'unknown_team' }); return; }
        res.setHeader('Cache-Control', 'public, max-age=300');
        res.status(200).json({ liff_id: team.liffId });
        return;
    }
    if (body.action === 'join') { await join(req, res, body); return; }
    res.status(400).json({ error: 'unknown_action' });
}
