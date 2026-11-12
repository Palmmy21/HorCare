/**
 * /api/market — shop closures ("แจ้งหยุด") and walk-in vendors ("ขาจร").
 *
 * Public (no login — they come from the stall's portal link / the market's walk-in link, like the
 * parcels and announcements portal reads), so each one proves the property is a market and the stall
 * exists, validates strictly, and is capped:
 *   closure_submit | closure_cancel | closure_list | walkin_info | walkin_submit
 *   (walk-ins come with the market's scan link `link` — api/_walkin.ts — or, for links printed before, owner_uid)
 * Staff (signed in, property-checked):
 *   closure_ack / closure_add – shop.update     walkin_decide / walkin_add / walkin_link – visitor.create
 *   market_closure_add / market_closure_cancel – shop.update   market_closure_list – shop.read
 *     (the whole market, or some zones, shut for a day: power cut, flood … — the revenue audit excuses those days)
 * Reading the lists is straight from Firestore under rules needing shop.read / visitor.read.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import { db } from './_firebase.js';
import { authorize, buildingExists } from './_rbac.js';
import { writeAudit } from './_audit.js';
import { notify } from './_notify.js';
import { linePush, roomLineToken, runPooled } from './_line.js';
import { honeypotTripped, rateLimit, verifyCaptcha } from './_abuse-guard.js';
import { resolvePortalLink } from './_portal-link.js';
import {
    lotOf, marketName, newWalkInCode, notifyWalkInDecision, resolveWalkInLink, saveWalkInCode, walkInLineUrl, walkInLinkToken, walkInLots, walkInPageUrl,
} from './_walkin.js';
import {
    CLOSURE_REASON_LABELS_TH, MAX_ACTIVE_CLOSURES_PER_ROOM, WALKIN_MAX_PER_DAY,
    MARKET_CLOSURE_REASON_LABELS_TH, WALKIN_MAX_DAYS_AHEAD, addDays, cleanClosureInput, cleanMarketClosureInput, cleanWalkInInput, isValidDate, lotRequests, todayTh, upcomingClosures,
    type MarketClosure, type ShopClosure, type WalkIn,
} from '../src/shared/market.js';

export const config = { maxDuration: 15 };

interface Body {
    action?: 'closure_submit' | 'closure_cancel' | 'closure_list' | 'closure_ack' | 'closure_add' | 'walkin_info' | 'walkin_submit' | 'walkin_add' | 'walkin_decide' | 'walkin_link'
        | 'market_closure_add' | 'market_closure_cancel' | 'market_closure_list';
    zones?: unknown; waive_rent?: unknown; market_closure_id?: unknown; notify_line?: unknown;
    owner_uid?: string;
    building_id?: string;
    room_id?: string;
    closure_id?: string;
    walkin_id?: string;
    status?: string;
    from_date?: unknown; to_date?: unknown; reason?: unknown; note?: unknown;
    date?: unknown; name?: unknown; phone?: unknown; goods?: unknown; preferred_room_id?: unknown;
    /** walkin_info / walkin_submit: the market's scan link token (/?walkin=…). */
    link?: unknown;
    /** walkin_decide: the lot the market gives ('' = none yet); walkin_link: make a new link (the old one stops). */
    lot_room_id?: unknown; rotate?: unknown;
    /** Hidden field: a person never fills it in. */
    website?: unknown;
    /** Cloudflare Turnstile token (only checked when TURNSTILE_SECRET is set). */
    captcha_token?: unknown;
    /** closure_submit / closure_cancel / closure_list: the stall's portal link (proves which stall this is). */
    portal?: unknown;
}

const PUBLIC = new Set(['closure_submit', 'closure_cancel', 'closure_list', 'walkin_info', 'walkin_submit']);
/** Calls per visitor per hour, by public action: writes are tight, reads are loose. */
const PUBLIC_LIMITS: Record<string, number> = { closure_submit: 10, walkin_submit: 5, closure_cancel: 30, closure_list: 120, walkin_info: 120 };
const WRITES = new Set(['closure_submit', 'walkin_submit']);

const STAFF_PERM = {
    closure_ack: 'shop.update', closure_add: 'shop.update', walkin_add: 'visitor.create', walkin_decide: 'visitor.create', walkin_link: 'visitor.create',
    market_closure_add: 'shop.update', market_closure_cancel: 'shop.update', market_closure_list: 'shop.read',
} as const;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const body = (req.body ?? {}) as Body;
    const action = body.action;
    // a walk-in arriving by the market's scan link: the link says which market (it carries no ids of its own)
    if ((action === 'walkin_info' || action === 'walkin_submit') && body.link !== undefined) {
        const limited = await rateLimit(req, `market:${action}:link`, PUBLIC_LIMITS[action] * 2, 3600);
        if (!limited.ok) { res.setHeader?.('Retry-After', String(limited.retryAfterSec)); res.status(429).json({ error: 'too_many_requests', retry_after_sec: limited.retryAfterSec }); return; }
        const market = await resolveWalkInLink(body.link);
        if (!market) { res.status(404).json({ error: 'not_found' }); return; }
        body.owner_uid = market.owner_uid;
        body.building_id = market.building_id;
    }
    const buildingId = body.building_id;
    if (!buildingId || typeof buildingId !== 'string') { res.status(400).json({ error: 'building_id is required' }); return; }
    if (!action || (!PUBLIC.has(action) && !(action in STAFF_PERM))) { res.status(400).json({ error: 'unknown_action' }); return; }

    let owner: string;
    let staff: Awaited<ReturnType<typeof authorize>> = null;
    // the stall a closure is for: from the portal link for the public actions, from the request for staff
    let roomId = typeof body.room_id === 'string' ? body.room_id : '';
    if (PUBLIC.has(action)) {
        // counted first, so guessing links costs the same as any other public call
        const limited = await rateLimit(req, `market:${action}:${buildingId}`, PUBLIC_LIMITS[action], 3600);
        if (!limited.ok) { res.setHeader?.('Retry-After', String(limited.retryAfterSec)); res.status(429).json({ error: 'too_many_requests', retry_after_sec: limited.retryAfterSec }); return; }
        if (action.startsWith('closure_')) {
            const portal = await resolvePortalLink(body.portal);
            if (!portal || portal.buildingId !== buildingId) { res.status(401).json({ error: 'invalid_link' }); return; }
            owner = portal.ownerUid;
            roomId = portal.roomId;
        } else {
            if (typeof body.owner_uid !== 'string' || !body.owner_uid) { res.status(400).json({ error: 'invalid_input' }); return; }
            owner = body.owner_uid;
        }
        if (WRITES.has(action)) {
            // bots that fill the hidden field get a normal-looking answer and nothing is stored
            if (honeypotTripped(body.website)) { res.status(200).json({ ok: true, status: 'pending' }); return; }
            if (!(await verifyCaptcha(body.captcha_token, req))) { res.status(400).json({ error: 'captcha_failed' }); return; }
        }
        if (!(await buildingExists(owner, buildingId))) { res.status(404).json({ error: 'not_found' }); return; }
        const cfg = (await db.doc(`users/${owner}/buildings/${buildingId}/data/config`).get()).data();
        if (cfg?.building_type !== 'market') { res.status(404).json({ error: 'not_found' }); return; }
    } else {
        staff = await authorize(req, res, { ownerUid: body.owner_uid, buildingId, permission: STAFF_PERM[action as keyof typeof STAFF_PERM] });
        if (!staff) return;
        if (!(await buildingExists(staff.ownerUid, buildingId))) { res.status(404).json({ error: 'property_not_found' }); return; }
        owner = staff.ownerUid;
    }

    const base = `users/${owner}/buildings/${buildingId}`;
    const now = new Date();
    const nowIso = now.toISOString();
    const audit = (act: 'CREATE' | 'UPDATE', type: 'shop_closure' | 'walkin' | 'market_closure', id: string, label: string, extra: object = {}) => staff && writeAudit({
        ownerUid: owner, propertyId: buildingId, userId: staff.uid, userName: staff.displayName, role: staff.role,
        action: act, resourceType: type, resourceId: id, resourceLabel: label, req, ...extra,
    });

    // ── the whole market (or some zones) shut ───────────────────────────────
    if (action === 'market_closure_add' || action === 'market_closure_cancel' || action === 'market_closure_list') {
        const mcol = `${base}/market_closures`;
        if (action === 'market_closure_list') {
            const list = (await db.collection(mcol).get()).docs.map(d => d.data() as MarketClosure)
                .filter(c => c.status === 'active').sort((a, b) => b.from_date.localeCompare(a.from_date));
            res.status(200).json({ closures: list.slice(0, 200) });
            return;
        }
        if (action === 'market_closure_cancel') {
            if (typeof body.market_closure_id !== 'string' || !body.market_closure_id) { res.status(400).json({ error: 'invalid_input' }); return; }
            const ref = db.doc(`${mcol}/${body.market_closure_id}`);
            const snap = await ref.get();
            if (!snap.exists) { res.status(404).json({ error: 'not_found' }); return; }
            const c = snap.data() as MarketClosure;
            await ref.update({ status: 'cancelled' });
            await audit('UPDATE', 'market_closure', c.id, `ตลาดหยุด ${c.from_date} – ${c.to_date}`, { note: 'cancelled' });
            res.status(200).json({ ok: true });
            return;
        }
        const input = cleanMarketClosureInput(body as Record<string, unknown>, now);
        if (!input) { res.status(400).json({ error: 'invalid_input' }); return; }
        const closure: MarketClosure = { id: randomUUID(), ...input, status: 'active', created_at: nowIso, created_by: staff!.displayName };
        await db.doc(`${mcol}/${closure.id}`).set(closure);
        await audit('CREATE', 'market_closure', closure.id, `ตลาดหยุด ${input.from_date} – ${input.to_date} (${MARKET_CLOSURE_REASON_LABELS_TH[input.reason]})`);
        // tell the vendors of those zones on LINE, once per person, through the OA each of them registered with
        let sent = 0, failed = 0;
        if (body.notify_line === true) {
            const cfg = (await db.doc(`${base}/data/config`).get()).data();
            const market = cfg?.bill_customization?.dorm_name || 'ตลาด';
            const d = (s: string) => new Date(`${s}T00:00:00+07:00`).toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long' });
            const text = `📢 ประกาศจาก${market}\n\n${input.from_date === input.to_date ? `${d(input.from_date)}` : `${d(input.from_date)} ถึง ${d(input.to_date)}`} ตลาดหยุด${input.zones ? ` (${input.zones.join(', ')})` : ''}\nสาเหตุ: ${MARKET_CLOSURE_REASON_LABELS_TH[input.reason]}${input.note ? `\n${input.note}` : ''}\n\nวันดังกล่าวไม่มีการเก็บค่าแผงรายวันค่ะ`;
            const rooms = (await db.collection(`${base}/rooms`).get()).docs.map(r => r.data() as { line_user_id?: string; line_channel?: string; zone?: string; is_active?: boolean });
            const to = new Map<string, { line_channel?: string }>();
            for (const r of rooms) {
                if (!r.line_user_id || r.is_active === false) continue;
                if (input.zones && !input.zones.includes((r.zone ?? '').trim())) continue;
                if (!to.has(r.line_user_id)) to.set(r.line_user_id, r);
            }
            await runPooled([...to.entries()], 5, async ([lineUserId, room]) => {
                try { await linePush(lineUserId, [{ type: 'text', text }], await roomLineToken(room)); sent++; } catch { failed++; }
            });
            await db.doc(`${mcol}/${closure.id}`).update({ line_sent: sent, line_failed: failed });
        }
        res.status(200).json({ closure, line_sent: sent, line_failed: failed });
        return;
    }

    // ── stall closures ──────────────────────────────────────────────────────
    // closure_add: staff records a closure on a stall's behalf (already acknowledged)
    if (action === 'closure_submit' || action === 'closure_add' || action === 'closure_cancel' || action === 'closure_list') {
        if (!roomId) { res.status(400).json({ error: 'invalid_input' }); return; }
        const room = await db.doc(`${base}/rooms/${roomId}`).get();
        if (!room.exists) { res.status(404).json({ error: 'not_found' }); return; }
        const roomNumber = String((room.data() as { room_number?: string }).room_number ?? roomId);
        const col = `${base}/shop_closures`;
        const mine = async () => (await db.collection(col).where('room_id', '==', roomId).get()).docs.map(d => d.data() as ShopClosure);

        if (action === 'closure_list') {
            res.status(200).json({ closures: upcomingClosures(await mine(), todayTh(now)) });
            return;
        }
        if (action === 'closure_cancel') {
            if (typeof body.closure_id !== 'string' || !body.closure_id) { res.status(400).json({ error: 'invalid_input' }); return; }
            const ref = db.doc(`${col}/${body.closure_id}`);
            const snap = await ref.get();
            // a stall can only cancel its own closure
            if (!snap.exists || (snap.data() as ShopClosure).room_id !== roomId) { res.status(404).json({ error: 'not_found' }); return; }
            await ref.update({ status: 'cancelled' });
            res.status(200).json({ ok: true });
            return;
        }
        const input = cleanClosureInput(body, now);
        if (!input) { res.status(400).json({ error: 'invalid_input' }); return; }
        const existing = upcomingClosures(await mine(), todayTh(now));
        if (existing.length >= MAX_ACTIVE_CLOSURES_PER_ROOM) { res.status(409).json({ error: 'limit_reached' }); return; }
        if (existing.some(c => c.from_date <= input.to_date && input.from_date <= c.to_date)) { res.status(409).json({ error: 'overlaps_existing' }); return; }
        const closure: ShopClosure = {
            id: randomUUID(), room_id: roomId, room_number: roomNumber, ...input, status: 'active', created_at: nowIso,
            ...(staff ? { ack_at: nowIso, ack_by: staff.displayName } : {}),
        };
        await db.doc(`${col}/${closure.id}`).set(closure);
        if (staff) await audit('CREATE', 'shop_closure', closure.id, `แผง ${roomNumber} หยุด ${input.from_date}`);
        else await notify({
            event: 'shop.closure_submitted', ownerUid: owner, buildingId,
            data: { room_number: roomNumber, from_date: input.from_date, to_date: input.to_date, reason: CLOSURE_REASON_LABELS_TH[input.reason] },
        });
        res.status(200).json({ closure });
        return;
    }

    if (action === 'closure_ack') {
        if (typeof body.closure_id !== 'string' || !body.closure_id) { res.status(400).json({ error: 'invalid_input' }); return; }
        const ref = db.doc(`${base}/shop_closures/${body.closure_id}`);
        const snap = await ref.get();
        if (!snap.exists) { res.status(404).json({ error: 'not_found' }); return; }
        const c = snap.data() as ShopClosure;
        await ref.update({ ack_at: nowIso, ack_by: staff!.displayName });
        await audit('UPDATE', 'shop_closure', c.id, `แผง ${c.room_number} หยุด ${c.from_date}`, { note: 'acknowledged' });
        res.status(200).json({ ok: true });
        return;
    }

    // ── walk-in vendors ─────────────────────────────────────────────────────
    const col = `${base}/walk_ins`;

    // the form: the market's name and its lots, and how many already asked for each lot that day (no one's details)
    if (action === 'walkin_info') {
        const today = todayTh(now);
        const date = isValidDate(body.date) && body.date >= today && body.date <= addDays(today, WALKIN_MAX_DAYS_AHEAD) ? body.date : today;
        const [name, lots, sameDay] = await Promise.all([
            marketName(owner, buildingId), walkInLots(owner, buildingId),
            db.collection(col).where('date', '==', date).get().then(s => s.docs.map(d => d.data() as WalkIn)),
        ]);
        res.status(200).json({ market_name: name, date, lots, requested: Object.fromEntries(lotRequests(sameDay, date)) });
        return;
    }

    // staff: the market's scan link (made on first use); rotate = a new one, the old link stops working
    if (action === 'walkin_link') {
        const token = await walkInLinkToken(owner, buildingId, { rotate: body.rotate === true });
        if (body.rotate === true) await audit('UPDATE', 'walkin', 'walkin_link', 'ลิงก์ขาจร', { note: 'rotated' });
        res.status(200).json({ url: walkInPageUrl(token) });
        return;
    }

    if (action === 'walkin_decide') {
        if (typeof body.walkin_id !== 'string' || !body.walkin_id || (body.status !== 'approved' && body.status !== 'rejected')) { res.status(400).json({ error: 'invalid_input' }); return; }
        const ref = db.doc(`${col}/${body.walkin_id}`);
        const snap = await ref.get();
        if (!snap.exists) { res.status(404).json({ error: 'not_found' }); return; }
        const w = snap.data() as WalkIn;
        // the lot given: the one chosen by staff, else the one asked for; none = told at the market
        let lot = w.lot ?? w.preferred_lot ?? null;
        if (body.lot_room_id !== undefined) {
            if (body.lot_room_id === '' || body.lot_room_id === null) lot = null;
            else if (typeof body.lot_room_id !== 'string' || !(lot = await lotOf(owner, buildingId, body.lot_room_id))) { res.status(400).json({ error: 'invalid_lot' }); return; }
        }
        const decided: WalkIn = { ...w, status: body.status, decided_at: nowIso, decided_by: staff!.displayName, lot: body.status === 'approved' ? lot : null };
        await ref.update({ status: decided.status, decided_at: nowIso, decided_by: decided.decided_by, lot: decided.lot });
        await audit('UPDATE', 'walkin', w.id, `${w.name} ${w.date}`, { before: { status: w.status }, after: { status: body.status, lot: decided.lot?.room_number ?? null } });
        const notified = await notifyWalkInDecision(owner, buildingId, decided);
        if (notified) await ref.update({ line_notified_at: new Date().toISOString() });
        res.status(200).json({ ok: true, line_notified: notified });
        return;
    }

    // walkin_submit (public) | walkin_add (staff, already approved)
    const input = cleanWalkInInput(body, now);
    if (!input) { res.status(400).json({ error: 'invalid_input' }); return; }
    const sameDay = (await db.collection(col).where('date', '==', input.date).get()).docs.map(d => d.data() as WalkIn);
    if (sameDay.filter(w => w.status !== 'rejected').length >= WALKIN_MAX_PER_DAY) { res.status(409).json({ error: 'day_full' }); return; }
    // one live request per phone per day (a rejected one may be retried)
    if (sameDay.some(w => w.phone === input.phone && w.status !== 'rejected')) { res.status(409).json({ error: 'already_requested' }); return; }
    const isStaff = action === 'walkin_add';
    // the lot asked for must be one of this market's stalls; it is a wish, never a booking
    const { preferred_room_id: preferredId, ...fields } = input;
    const preferred = preferredId ? await lotOf(owner, buildingId, preferredId) : null;
    if (preferredId && !preferred) { res.status(400).json({ error: 'invalid_lot' }); return; }
    const code = isStaff ? undefined : newWalkInCode();
    const walkIn: WalkIn = {
        id: randomUUID(), ...fields, status: isStaff ? 'approved' : 'pending', source: isStaff ? 'staff' : 'public', created_at: nowIso,
        preferred_lot: preferred, ...(isStaff ? { lot: preferred, decided_at: nowIso, decided_by: staff!.displayName } : {}),
        ...(code ? { line_code: code } : {}),
    };
    await db.doc(`${col}/${walkIn.id}`).set(walkIn);
    if (code) await saveWalkInCode(code, owner, buildingId, walkIn);
    if (isStaff) await audit('CREATE', 'walkin', walkIn.id, `${walkIn.name} ${walkIn.date}`);
    else await notify({ event: 'visitor.arriving', ownerUid: owner, buildingId, data: { name: input.name, date: input.date, goods: input.goods, lot: preferred?.room_number ?? null } });
    if (isStaff) { res.status(200).json({ walk_in: walkIn }); return; }
    // the public caller learns that it was received and how to follow it on LINE — never other vendors' details
    const line = await walkInLineUrl(owner, buildingId, code!);
    res.status(200).json({ ok: true, status: walkIn.status, line_code: code, line_url: line?.url ?? null, oa_id: line?.oa_id ?? null, market_name: await marketName(owner, buildingId) });
}
