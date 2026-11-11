/**
 * /api/revenue-audit — ตรวจยอดรายได้ตลาด: what should have come in this month, what did, and where the difference went.
 *
 *   report { month: 'YYYY-MM', zone?: string }   finance.read
 *
 * Gathers everything the audit needs from where it lives — stalls, tenant profiles, monthly bills, stall closures, market
 * closures and walk-ins in Firestore; stall plans, round charges, payments, attendance and day closes (and leases) in
 * Supabase — and hands it to the pure engine in src/shared/revenueAudit.ts. The round data is optional: a property that
 * never set it up still gets its monthly stalls audited, and the report says the rest was not available.
 * Read-only: nothing is written.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from './_firebase.js';
import { authorize, buildingExists } from './_rbac.js';
import { supabase } from './_supabase.js';
import { toSatang } from '../src/shared/accounting.js';
import { addDays, todayTh, type MarketClosure, type ShopClosure, type WalkIn, MARKET_CLOSURE_REASON_LABELS_TH } from '../src/shared/market.js';
import { resolveRate, type Rate } from '../src/shared/collections.js';
import { contractOccupancy, effectiveOccupancy, type LeaseFacts, type ProfileFacts, type RoomStatus, type StatusOverride } from '../src/shared/roomOccupancy.js';
import {
    auditRevenue, monthDays,
    type AuditAttendance, type AuditBill, type AuditCharge, type AuditDayClose, type AuditInput, type AuditPayment, type AuditPlan, type AuditStall,
} from '../src/shared/revenueAudit.js';

export const config = { maxDuration: 60 };

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

interface RoomDoc {
    room_number?: string; zone?: string; is_active?: boolean; rent_amount?: number; room_status?: RoomStatus; status_override?: StatusOverride | null;
}
interface BillDoc {
    id?: string; room_id?: string; month?: string; is_saved?: boolean; room_rent?: number; total_bill?: number;
    adjustments?: { label?: string; amount?: number }[]; rent_prorate?: unknown; payment_status?: string;
    paid_amount?: number; allocated_satang?: number; slip_amount?: number; paid_method?: string;
}

/** The round data for the month, or null when it cannot be read (Supabase not set up, or not reachable). */
async function loadRound(owner: string, buildingId: string, month: string, from: string, to: string) {
    try {
        const sb = supabase();
        const mine = (t: string) => sb.from(t).select('*').eq('owner_uid', owner).eq('building_id', buildingId);
        // weekly charges start on a Monday that may be in the previous month
        const [plans, charges, attendance, closes, rates, leases] = await Promise.all([
            mine('stall_plans').limit(5000),
            mine('charges').gte('period_start', addDays(from, -6)).lte('period_start', to).limit(50000),
            mine('stall_attendance').gte('visit_date', from).lte('visit_date', to).limit(50000),
            mine('day_closes').gte('close_date', from).lte('close_date', to).limit(100),
            mine('collection_rates').limit(1000),
            mine('leases').limit(5000),
        ]);
        for (const r of [plans, charges, attendance, closes, rates]) if (r.error) throw new Error(r.error.message);
        const chargeRows = (charges.data ?? []) as (AuditCharge & { party_name?: string })[];
        const ids = chargeRows.map(c => c.id);
        const payments: AuditPayment[] = [];
        for (let i = 0; i < ids.length; i += 500) {
            const r = await mine('charge_payments').in('charge_id', ids.slice(i, i + 500)).limit(50000);
            if (r.error) throw new Error(r.error.message);
            payments.push(...((r.data ?? []) as AuditPayment[]));
        }
        return {
            plans: (plans.data ?? []) as (AuditPlan & { status: string; room_id: string })[],
            charges: chargeRows,
            payments,
            attendance: (attendance.data ?? []) as { room_id: string; visit_date: string; present: boolean; marked_by: string }[],
            closes: (closes.data ?? []) as { close_date: string; expected_cash_satang: number; counted_cash_satang: number; closed_by_name: string }[],
            rates: (rates.data ?? []) as Rate[],
            // leases are optional on their own: a property may use the round without the leasing module
            leases: leases.error ? [] : ((leases.data ?? []) as LeaseFacts[]),
        };
    } catch (err) {
        console.warn(`[revenue-audit] round data unavailable for ${month}:`, (err as Error).message);
        return null;
    }
}

export async function buildAuditInput(owner: string, buildingId: string, month: string, zone: string | null, today = todayTh()): Promise<AuditInput> {
    const base = `users/${owner}/buildings/${buildingId}`;
    const days = monthDays(month);
    const from = days[0], to = days[days.length - 1];
    const asOf = to < today ? to : today;

    const [roomsSnap, tenantsSnap, billsSnap, shopSnap, marketSnap, walkSnap, membersSnap, round] = await Promise.all([
        db.collection(`${base}/rooms`).get(),
        db.collection(`${base}/tenants`).get(),
        db.collection(`${base}/bills`).where('month', '==', month).get(),
        db.collection(`${base}/shop_closures`).get(),
        db.collection(`${base}/market_closures`).get(),
        db.collection(`${base}/walk_ins`).get(),
        db.collection(`users/${owner}/members`).get(),
        loadRound(owner, buildingId, month, from, to),
    ]);

    const profiles = new Map<string, ProfileFacts>();
    for (const d of tenantsSnap.docs) {
        const p = d.data() as ProfileFacts;
        profiles.set(d.id, { full_name: p.full_name, move_in_date: p.move_in_date, contract_end_date: p.contract_end_date, expected_move_out: p.expected_move_out, signed_contract: p.signed_contract });
    }
    const leasesOf = new Map<string, LeaseFacts[]>();
    for (const l of round?.leases ?? []) { const list = leasesOf.get(l.room_id) ?? []; list.push(l); leasesOf.set(l.room_id, list); }

    const stalls: AuditStall[] = [];
    for (const d of roomsSnap.docs) {
        const r = d.data() as RoomDoc;
        if (r.is_active === false) continue;
        const profile = profiles.get(d.id) ?? null;
        const occ = effectiveOccupancy(contractOccupancy({ leases: leasesOf.get(d.id), profile, legacyStatus: r.room_status }, asOf), r.status_override);
        stalls.push({
            id: d.id, number: String(r.room_number ?? d.id), zone: (r.zone ?? '').trim() || 'ไม่ระบุโซน',
            rent_satang: toSatang(Number(r.rent_amount) || 0), occupied: occ.status === 'occupied',
            tenant: profile?.full_name || leasesOf.get(d.id)?.find(l => l.status === 'active')?.tenant_name || null,
        });
    }

    // one line per stall: a stall may have more than one bill in a month (a rent-only bill, then the meters)
    const billOf = new Map<string, AuditBill>();
    for (const d of billsSnap.docs) {
        const b = d.data() as BillDoc;
        if (b.is_saved === false || !b.room_id) continue;
        const total = toSatang(Number(b.total_bill) || 0);
        const discounts = (b.adjustments ?? []).filter(a => (Number(a.amount) || 0) < 0);
        const status: AuditBill['status'] = b.payment_status === 'paid' ? 'paid' : b.payment_status === 'pending' ? 'pending' : 'unpaid';
        const allocated = typeof b.allocated_satang === 'number' ? b.allocated_satang : null;
        const paid = status === 'paid'
            ? (typeof b.paid_amount === 'number' ? toSatang(b.paid_amount) : allocated ?? total)
            : (allocated ?? 0);
        const line: AuditBill = {
            id: d.id, room_id: b.room_id, rent_satang: toSatang(Number(b.room_rent) || 0), total_satang: total,
            discount_satang: discounts.reduce((t, a) => t + toSatang(-Number(a.amount)), 0),
            discount_labels: discounts.map(a => String(a.label ?? 'ส่วนลด')).slice(0, 5),
            prorated: !!b.rent_prorate, status, paid_satang: paid,
            pending_slip_satang: status === 'pending' ? toSatang(Number(b.slip_amount) || Number(b.total_bill) || 0) : 0,
            paid_method: b.paid_method ?? null,
        };
        const prev = billOf.get(b.room_id);
        billOf.set(b.room_id, prev ? {
            ...prev,
            rent_satang: prev.rent_satang + line.rent_satang, total_satang: prev.total_satang + line.total_satang,
            discount_satang: prev.discount_satang + line.discount_satang, discount_labels: [...prev.discount_labels, ...line.discount_labels].slice(0, 5),
            prorated: prev.prorated || line.prorated, paid_satang: prev.paid_satang + line.paid_satang,
            pending_slip_satang: prev.pending_slip_satang + line.pending_slip_satang,
            status: prev.status === 'paid' && line.status === 'paid' ? 'paid' : prev.status === 'pending' || line.status === 'pending' ? 'pending' : 'unpaid',
        } : line);
    }

    const nameOf = new Map<string, string>();
    nameOf.set(owner, 'เจ้าของ');
    for (const d of membersSnap.docs) {
        const m = d.data() as { display_name?: string; email?: string };
        nameOf.set(d.id, m.display_name || m.email || d.id.slice(0, 6));
    }

    const stallZone = new Map(stalls.map(s => [s.id, s.zone]));
    const plans: AuditPlan[] = [];
    if (round) {
        // the plan in force during the month (an ended plan still counts for the days it ran)
        for (const p of round.plans) {
            if (p.starts_on > to || (p.ends_on && p.ends_on < from)) continue;
            const fallback = p.unit === 'day' && p.rate_satang === null
                ? resolveRate(round.rates, { purpose: 'stall', unit: 'day', roomId: p.room_id, zone: stallZone.get(p.room_id) ?? null, date: from })?.amount_satang ?? null
                : null;
            plans.push({ room_id: p.room_id, mode: p.mode, unit: p.unit, rate_satang: p.rate_satang, fallback_day_satang: fallback, open_days: p.open_days, starts_on: p.starts_on, ends_on: p.status === 'ended' && !p.ends_on ? from : p.ends_on });
        }
    }

    const walkInsByDay = new Map<string, { approved: number; charged: number }>();
    for (const d of walkSnap.docs) {
        const w = d.data() as WalkIn;
        if (w.status !== 'approved' || w.date < from || w.date > to) continue;
        const e = walkInsByDay.get(w.date) ?? { approved: 0, charged: 0 };
        e.approved++;
        walkInsByDay.set(w.date, e);
    }
    for (const c of round?.charges ?? []) {
        if (c.kind !== 'walk_in' || c.status === 'void' || c.period_start < from || c.period_start > to) continue;
        const e = walkInsByDay.get(c.period_start) ?? { approved: 0, charged: 0 };
        e.charged++;
        walkInsByDay.set(c.period_start, e);
    }

    return {
        month, today, zone, stalls,
        bills: [...billOf.values()],
        plans,
        charges: (round?.charges ?? []).map(c => ({ id: c.id, kind: c.kind, room_id: c.room_id, period_start: c.period_start, period_end: c.period_end, amount_satang: Number(c.amount_satang), paid_satang: Number(c.paid_satang), status: c.status })),
        payments: (round?.payments ?? []).map(p => ({ ...p, amount_satang: Number(p.amount_satang) })),
        attendance: (round?.attendance ?? []).map((a): AuditAttendance => ({ room_id: a.room_id, visit_date: a.visit_date, present: a.present, marked_by_name: nameOf.get(a.marked_by) ?? 'ไม่ทราบชื่อ' })),
        day_closes: (round?.closes ?? []).map((c): AuditDayClose => ({ close_date: c.close_date, expected_cash_satang: Number(c.expected_cash_satang), counted_cash_satang: Number(c.counted_cash_satang), closed_by_name: c.closed_by_name })),
        vendor_closures: shopSnap.docs.map(d => d.data() as ShopClosure).map(c => ({ room_id: c.room_id, from_date: c.from_date, to_date: c.to_date, status: c.status })),
        market_closures: marketSnap.docs.map(d => d.data() as MarketClosure).filter(c => c.status === 'active')
            .map(c => ({ from_date: c.from_date, to_date: c.to_date, zones: c.zones, waive_rent: c.waive_rent, reason_label: MARKET_CLOSURE_REASON_LABELS_TH[c.reason] ?? c.reason })),
        walk_ins: [...walkInsByDay.entries()].map(([date, e]) => ({ date, ...e })),
        collections_available: !!round,
    };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const body = (req.body ?? {}) as { action?: string; owner_uid?: string; building_id?: string; month?: unknown; zone?: unknown };
    const buildingId = body.building_id;
    if (!buildingId || typeof buildingId !== 'string') { res.status(400).json({ error: 'building_id is required' }); return; }
    if (body.action !== 'report') { res.status(400).json({ error: 'unknown_action' }); return; }
    if (typeof body.month !== 'string' || !MONTH_RE.test(body.month)) { res.status(400).json({ error: 'invalid_input' }); return; }
    const zone = body.zone === undefined || body.zone === null || body.zone === '' ? null : typeof body.zone === 'string' && body.zone.length <= 60 ? body.zone : undefined;
    if (zone === undefined) { res.status(400).json({ error: 'invalid_input' }); return; }
    // a month that has not started has nothing to audit
    if (body.month > todayTh().slice(0, 7)) { res.status(400).json({ error: 'future_month' }); return; }

    const ctx = await authorize(req, res, { ownerUid: body.owner_uid, buildingId, permission: 'finance.read' });
    if (!ctx) return;
    if (!(await buildingExists(ctx.ownerUid, buildingId))) { res.status(404).json({ error: 'property_not_found' }); return; }

    try {
        const input = await buildAuditInput(ctx.ownerUid, buildingId, body.month, zone);
        const report = auditRevenue(input);
        // the zone list comes from the whole market, so the filter can always go back to "every zone"
        const zones = [...new Set(input.stalls.map(s => s.zone))].sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
        res.status(200).json({ report, zones });
    } catch (err) {
        console.error('[revenue-audit] failed:', err);
        res.status(500).json({ error: 'internal_error' });
    }
}
