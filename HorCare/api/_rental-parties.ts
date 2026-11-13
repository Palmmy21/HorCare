/**
 * /api/rental-parties — who else stands behind a room: subleases (เช่าช่วง) and unit owners (ซื้อแล้วปล่อยเช่า).
 * Rules in src/shared/rentalParties.ts. Stored in Firestore, written only here (the rules' catch-all denies clients):
 *
 *   users/{o}/buildings/{b}/subleases/{id}            under a lease (leases live in Supabase, checked here)
 *   users/{o}/buildings/{b}/unit_owners/{id}          an owner, their fee and rooms (a room belongs to one owner)
 *   users/{o}/buildings/{b}/unit_owner_payouts/{owner}_{month}   "paid the owner for that month"
 *   unit_owner_links/{sha256(token)}                  the owner's read-only summary link → owner / property / unit owner
 *
 * leasing.read:  list                               leasing.manage: sublease_create | sublease_end | owner_save |
 * finance.read:  statement                                          owner_rooms | owner_remove | owner_link
 * payment.reconcile: payout_mark | payout_undo      public (the link): summary
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { db } from './_firebase.js';
import { authorize, buildingExists } from './_rbac.js';
import { writeAudit } from './_audit.js';
import { rateLimit } from './_abuse-guard.js';
import { appBaseUrl } from './_app-url.js';
import { supabase, SupabaseNotConfigured } from './_supabase.js';
import { todayTh } from '../src/shared/market.js';
import {
    cleanSubleaseInput, cleanUnitOwnerInput, ownerStatement, recentMonths, subleaseProblem, subleaseTooLong,
    type StatementBill, type Sublease, type UnitOwner,
} from '../src/shared/rentalParties.js';
import type { Permission } from '../src/shared/permissions.js';

export const config = { maxDuration: 30 };

type Action = 'list' | 'sublease_create' | 'sublease_end' | 'owner_save' | 'owner_rooms' | 'owner_remove' | 'owner_link' | 'statement' | 'payout_mark' | 'payout_undo' | 'summary';
const PERMISSION: Record<Exclude<Action, 'summary'>, Permission> = {
    list: 'leasing.read', sublease_create: 'leasing.manage', sublease_end: 'leasing.manage', owner_save: 'leasing.manage', owner_rooms: 'leasing.manage',
    owner_remove: 'leasing.manage', owner_link: 'leasing.manage', statement: 'finance.read', payout_mark: 'payment.reconcile', payout_undo: 'payment.reconcile',
};
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const LINKS = 'unit_owner_links';
const SUMMARY_MONTHS = 6;

class HttpError extends Error { constructor(public status: number, public code: string) { super(code); } }

const base = (o: string, b: string) => `users/${o}/buildings/${b}`;
const publicOwner = (id: string, d: FirebaseFirestore.DocumentData): UnitOwner => ({
    id, name: d.name, phone: d.phone ?? null, payout_to: d.payout_to ?? null, fee_type: d.fee_type, fee_value: d.fee_value,
    room_ids: Array.isArray(d.room_ids) ? d.room_ids : [], note: d.note ?? null, has_link: !!d.link_hash, created_at: d.created_at, updated_at: d.updated_at,
});

/** The property's bills of these months (one equality query each: no index, nothing outside the months). */
async function billsFor(o: string, b: string, months: string[]): Promise<StatementBill[]> {
    const snaps = await Promise.all(months.map(m => db.collection(`${base(o, b)}/bills`).where('month', '==', m).get()));
    return snaps.flatMap(s => s.docs.map(d => d.data() as StatementBill));
}
async function roomsOf(o: string, b: string): Promise<{ id: string; room_number: string }[]> {
    return (await db.collection(`${base(o, b)}/rooms`).get()).docs.map(d => ({ id: d.id, room_number: String(d.data().room_number ?? d.id) }));
}

/** The read-only page a unit owner opens: their rooms (occupied or not), and what they were paid month by month. */
async function summary(req: VercelRequest, res: VercelResponse, token: unknown) {
    const limited = await rateLimit(req, 'unit_owner:summary', 120, 3600);
    if (!limited.ok) { res.status(429).json({ error: 'too_many_requests' }); return; }
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) { res.status(404).json({ error: 'not_found' }); return; }
    const link = (await db.doc(`${LINKS}/${sha256(token)}`).get()).data() as { owner_uid: string; building_id: string; unit_owner_id: string } | undefined;
    if (!link) { res.status(404).json({ error: 'not_found' }); return; }
    const ownerSnap = await db.doc(`${base(link.owner_uid, link.building_id)}/unit_owners/${link.unit_owner_id}`).get();
    if (!ownerSnap.exists) { res.status(404).json({ error: 'not_found' }); return; }
    const owner = publicOwner(ownerSnap.id, ownerSnap.data()!);

    const month = todayTh().slice(0, 7);
    const months = recentMonths(month, SUMMARY_MONTHS);
    const [rooms, bills, cfg, payouts] = await Promise.all([
        roomsOf(link.owner_uid, link.building_id),
        billsFor(link.owner_uid, link.building_id, months),
        db.doc(`${base(link.owner_uid, link.building_id)}/data/config`).get(),
        db.collection(`${base(link.owner_uid, link.building_id)}/unit_owner_payouts`).where('unit_owner_id', '==', owner.id).get(),
    ]);
    let vacant = new Set<string>();
    try {
        const { vacantRooms } = await import('./_listing.js');
        vacant = new Set((await vacantRooms(link.owner_uid, link.building_id, false)).map(r => r.id));
    } catch { /* occupancy unknown: shown as such */ }
    const paid = new Map(payouts.docs.map(d => [d.data().month as string, d.data() as { amount: number; paid_at: string }]));

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
        owner_name: owner.name,
        property: cfg.data()?.bill_customization?.dorm_name || '',
        fee: { type: owner.fee_type, value: owner.fee_value },
        // no tenant names: the owner sees whether the room is let and what it earns
        rooms: owner.room_ids.map(id => ({ room_number: rooms.find(r => r.id === id)?.room_number ?? '', occupied: !vacant.has(id) }))
            .sort((a, b) => a.room_number.localeCompare(b.room_number, 'th', { numeric: true })),
        months: months.map(m => {
            const s = ownerStatement(owner, rooms, bills, m);
            const p = paid.get(m);
            return { month: m, rent_collected: s.rent_collected, fee: s.fee, payout: s.payout, outstanding: s.outstanding, paid_amount: p?.amount ?? null, paid_at: p?.paid_at ?? null };
        }),
    });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return; }
    const body = (req.body ?? {}) as Record<string, unknown> & { action?: Action; owner_uid?: string; building_id?: string };
    const action = body.action;
    if (action === 'summary') { await summary(req, res, body.token); return; }
    if (!action || !(action in PERMISSION)) { res.status(400).json({ error: 'unknown_action' }); return; }
    const buildingId = typeof body.building_id === 'string' ? body.building_id : '';
    const ctx = await authorize(req, res, { ownerUid: body.owner_uid, buildingId, permission: PERMISSION[action] });
    if (!ctx) return;
    if (!buildingId || !(await buildingExists(ctx.ownerUid, buildingId))) { res.status(404).json({ error: 'property_not_found' }); return; }
    const o = ctx.ownerUid;
    const B = base(o, buildingId);
    const now = new Date().toISOString();
    const audit = (act: 'CREATE' | 'UPDATE' | 'DELETE', type: 'unit_owner' | 'sublease', id: string, label: string) => writeAudit({
        ownerUid: o, propertyId: buildingId, userId: ctx.uid, userName: ctx.displayName, role: ctx.role, action: act,
        resourceType: type, resourceId: id, resourceLabel: label, req,
    });
    const id = (v: unknown) => { if (typeof v !== 'string' || !ID_RE.test(v)) throw new HttpError(400, 'invalid_input'); return v; };
    const ownerRef = (v: unknown) => db.doc(`${B}/unit_owners/${id(v)}`);

    try {
        if (action === 'list') {
            const [subs, owners] = await Promise.all([db.collection(`${B}/subleases`).get(), db.collection(`${B}/unit_owners`).get()]);
            res.status(200).json({
                subleases: subs.docs.map(d => d.data() as Sublease).sort((a, b) => b.start_date.localeCompare(a.start_date)),
                owners: owners.docs.map(d => publicOwner(d.id, d.data())).sort((a, b) => a.name.localeCompare(b.name, 'th')),
            });
            return;
        }

        // ── subleases ─────────────────────────────────────────────────────────
        if (action === 'sublease_create') {
            const input = cleanSubleaseInput(body);
            if (!input || subleaseTooLong(input)) throw new HttpError(400, 'invalid_input');
            const leaseId = typeof body.lease_id === 'string' ? body.lease_id : '';
            const { data: lease, error } = await supabase().from('leases').select('*').eq('id', leaseId).eq('owner_uid', o).eq('building_id', buildingId).maybeSingle();
            if (error || !lease) throw new HttpError(404, 'lease_not_found');
            const others = (await db.collection(`${B}/subleases`).where('lease_id', '==', lease.id).get()).docs.map(d => d.data() as Sublease);
            const problem = subleaseProblem(lease, input, others);
            if (problem) throw new HttpError(409, problem);
            const sub: Sublease = {
                id: randomUUID(), lease_id: lease.id, room_id: lease.room_id, room_number: lease.room_number, master_tenant: lease.tenant_name,
                ...input, status: 'active', ended_on: null, created_at: now, created_by: ctx.displayName,
            };
            await db.doc(`${B}/subleases/${sub.id}`).set(sub);
            await audit('CREATE', 'sublease', sub.id, `Room ${sub.room_number} sublet by ${sub.master_tenant} to ${sub.tenant_name}`);
            res.status(200).json({ sublease: sub });
            return;
        }
        if (action === 'sublease_end') {
            const ref = db.doc(`${B}/subleases/${id(body.sublease_id)}`);
            const sub = (await ref.get()).data() as Sublease | undefined;
            if (!sub) throw new HttpError(404, 'not_found');
            if (sub.status !== 'active') throw new HttpError(409, 'not_active');
            const ended = todayTh();
            await ref.update({ status: 'ended', ended_on: ended, end_date: ended < sub.end_date ? ended : sub.end_date });
            await audit('UPDATE', 'sublease', sub.id, `Room ${sub.room_number} sublease ended`);
            res.status(200).json({ ok: true });
            return;
        }

        // ── unit owners ───────────────────────────────────────────────────────
        if (action === 'owner_save') {
            const input = cleanUnitOwnerInput(body);
            if (!input) throw new HttpError(400, 'invalid_input');
            if (body.owner_id) {
                const ref = ownerRef(body.owner_id);
                if (!(await ref.get()).exists) throw new HttpError(404, 'not_found');
                await ref.update({ ...input, updated_at: now });
                await audit('UPDATE', 'unit_owner', ref.id, input.name);
                res.status(200).json({ owner: publicOwner(ref.id, (await ref.get()).data()!) });
                return;
            }
            const ref = db.collection(`${B}/unit_owners`).doc();
            await ref.set({ ...input, room_ids: [], created_at: now, updated_at: now, created_by: ctx.displayName });
            await audit('CREATE', 'unit_owner', ref.id, input.name);
            res.status(200).json({ owner: publicOwner(ref.id, (await ref.get()).data()!) });
            return;
        }
        if (action === 'owner_rooms') {
            const ref = ownerRef(body.owner_id);
            if (!(await ref.get()).exists) throw new HttpError(404, 'not_found');
            const want = Array.isArray(body.room_ids) ? [...new Set(body.room_ids.filter((r): r is string => typeof r === 'string' && ID_RE.test(r)))] : null;
            if (!want || want.length > 200) throw new HttpError(400, 'invalid_input');
            const known = new Set((await roomsOf(o, buildingId)).map(r => r.id));
            const rooms = want.filter(r => known.has(r));
            // a room has one owner: taking it here releases it from anyone else
            const all = await db.collection(`${B}/unit_owners`).get();
            const batch = db.batch();
            for (const d of all.docs) {
                if (d.id === ref.id) continue;
                const theirs = (d.data().room_ids ?? []) as string[];
                const kept = theirs.filter(r => !rooms.includes(r));
                if (kept.length !== theirs.length) batch.update(d.ref, { room_ids: kept, updated_at: now });
            }
            batch.update(ref, { room_ids: rooms, updated_at: now });
            await batch.commit();
            await audit('UPDATE', 'unit_owner', ref.id, `${rooms.length} rooms`);
            res.status(200).json({ room_ids: rooms });
            return;
        }
        if (action === 'owner_remove') {
            const ref = ownerRef(body.owner_id);
            const d = (await ref.get()).data();
            if (!d) { res.status(200).json({ ok: true }); return; }
            if (d.link_hash) await db.doc(`${LINKS}/${d.link_hash}`).delete();
            await ref.delete();
            await audit('DELETE', 'unit_owner', ref.id, String(d.name));
            res.status(200).json({ ok: true });
            return;
        }
        if (action === 'owner_link') {
            const ref = ownerRef(body.owner_id);
            const d = (await ref.get()).data();
            if (!d) throw new HttpError(404, 'not_found');
            // a new link always replaces the old one: a forwarded link can be cut off
            if (d.link_hash) await db.doc(`${LINKS}/${d.link_hash}`).delete();
            const token = randomBytes(24).toString('base64url');
            const hash = sha256(token);
            await db.doc(`${LINKS}/${hash}`).set({ owner_uid: o, building_id: buildingId, unit_owner_id: ref.id, created_at: now });
            await ref.update({ link_hash: hash, updated_at: now });
            await audit('UPDATE', 'unit_owner', ref.id, 'summary link issued');
            res.status(200).json({ url: `${appBaseUrl()}/?unit=${token}` });
            return;
        }

        // ── statements & payouts ──────────────────────────────────────────────
        const month = typeof body.month === 'string' && MONTH_RE.test(body.month) ? body.month : null;
        if (!month) throw new HttpError(400, 'invalid_input');
        const ref = ownerRef(body.owner_id);
        const snap = await ref.get();
        if (!snap.exists) throw new HttpError(404, 'not_found');
        const owner = publicOwner(snap.id, snap.data()!);
        const payoutRef = db.doc(`${B}/unit_owner_payouts/${owner.id}_${month}`);

        if (action === 'statement') {
            const [rooms, bills, payout] = await Promise.all([roomsOf(o, buildingId), billsFor(o, buildingId, [month]), payoutRef.get()]);
            res.status(200).json({ statement: ownerStatement(owner, rooms, bills, month), payout: payout.exists ? payout.data() : null });
            return;
        }
        if (action === 'payout_mark') {
            const amount = typeof body.amount === 'number' && Number.isFinite(body.amount) && body.amount >= 0 && body.amount <= 100_000_000 ? Math.round(body.amount * 100) / 100 : null;
            if (amount === null) throw new HttpError(400, 'invalid_input');
            const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) : '';
            await payoutRef.set({ unit_owner_id: owner.id, month, amount, note, paid_at: now, paid_by: ctx.displayName });
            await audit('CREATE', 'unit_owner', owner.id, `paid ${amount} for ${month}`);
            res.status(200).json({ ok: true });
            return;
        }
        // payout_undo
        await payoutRef.delete();
        await audit('DELETE', 'unit_owner', owner.id, `payout ${month} undone`);
        res.status(200).json({ ok: true });
    } catch (e) {
        if (e instanceof SupabaseNotConfigured) { res.status(503).json({ error: 'supabase_not_configured' }); return; }
        if (e instanceof HttpError) { res.status(e.status).json({ error: e.code }); return; }
        throw e;
    }
}
