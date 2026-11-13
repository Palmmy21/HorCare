/**
 * หน้าเลือกสาขา — the figures on every branch card in one call (Branch Selector v2).
 *
 * POST /api/branches
 *   { action: 'summary', owner_uid }                → BranchSummaryResponse for every branch the caller may open
 *   { action: 'touch',   owner_uid, building_id }   → records that the caller just opened that branch (FR-03 / FR-07)
 *
 * Access is decided here, not by the page: the owner sees every branch, a member only the property_ids they were
 * granted, and revenue is sent only to callers with finance.read. The counted figures are cached per branch for
 * up to 5 minutes on the warm instance; the caller's own "last opened" times are always read fresh.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from './_firebase.js';
import { authorize, buildingExists } from './_rbac.js';
import { supabase, SupabaseNotConfigured } from './_supabase.js';
import { contractOccupancy, effectiveOccupancy, type LeaseFacts, type ProfileFacts, type ReservationFacts, type StatusOverride } from '../src/shared/roomOccupancy.js';
import {
    branchKind, isOverdueBill, monthRevenue, roomsBookedTonight, OPEN_REPAIR_STATUSES,
    type BillFacts, type BookingFacts, type BranchSummary, type BranchSummaryResponse,
} from '../src/shared/branchSummary.js';
import { todayTh } from '../src/shared/market.js';
import { errorInfo } from '../src/shared/errorInfo.js';

export const config = { maxDuration: 20 };

const CACHE_MS = 5 * 60_000;
/** How far back an unpaid bill still counts as overdue. */
const OVERDUE_LOOKBACK_MONTHS = 12;

type Counted = Omit<BranchSummary, 'lastAccessedAt'> & { revenueCollected: number; revenueExpected: number };
const cache = new Map<string, { at: number; value: Counted }>();

const accessDocId = (owner: string, buildingId: string) => `${owner}__${buildingId}`;

function monthsBack(today: string, n: number): string {
    const [y, m] = today.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 - n, 1));
    return d.toISOString().slice(0, 7);
}

interface OrgFacts { leases: LeaseFacts[]; reservations: ReservationFacts[]; bookings: (BookingFacts & { building_id: string })[] }

/** Leasing and bookings for the whole organisation in one round trip each; a module not set up contributes nothing. */
async function orgFacts(owner: string, buildingIds: string[], resortIds: string[], today: string): Promise<OrgFacts & { byBuilding: Map<string, { leases: (LeaseFacts & { building_id?: string })[]; reservations: (ReservationFacts & { building_id?: string })[] }> }> {
    const empty = { leases: [], reservations: [], bookings: [], byBuilding: new Map() };
    if (buildingIds.length === 0) return empty;
    try {
        const sb = supabase();
        const [leases, reservations, bookings] = await Promise.all([
            sb.from('leases').select('id, room_id, building_id, status, start_date, end_date').eq('owner_uid', owner).in('building_id', buildingIds).in('status', ['active', 'scheduled']),
            sb.from('leasing_reservations').select('id, room_id, building_id, status, reserved_until').eq('owner_uid', owner).in('building_id', buildingIds).eq('status', 'active'),
            resortIds.length
                ? sb.from('bookings').select('room_id, building_id, status, check_in, check_out').eq('owner_uid', owner).in('building_id', resortIds).lte('check_in', today).gt('check_out', today)
                : Promise.resolve({ data: [] as unknown[] }),
        ]);
        const l = (leases.data ?? []) as (LeaseFacts & { building_id: string })[];
        const r = (reservations.data ?? []) as (ReservationFacts & { building_id: string })[];
        const byBuilding = new Map<string, { leases: typeof l; reservations: typeof r }>();
        for (const id of buildingIds) byBuilding.set(id, { leases: l.filter(x => x.building_id === id), reservations: r.filter(x => x.building_id === id) });
        return { leases: l, reservations: r, bookings: (bookings.data ?? []) as OrgFacts['bookings'], byBuilding };
    } catch (err) {
        if (!(err instanceof SupabaseNotConfigured)) console.warn('branches: leasing/bookings unavailable:', errorInfo(err).message);
        return empty;
    }
}

async function countBranch(
    owner: string, buildingId: string, buildingType: string | undefined, today: string,
    facts: { leases: LeaseFacts[]; reservations: ReservationFacts[] }, bookings: BookingFacts[],
): Promise<Counted> {
    const base = `users/${owner}/buildings/${buildingId}`;
    const [roomsSnap, tenantsSnap, billsSnap, repairsSnap, cfgSnap] = await Promise.all([
        db.collection(`${base}/rooms`).get(),
        db.collection(`${base}/tenants`).get(),
        db.collection(`${base}/bills`).where('month', '>=', monthsBack(today, OVERDUE_LOOKBACK_MONTHS)).get(),
        db.collection(`${base}/maintenance`).where('status', 'in', [...OPEN_REPAIR_STATUSES]).get(),
        db.doc(`${base}/data/config`).get(),
    ]);

    const rooms = roomsSnap.docs.filter(d => d.data().is_active !== false);
    let occupied = 0;
    if (branchKind(buildingType) === 'resort') {
        const ids = new Set(rooms.map(d => d.id));
        occupied = roomsBookedTonight(bookings.filter(b => ids.has(b.room_id)), today);
    } else {
        const profiles = new Map(tenantsSnap.docs.map(d => [d.id, d.data() as ProfileFacts]));
        for (const doc of rooms) {
            const r = doc.data() as { room_status?: 'occupied' | 'vacant' | 'reserved'; status_override?: StatusOverride | null };
            const auto = contractOccupancy({
                leases: facts.leases.filter(l => l.room_id === doc.id),
                reservations: facts.reservations.filter(x => x.room_id === doc.id),
                profile: profiles.get(doc.id) ?? null,
                legacyStatus: r.room_status,
            }, today);
            if (effectiveOccupancy(auto, r.status_override).status === 'occupied') occupied++;
        }
    }

    const cfg = (cfgSnap.data() ?? {}) as { bill_customization?: { due_day?: number }; due_day?: number; late_fee?: { grace_days?: number } };
    const dueDay = Number(cfg.bill_customization?.due_day ?? cfg.due_day) || 5;
    const grace = Number(cfg.late_fee?.grace_days) || 0;
    const bills = billsSnap.docs.map(d => d.data() as BillFacts);
    const revenue = monthRevenue(bills, today.slice(0, 7));

    return {
        id: buildingId,
        unitsTotal: rooms.length,
        unitsOccupied: occupied,
        overdueInvoices: bills.filter(b => isOverdueBill(b, dueDay, grace, today)).length,
        openRepairs: repairsSnap.size,
        revenueCollected: revenue.collected,
        revenueExpected: revenue.expected,
    };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return; }
    const body = (req.body ?? {}) as { action?: string; owner_uid?: string; building_id?: string };

    if (body.action === 'touch') {
        const ctx = await authorize(req, res, { ownerUid: body.owner_uid, buildingId: body.building_id, permission: 'room.read' });
        if (!ctx) return;
        const buildingId = String(body.building_id ?? '');
        if (!buildingId || !(await buildingExists(ctx.ownerUid, buildingId))) { res.status(404).json({ error: 'not_found' }); return; }
        await db.doc(`users/${ctx.uid}/branch_access/${accessDocId(ctx.ownerUid, buildingId)}`)
            .set({ owner_uid: ctx.ownerUid, building_id: buildingId, at: new Date().toISOString() });
        res.status(200).json({ ok: true });
        return;
    }

    if (body.action !== 'summary') { res.status(400).json({ error: 'unknown_action' }); return; }
    const ctx = await authorize(req, res, { ownerUid: body.owner_uid, permission: 'room.read' });
    if (!ctx) return;
    const owner = ctx.ownerUid;

    const buildingsSnap = await db.collection(`users/${owner}/buildings`).get();
    const allowed = buildingsSnap.docs.filter(d => ctx.propertyIds.includes('*') || ctx.propertyIds.includes(d.id));
    const types = new Map(allowed.map(d => [d.id, d.data().building_type as string | undefined]));
    const ids = allowed.map(d => d.id);
    const today = todayTh();
    const canSeeFinance = ctx.permissions.includes('finance.read');

    // Last opened, per caller — never cached.
    const accessRefs = ids.map(id => db.doc(`users/${ctx.uid}/branch_access/${accessDocId(owner, id)}`));
    const accessSnaps = accessRefs.length ? await db.getAll(...accessRefs) : [];
    const lastAccess = new Map(accessSnaps.map((s, i) => [ids[i], (s.exists ? (s.data()?.at as string | undefined) : undefined) ?? null]));

    const now = Date.now();
    const stale = ids.filter(id => {
        const hit = cache.get(`${owner}/${id}`);
        return !hit || now - hit.at > CACHE_MS;
    });
    const resortIds = stale.filter(id => branchKind(types.get(id)) === 'resort');
    const facts = stale.length ? await orgFacts(owner, stale, resortIds, today) : null;

    const failed: string[] = [];
    await Promise.all(stale.map(async id => {
        try {
            const f = facts?.byBuilding.get(id) ?? { leases: [], reservations: [] };
            const bookings = (facts?.bookings ?? []).filter(b => b.building_id === id);
            const value = await countBranch(owner, id, types.get(id), today, f, bookings);
            cache.set(`${owner}/${id}`, { at: Date.now(), value });
        } catch (err) {
            console.error(`branches: counting ${id} failed:`, errorInfo(err).message);
            cache.delete(`${owner}/${id}`);
            failed.push(id);
        }
    }));

    const branches: BranchSummary[] = [];
    for (const id of ids) {
        const hit = cache.get(`${owner}/${id}`);
        if (!hit) continue;
        branches.push({
            ...hit.value,
            revenueCollected: canSeeFinance ? hit.value.revenueCollected : null,
            revenueExpected: canSeeFinance ? hit.value.revenueExpected : null,
            lastAccessedAt: lastAccess.get(id) ?? null,
        });
    }

    const out: BranchSummaryResponse & { failed: string[]; lastAccess: Record<string, string | null> } = {
        branches, canSeeFinance, generatedAt: new Date().toISOString(), failed,
        lastAccess: Object.fromEntries(ids.map(id => [id, lastAccess.get(id) ?? null])),
    };
    res.status(200).json(out);
}
