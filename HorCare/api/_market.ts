/**
 * /api/market — shop closures ("แจ้งหยุด") and walk-in vendors ("ขาจร").
 *
 * Public (no login — they come from the stall's portal link / the market's walk-in link, like the
 * parcels and announcements portal reads), so each one proves the property is a market and the stall
 * exists, validates strictly, and is capped:
 *   closure_submit | closure_cancel | closure_list | walkin_submit
 * Staff (signed in, property-checked):
 *   closure_ack / closure_add – shop.update     walkin_decide / walkin_add – visitor.create
 * Reading the lists is straight from Firestore under rules needing shop.read / visitor.read.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import { db } from './_firebase.js';
import { authorize, buildingExists } from './_rbac.js';
import { writeAudit } from './_audit.js';
import { notify } from './_notify.js';
import { honeypotTripped, rateLimit, verifyCaptcha } from './_abuse-guard.js';
import { resolvePortalLink } from './_portal-link.js';
import {
    CLOSURE_REASON_LABELS_TH, MAX_ACTIVE_CLOSURES_PER_ROOM, WALKIN_MAX_PER_DAY,
    cleanClosureInput, cleanWalkInInput, todayTh, upcomingClosures,
    type ShopClosure, type WalkIn,
} from '../src/shared/market.js';

export const config = { maxDuration: 15 };

interface Body {
    action?: 'closure_submit' | 'closure_cancel' | 'closure_list' | 'closure_ack' | 'closure_add' | 'walkin_submit' | 'walkin_add' | 'walkin_decide';
    owner_uid?: string;
    building_id?: string;
    room_id?: string;
    closure_id?: string;
    walkin_id?: string;
    status?: string;
    from_date?: unknown; to_date?: unknown; reason?: unknown; note?: unknown;
    date?: unknown; name?: unknown; phone?: unknown; goods?: unknown;
    /** Hidden field: a person never fills it in. */
    website?: unknown;
    /** Cloudflare Turnstile token (only checked when TURNSTILE_SECRET is set). */
    captcha_token?: unknown;
    /** closure_submit / closure_cancel / closure_list: the stall's portal link (proves which stall this is). */
    portal?: unknown;
}

const PUBLIC = new Set(['closure_submit', 'closure_cancel', 'closure_list', 'walkin_submit']);
/** Calls per visitor per hour, by public action: writes are tight, reads are loose. */
const PUBLIC_LIMITS: Record<string, number> = { closure_submit: 10, walkin_submit: 5, closure_cancel: 30, closure_list: 120 };
const WRITES = new Set(['closure_submit', 'walkin_submit']);

const STAFF_PERM = { closure_ack: 'shop.update', closure_add: 'shop.update', walkin_add: 'visitor.create', walkin_decide: 'visitor.create' } as const;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const body = (req.body ?? {}) as Body;
    const buildingId = body.building_id;
    const action = body.action;
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
    const audit = (act: 'CREATE' | 'UPDATE', type: 'shop_closure' | 'walkin', id: string, label: string, extra: object = {}) => staff && writeAudit({
        ownerUid: owner, propertyId: buildingId, userId: staff.uid, userName: staff.displayName, role: staff.role,
        action: act, resourceType: type, resourceId: id, resourceLabel: label, req, ...extra,
    });

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
    if (action === 'walkin_decide') {
        if (typeof body.walkin_id !== 'string' || !body.walkin_id || (body.status !== 'approved' && body.status !== 'rejected')) { res.status(400).json({ error: 'invalid_input' }); return; }
        const ref = db.doc(`${col}/${body.walkin_id}`);
        const snap = await ref.get();
        if (!snap.exists) { res.status(404).json({ error: 'not_found' }); return; }
        const w = snap.data() as WalkIn;
        await ref.update({ status: body.status, decided_at: nowIso, decided_by: staff!.displayName });
        await audit('UPDATE', 'walkin', w.id, `${w.name} ${w.date}`, { before: { status: w.status }, after: { status: body.status } });
        res.status(200).json({ ok: true });
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
    const walkIn: WalkIn = {
        id: randomUUID(), ...input, status: isStaff ? 'approved' : 'pending', source: isStaff ? 'staff' : 'public', created_at: nowIso,
        ...(isStaff ? { decided_at: nowIso, decided_by: staff!.displayName } : {}),
    };
    await db.doc(`${col}/${walkIn.id}`).set(walkIn);
    if (isStaff) await audit('CREATE', 'walkin', walkIn.id, `${walkIn.name} ${walkIn.date}`);
    else await notify({ event: 'visitor.arriving', ownerUid: owner, buildingId, data: { name: input.name, date: input.date, goods: input.goods } });
    // the public caller only learns that it was received, never other vendors' details
    res.status(200).json(isStaff ? { walk_in: walkIn } : { ok: true, status: walkIn.status });
}
