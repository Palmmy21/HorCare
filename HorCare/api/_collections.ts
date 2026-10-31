/**
 * /api/collections — daily / weekly collection for resorts, hotels and markets (data lives in Supabase).
 *
 * Every call checks the caller's role and property first (`authorize`), then uses the service-role client; every row
 * is scoped by owner_uid + building_id. Rooms / stalls, shop closures and bank accounts are validated against
 * Firestore, where they still live. The server is the only one that prices things: stay totals and stall charges are
 * computed here from the rates and plans, never taken from the browser (a manager may override a stay total).
 *
 * read:    snapshot | quote | finance_series (13 months of charges and receipts, for the owner's charts)
 * manage:  rate_save | plan_save | plan_end | charge_extra | charge_void | week_generate
 * collect: stall_charge | stall_attendance | walk_in_charge | charge_pay | charge_slip
 * booking: booking_create | booking_status | booking_cancel
 * close:   day_close
 *
 * Money recorded here is posted to the owner's ledger straight away (api/_ledger-auto.ts) when the property has one.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import { db, admin } from './_firebase.js';
import { effectiveLicense } from '../src/shared/trial.js';
import { authorize, buildingExists } from './_rbac.js';
import { writeAudit } from './_audit.js';
import { dbError, supabase, SupabaseNotConfigured } from './_supabase.js';
import { autoPostCharges } from './_ledger-auto.js';
import { evaluateSlip } from './_slip-flow.js';
import { compressSlipToDataUrl, decodeSlipQR, slipFingerprint } from './_slip.js';
import { addDays, daysBetween, isValidDate, todayTh, closuresOn, type ShopClosure } from '../src/shared/market.js';
import {
    bookingActionBlock, cleanBookingInput, cleanDayCloseInput, cleanPaymentInput, cleanPlanInput, cleanRateInput, dayTotals,
    outstanding, planOpenOn, quoteStay, resolveRate, stallWeekCharge, weekStart, UUID_RE, MAX_STAY_NIGHTS,
    type Booking, type Charge, type ChargePayment, type Rate, type StallPlan,
} from '../src/shared/collections.js';
import { cleanBaht } from '../src/shared/leasing.js';
import type { Permission } from '../src/shared/permissions.js';
import type { BankAccount } from '../src/shared/banks.js';

export const config = { maxDuration: 60 };

type Action =
    | 'snapshot' | 'quote' | 'rate_save' | 'plan_save' | 'plan_end' | 'charge_extra' | 'charge_void' | 'week_generate'
    | 'stall_charge' | 'stall_attendance' | 'walk_in_charge' | 'charge_pay' | 'charge_slip'
    | 'booking_create' | 'booking_status' | 'booking_cancel' | 'day_close' | 'finance_series';

const PERMISSION: Record<Action, Permission> = {
    snapshot: 'collections.read', quote: 'booking.read', finance_series: 'collections.read',
    rate_save: 'collections.manage', plan_save: 'collections.manage', plan_end: 'collections.manage', charge_extra: 'collections.manage',
    charge_void: 'collections.manage', week_generate: 'collections.collect',
    stall_charge: 'collections.collect', stall_attendance: 'collections.collect', walk_in_charge: 'collections.collect',
    charge_pay: 'collections.collect', charge_slip: 'collections.collect',
    booking_create: 'booking.manage', booking_status: 'booking.manage', booking_cancel: 'booking.manage',
    day_close: 'collections.close',
};
const ACTIONS = Object.keys(PERMISSION) as Action[];

const MAX_WINDOW_DAYS = 62;
const MAX_SLIP_CHARS = 8_000_000;
const SLIP_DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

class HttpError extends Error {
    constructor(public status: number, public code: string, public detail?: unknown) { super(code); }
}

type Body = Record<string, unknown> & { action?: Action; owner_uid?: string; building_id?: string };

const uuid = (v: unknown): string => {
    if (typeof v !== 'string' || !UUID_RE.test(v)) throw new HttpError(400, 'invalid_input');
    return v;
};
const text = (v: unknown, max: number, min = 0): string => {
    const t = typeof v === 'string' ? v.trim() : '';
    if (t.length < min || t.length > max) throw new HttpError(400, 'invalid_input');
    return t;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const body = (req.body ?? {}) as Body;
    const action = body.action;
    const buildingId = body.building_id;
    if (!action || !ACTIONS.includes(action)) { res.status(400).json({ error: 'unknown_action' }); return; }
    if (typeof buildingId !== 'string' || !buildingId) { res.status(400).json({ error: 'building_id is required' }); return; }

    const ctx = await authorize(req, res, { ownerUid: body.owner_uid, buildingId, permission: PERMISSION[action] });
    if (!ctx) return;
    if (!(await buildingExists(ctx.ownerUid, buildingId))) { res.status(404).json({ error: 'property_not_found' }); return; }

    const owner = ctx.ownerUid;
    const today = todayTh();
    const base = `users/${owner}/buildings/${buildingId}`;
    const scope = { owner_uid: owner, building_id: buildingId };
    const audit = (act: 'CREATE' | 'UPDATE', type: 'booking' | 'charge' | 'collection_rate' | 'stall_plan' | 'day_close', id: string, label: string, extra: object = {}) =>
        writeAudit({
            ownerUid: owner, propertyId: buildingId, userId: ctx.uid, userName: ctx.displayName, role: ctx.role,
            action: act, resourceType: type, resourceId: id, resourceLabel: label, req, ...extra,
        });

    try {
        const sb = supabase();
        const fail = (error: { code?: string; message?: string }): never => { const e = dbError(error); throw new HttpError(e.status, e.code); };

        // ── lookups ───────────────────────────────────────────────────────────
        interface RoomInfo { id: string; room_number: string; zone: string | null; is_active: boolean }
        const rooms = async (): Promise<RoomInfo[]> =>
            (await db.collection(`${base}/rooms`).get()).docs.map(d => {
                const r = d.data() as { room_number?: string; zone?: string; is_active?: boolean };
                return { id: d.id, room_number: String(r.room_number ?? d.id), zone: r.zone ?? null, is_active: r.is_active !== false };
            });
        const room = async (id: unknown): Promise<RoomInfo> => {
            if (typeof id !== 'string' || !id) throw new HttpError(400, 'invalid_input');
            const snap = await db.doc(`${base}/rooms/${id}`).get();
            const r = snap.data() as { room_number?: string; zone?: string; is_active?: boolean } | undefined;
            if (!snap.exists || r?.is_active === false) throw new HttpError(404, 'room_not_found');
            return { id, room_number: String(r?.room_number ?? id), zone: r?.zone ?? null, is_active: true };
        };
        const closures = async (): Promise<ShopClosure[]> =>
            (await db.collection(`${base}/shop_closures`).get()).docs.map(d => d.data() as ShopClosure);
        const activeBank = async (id: string): Promise<BankAccount> => {
            const snap = await db.doc(`${base}/bank_accounts/${id}`).get();
            const a = snap.data() as BankAccount | undefined;
            if (!snap.exists || a?.status !== 'active') throw new HttpError(400, 'bank_account_invalid');
            return a;
        };
        const rates = async (): Promise<Rate[]> => {
            const { data, error } = await sb.from('collection_rates').select('*').eq('owner_uid', owner).eq('building_id', buildingId).limit(1000);
            if (error) fail(error);
            return (data ?? []) as Rate[];
        };
        const one = async <T,>(table: string, id: string): Promise<T> => {
            const { data, error } = await sb.from(table).select('*').eq('id', id).eq('owner_uid', owner).eq('building_id', buildingId).maybeSingle();
            if (error) fail(error);
            if (!data) throw new HttpError(404, 'not_found');
            return data as T;
        };
        const activePlan = async (roomId: string): Promise<StallPlan | null> => {
            const { data, error } = await sb.from('stall_plans').select('*').eq('owner_uid', owner).eq('building_id', buildingId).eq('room_id', roomId).eq('status', 'active').maybeSingle();
            if (error) fail(error);
            return (data as StallPlan | null) ?? null;
        };
        /** Create the charge for a dedupe key, or return the one that already exists (so generating twice never double-charges). */
        const ensureCharge = async (c: { kind: Charge['kind']; room: RoomInfo | null; party: string; phone?: string | null; start: string; end: string; desc: string; amount: number; key: string }): Promise<Charge> => {
            const { data, error } = await sb.rpc('collections_ensure_charge', {
                p_owner: owner, p_building: buildingId, p_kind: c.kind, p_room_id: c.room?.id ?? null, p_room_number: c.room?.room_number ?? null, p_party: c.party,
                p_phone: c.phone ?? null, p_start: c.start, p_end: c.end, p_desc: c.desc, p_amount: c.amount, p_key: c.key, p_by: ctx.uid,
            });
            if (error) fail(error);
            return data as Charge;
        };
        const record = async (charge: Charge, p: { amount_satang: number; method: 'cash' | 'transfer'; bank: string | null; note: string | null; kind?: 'payment' | 'deposit' | 'refund' }): Promise<ChargePayment> => {
            if (p.method === 'transfer') await activeBank(p.bank!);
            const { data, error } = await sb.rpc('collections_pay', {
                p_owner: owner, p_building: buildingId, p_charge: charge.id, p_amount: p.amount_satang, p_method: p.method, p_kind: p.kind ?? 'payment',
                p_bank: p.bank, p_note: p.note, p_by: ctx.uid, p_by_name: ctx.displayName,
            });
            if (error) fail(error);
            return data as ChargePayment;
        };
        const post = () => autoPostCharges(owner, buildingId, { uid: ctx.uid, displayName: ctx.displayName });
        const window = () => {
            const from = body.from, to = body.to;
            if (!isValidDate(from) || !isValidDate(to) || to < from || daysBetween(from, to) > MAX_WINDOW_DAYS) throw new HttpError(400, 'invalid_input');
            return { from, to };
        };

        // ── snapshot ──────────────────────────────────────────────────────────
        if (action === 'snapshot') {
            const { from, to } = window();
            const pull = async (table: string, f: (q: ReturnType<typeof sb.from>) => unknown) => {
                const q = f(sb.from(table)) as PromiseLike<{ data: unknown[] | null; error: { code?: string; message?: string } | null }>;
                const { data, error } = await q;
                if (error) fail(error);
                return data ?? [];
            };
            const mine = (q: ReturnType<typeof sb.from>) => q.select('*').eq('owner_uid', owner).eq('building_id', buildingId);
            const [roomList, closureList, rateList, plans, bookings, chargesInWindow, chargesOpen, attendance, closes] = await Promise.all([
                rooms(), closures(), rates(),
                pull('stall_plans', q => mine(q).eq('status', 'active').limit(2000)),
                pull('bookings', q => mine(q).lte('check_in', to).gt('check_out', from).limit(3000)),
                pull('charges', q => mine(q).lte('period_start', to).gte('period_end', from).limit(5000)),
                pull('charges', q => mine(q).eq('status', 'open').limit(2000)),
                pull('stall_attendance', q => mine(q).gte('visit_date', from).lte('visit_date', to).limit(5000)),
                pull('day_closes', q => mine(q).gte('close_date', from).lte('close_date', to).limit(100)),
            ]);
            const byId = new Map<string, Charge>();
            for (const c of [...chargesInWindow, ...chargesOpen] as Charge[]) byId.set(c.id, c);
            const charges = [...byId.values()];
            const ids = charges.map(c => c.id);
            const payments = ids.length === 0 ? [] : await pull('charge_payments', q => mine(q).in('charge_id', ids).limit(10000));
            res.status(200).json({
                today,
                rooms: roomList.filter(r => r.is_active), closures: closureList.filter(c => c.status === 'active' && c.from_date <= to && c.to_date >= from),
                rates: rateList, plans, bookings, charges, payments, attendance, day_closes: closes,
            });
            return;
        }

        // ── finance_series: what the owner's charts are drawn from ───────────────
        if (action === 'finance_series') {
            const months = Math.min(24, Math.max(1, Number.isInteger(body.months) ? (body.months as number) : 13));
            const [y, m] = today.slice(0, 7).split('-').map(Number);
            const idx = y * 12 + (m - 1) - (months - 1);
            const from = `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-01`;
            const mine = (t: string) => sb.from(t).select('*').eq('owner_uid', owner).eq('building_id', buildingId);
            const [recent, open, pays] = await Promise.all([
                mine('charges').gte('period_start', from).limit(20000),
                mine('charges').eq('status', 'open').limit(5000),
                mine('charge_payments').gte('received_at', `${addDays(from, -1)}T00:00:00Z`).limit(50000),
            ]);
            for (const r of [recent, open, pays]) if (r.error) fail(r.error);
            const byId = new Map<string, Charge>();
            for (const c of [...(recent.data ?? []), ...(open.data ?? [])] as Charge[]) byId.set(c.id, c);
            const trim = (c: Charge) => ({ id: c.id, kind: c.kind, room_number: c.room_number, party_name: c.party_name, period_start: c.period_start, period_end: c.period_end, amount_satang: c.amount_satang, paid_satang: c.paid_satang, status: c.status });
            res.status(200).json({ from, charges: [...byId.values()].map(trim), payments: ((pays.data ?? []) as ChargePayment[]).map(p => ({ amount_satang: p.amount_satang, method: p.method, received_at: p.received_at })) });
            return;
        }

        // ── rates / plans (manager) ───────────────────────────────────────────
        if (action === 'rate_save') {
            const input = cleanRateInput(body);
            if (!input) throw new HttpError(400, 'invalid_input');
            if (input.scope === 'room') await room(input.room_id);
            if (typeof body.rate_id === 'string' && body.rate_id) {
                const id = uuid(body.rate_id);
                await one('collection_rates', id);
                const { data, error } = await sb.from('collection_rates').update(input).eq('id', id).eq('owner_uid', owner).eq('building_id', buildingId).select().single();
                if (error) fail(error);
                await audit('UPDATE', 'collection_rate', id, `${input.name} ${input.amount_satang / 100}`);
                res.status(200).json({ rate: data });
                return;
            }
            const { data, error } = await sb.from('collection_rates').insert({ ...scope, ...input }).select().single();
            if (error) fail(error);
            await audit('CREATE', 'collection_rate', (data as Rate).id, `${input.name} ${input.amount_satang / 100}`);
            res.status(200).json({ rate: data });
            return;
        }

        if (action === 'plan_save') {
            const input = cleanPlanInput(body);
            if (!input) throw new HttpError(400, 'invalid_input');
            const r = await room(input.room_id);
            const existing = await activePlan(r.id);
            const row = { ...input, room_number: r.room_number };
            const q = existing
                ? sb.from('stall_plans').update(row).eq('id', existing.id).eq('owner_uid', owner).eq('building_id', buildingId).select().single()
                : sb.from('stall_plans').insert({ ...scope, ...row, created_by: ctx.uid }).select().single();
            const { data, error } = await q;
            if (error) fail(error);
            await audit(existing ? 'UPDATE' : 'CREATE', 'stall_plan', (data as StallPlan).id, `${r.room_number} ${input.mode}`);
            res.status(200).json({ plan: data });
            return;
        }

        if (action === 'plan_end') {
            const plan = await one<StallPlan>('stall_plans', uuid(body.plan_id));
            const { data, error } = await sb.from('stall_plans').update({ status: 'ended', ends_on: today > plan.starts_on ? today : plan.starts_on })
                .eq('id', plan.id).eq('owner_uid', owner).eq('building_id', buildingId).eq('status', 'active').select().maybeSingle();
            if (error) fail(error);
            if (!data) throw new HttpError(409, 'plan_not_active');
            await audit('UPDATE', 'stall_plan', plan.id, `${plan.room_number} ended`);
            res.status(200).json({ plan: data });
            return;
        }

        // ── stall charges (market) ────────────────────────────────────────────
        /** The charge a stall owes for the day / week of `date`, created once (idempotent) from its plan and the rates. */
        const stallChargeFor = async (roomId: string, date: string, plan: StallPlan, rateList: Rate[], closureList: ShopClosure[], info: RoomInfo): Promise<Charge | null> => {
            const wk = weekStart(date);
            const dayRate = resolveRate(rateList, { purpose: 'stall', unit: 'day', roomId, zone: info.zone, date })?.amount_satang ?? null;
            const weekRate = resolveRate(rateList, { purpose: 'stall', unit: 'week', roomId, zone: info.zone, date: wk })?.amount_satang ?? null;
            if (plan.mode === 'weekly_advance') {
                const closed = new Set<string>();
                for (let i = 0; i < 7; i++) { const d = addDays(wk, i); if (closuresOn(closureList.filter(c => c.room_id === roomId), d).length) closed.add(d); }
                const w = stallWeekCharge(plan, wk, closed, dayRate, weekRate);
                if (w.days === 0 || w.amount_satang <= 0) return null;
                return ensureCharge({
                    kind: 'stall_week', room: info, party: `แผง ${info.room_number}`, start: w.dates[0], end: w.dates[w.dates.length - 1],
                    desc: `ค่าแผง ${info.room_number} สัปดาห์ ${wk} (${w.days} วัน)`, amount: w.amount_satang, key: `stall-week:${roomId}:${wk}`,
                });
            }
            if (!planOpenOn(plan, date) || closuresOn(closureList.filter(c => c.room_id === roomId), date).length) return null;
            const amount = plan.rate_satang ?? dayRate ?? 0;
            if (amount <= 0) return null;
            return ensureCharge({
                kind: 'stall_day', room: info, party: `แผง ${info.room_number}`, start: date, end: date,
                desc: `ค่าแผง ${info.room_number} วันที่ ${date}`, amount, key: `stall-day:${roomId}:${date}`,
            });
        };

        if (action === 'stall_charge' || action === 'stall_attendance') {
            const date = body.date;
            if (!isValidDate(date) || date > addDays(today, 7)) throw new HttpError(400, 'invalid_input');
            const info = await room(body.room_id);
            const plan = await activePlan(info.id);
            if (!plan) throw new HttpError(409, 'no_stall_plan');
            if (action === 'stall_attendance') {
                if (plan.mode !== 'daily_actual' || typeof body.present !== 'boolean') throw new HttpError(400, 'invalid_input');
                if (date > today) throw new HttpError(400, 'invalid_input');
                const { error } = await sb.from('stall_attendance').insert({ ...scope, room_id: info.id, visit_date: date, present: body.present, marked_by: ctx.uid });
                if (error?.code === '23505') {
                    const upd = await sb.from('stall_attendance').update({ present: body.present, marked_by: ctx.uid }).eq('owner_uid', owner).eq('building_id', buildingId).eq('room_id', info.id).eq('visit_date', date);
                    if (upd.error) fail(upd.error);
                } else if (error) fail(error);
                res.status(200).json({ ok: true });
                return;
            }
            const charge = await stallChargeFor(info.id, date, plan, await rates(), await closures(), info);
            if (!charge) throw new HttpError(409, 'nothing_to_collect');
            res.status(200).json({ charge });
            return;
        }

        if (action === 'week_generate') {
            const date = isValidDate(body.date) ? body.date : today;
            if (date > addDays(today, 14)) throw new HttpError(400, 'invalid_input');
            const { data: planRows, error } = await sb.from('stall_plans').select('*').eq('owner_uid', owner).eq('building_id', buildingId).eq('status', 'active').eq('mode', 'weekly_advance').limit(2000);
            if (error) fail(error);
            const [roomList, rateList, closureList] = await Promise.all([rooms(), rates(), closures()]);
            const infoOf = new Map(roomList.map(r => [r.id, r]));
            const wk = weekStart(date);
            const had = await sb.from('charges').select('dedupe_key').eq('owner_uid', owner).eq('building_id', buildingId).eq('kind', 'stall_week').gte('period_start', wk).lte('period_start', addDays(wk, 6)).limit(5000);
            if (had.error) fail(had.error);
            const existing = new Set(((had.data ?? []) as { dedupe_key: string }[]).map(x => x.dedupe_key));
            let created = 0;
            for (const plan of (planRows ?? []) as StallPlan[]) {
                const info = infoOf.get(plan.room_id);
                if (!info?.is_active) continue;
                const c = await stallChargeFor(plan.room_id, date, plan, rateList, closureList, info);
                if (c && !existing.has(c.dedupe_key)) created++;
            }
            res.status(200).json({ week_start: wk, created });
            return;
        }

        if (action === 'walk_in_charge') {
            const amount = cleanBaht(body.amount, 1_000_000);
            if (amount === undefined || amount === null || amount <= 0) throw new HttpError(400, 'invalid_input');
            const name = text(body.name, 100, 1);
            const date = isValidDate(body.date) ? body.date : today;
            if (date > today) throw new HttpError(400, 'invalid_input');
            const charge = await ensureCharge({
                kind: 'walk_in', room: null, party: name, phone: null, start: date, end: date, desc: `ค่าที่ขาจร ${name} ${date}`.slice(0, 300), amount, key: `walkin:${randomUUID()}`,
            });
            await audit('CREATE', 'charge', charge.id, `walk-in ${name} ${amount / 100}`);
            res.status(200).json({ charge });
            return;
        }

        if (action === 'charge_extra') {
            const amount = cleanBaht(body.amount, 10_000_000);
            if (amount === undefined || amount === null || amount <= 0) throw new HttpError(400, 'invalid_input');
            const desc = text(body.description, 300, 2);
            const info = typeof body.room_id === 'string' && body.room_id ? await room(body.room_id) : null;
            const party = text(body.party_name || (info ? `ห้อง ${info.room_number}` : ''), 100, 1);
            const date = isValidDate(body.date) ? body.date : today;
            const charge = await ensureCharge({ kind: 'extra', room: info, party, start: date, end: date, desc, amount, key: `extra:${randomUUID()}` });
            await audit('CREATE', 'charge', charge.id, `extra ${desc} ${amount / 100}`);
            res.status(200).json({ charge });
            return;
        }

        if (action === 'charge_void') {
            const charge = await one<Charge>('charges', uuid(body.charge_id));
            if (charge.paid_satang > 0) throw new HttpError(409, 'has_payments');
            if (charge.booking_id) throw new HttpError(409, 'cancel_the_booking_instead');
            const reason = text(body.reason, 300, 2);
            const { data, error } = await sb.from('charges').update({ status: 'void' }).eq('id', charge.id).eq('owner_uid', owner).eq('building_id', buildingId).eq('paid_satang', 0).select().maybeSingle();
            if (error) fail(error);
            if (!data) throw new HttpError(409, 'changed_meanwhile');
            await audit('UPDATE', 'charge', charge.id, `void: ${reason}`);
            res.status(200).json({ charge: data });
            return;
        }

        // ── payments ──────────────────────────────────────────────────────────
        if (action === 'charge_pay') {
            const input = cleanPaymentInput(body);
            if (!input) throw new HttpError(400, 'invalid_input');
            const charge = await one<Charge>('charges', uuid(body.charge_id));
            const pay = await record(charge, { amount_satang: input.amount_satang, method: input.method, bank: input.bank_account_id, note: input.note });
            await audit('UPDATE', 'charge', charge.id, `${input.method} ${input.amount_satang / 100}`);
            const posted = await post();
            res.status(200).json({ payment: pay, charge: await one<Charge>('charges', charge.id), posted });
            return;
        }

        if (action === 'charge_slip') {
            const charge = await one<Charge>('charges', uuid(body.charge_id));
            const left = outstanding(charge);
            if (left <= 0) throw new HttpError(409, 'nothing_to_collect');
            const image = typeof body.image === 'string' ? body.image : '';
            const m = image.length <= MAX_SLIP_CHARS ? image.match(SLIP_DATA_URL) : null;
            if (!m) throw new HttpError(400, 'invalid_image');
            const mimeType = m[1];
            const buf = Buffer.from(m[2], 'base64');

            const qr = await decodeSlipQR(buf);
            const fingerprint = qr.payload ? slipFingerprint(qr.payload) : null;
            if (fingerprint) {
                const dup = await sb.from('charge_payments').select('id').eq('owner_uid', owner).eq('building_id', buildingId).eq('slip_ref', fingerprint).limit(1);
                if (dup.error) fail(dup.error);
                if ((dup.data ?? []).length) throw new HttpError(409, 'duplicate_slip');
            }

            const ownerSnap = await db.collection('users').doc(ctx.ownerUid).get();
            const license = effectiveLicense(ownerSnap.data());
            const isPro = license === 'active' || /^(monthly|yearly)_(small|medium|large)$/.test(license);
            const evaluation = await evaluateSlip({
                ownerUid: owner, buildingId, imageBase64: m[2], mimeType, qrPayload: qr.payload, expectedAmount: left / 100, billCreatedAt: charge.created_at, isPro,
            });
            const matchedBank = typeof evaluation.fields.slip_account_id === 'string' ? evaluation.fields.slip_account_id : null;
            const slipDetails = { ...evaluation.details, checks: evaluation.verdict?.checks ?? null };

            // Reviewed by staff: they say how much and into which account, the slip is kept as evidence.
            const confirmed = body.confirm === true;
            const confirmBank = typeof body.bank_account_id === 'string' && body.bank_account_id ? body.bank_account_id : matchedBank;
            const confirmAmount = confirmed ? cleanBaht(body.amount ?? left / 100, 10_000_000) : null;

            let amount: number | null = null;
            let bank: string | null = null;
            if (evaluation.autoApprove && matchedBank) { amount = left; bank = matchedBank; }
            else if (confirmed && confirmAmount && confirmAmount > 0 && confirmAmount <= left && confirmBank) { amount = confirmAmount; bank = confirmBank; }

            if (amount === null || bank === null) {
                res.status(200).json({
                    recorded: false, needs_review: true, note: evaluation.verifyNote, ai_amount: evaluation.aiAmount,
                    details: evaluation.details, checks: evaluation.verdict?.checks ?? null, outstanding_satang: left, suggested_bank_account_id: matchedBank,
                });
                return;
            }

            const pay = await record(charge, { amount_satang: amount, method: 'transfer', bank, note: 'slip' });
            // evidence on the payment: what the AI read, and that it is a slip only — not yet matched to a bank statement line
            const stamp = await sb.from('charge_payments').update({ verification: 'unverified', slip_ref: fingerprint, slip_details: slipDetails }).eq('id', pay.id).eq('owner_uid', owner).eq('building_id', buildingId);
            if (stamp.error) console.error('slip evidence not stored', stamp.error);
            const shrunk = await compressSlipToDataUrl(buf);
            if (shrunk) {
                await db.doc(`${base}/slip_images/charge-pay-${pay.id}`).set({ data_url: shrunk, charge_id: charge.id, payment_id: pay.id, created_at: admin.firestore.FieldValue.serverTimestamp() });
            }
            await audit('UPDATE', 'charge', charge.id, `slip ${amount / 100} ${evaluation.autoApprove ? 'auto' : 'confirmed by staff'}`);
            const posted = await post();
            res.status(200).json({
                recorded: true, auto: evaluation.autoApprove, note: evaluation.verifyNote, payment: pay, charge: await one<Charge>('charges', charge.id), posted,
            });
            return;
        }

        // ── bookings (hotel / resort) ─────────────────────────────────────────
        if (action === 'quote') {
            const info = await room(body.room_id);
            const inD = body.check_in, outD = body.check_out;
            if (!isValidDate(inD) || !isValidDate(outD) || outD <= inD || daysBetween(inD, outD) > MAX_STAY_NIGHTS) throw new HttpError(400, 'invalid_input');
            const q = quoteStay(await rates(), { roomId: info.id, zone: info.zone, checkIn: inD, checkOut: outD });
            res.status(200).json({ quote: q });
            return;
        }

        if (action === 'booking_create') {
            const input = cleanBookingInput(body);
            if (!input) throw new HttpError(400, 'invalid_input');
            const info = await room(input.room_id);
            const q = quoteStay(await rates(), { roomId: info.id, zone: info.zone, checkIn: input.check_in, checkOut: input.check_out });
            let total = q.total_satang;
            if (q.missing.length) {
                // no rate for some nights: only a manager may set the price by hand
                const override = ctx.permissions.includes('collections.manage') ? cleanBaht(body.total, 100_000_000) : null;
                if (!override || override <= 0) throw new HttpError(409, 'no_rate', { missing: q.missing });
                total = override;
            } else if (body.total !== undefined && ctx.permissions.includes('collections.manage')) {
                const override = cleanBaht(body.total, 100_000_000);
                if (override === undefined || override === null || override <= 0) throw new HttpError(400, 'invalid_input');
                total = override;
            }
            if (input.deposit_satang > total) throw new HttpError(400, 'deposit_exceeds_total');
            const method = body.deposit_method === 'transfer' ? 'transfer' : 'cash';
            const bank = method === 'transfer' && typeof body.deposit_bank_account_id === 'string' ? body.deposit_bank_account_id : null;
            if (input.deposit_satang > 0 && method === 'transfer') { if (!bank) throw new HttpError(400, 'invalid_input'); await activeBank(bank); }
            const { data, error } = await sb.rpc('stays_create_booking', {
                p_owner: owner, p_building: buildingId, p_room_id: info.id, p_room_number: info.room_number, p_guest: input.guest_name, p_phone: input.guest_phone,
                p_adults: input.adults, p_in: input.check_in, p_out: input.check_out, p_notes: input.notes, p_total: total, p_deposit: input.deposit_satang,
                p_method: method, p_bank: bank, p_by: ctx.uid, p_by_name: ctx.displayName,
            });
            if (error) {
                if (error.code === '23P01') throw new HttpError(409, 'room_not_available');
                fail(error);
            }
            const booking = data as Booking;
            await audit('CREATE', 'booking', booking.id, `${info.room_number} ${input.check_in}..${input.check_out} ${total / 100}`);
            const posted = await post();
            res.status(200).json({ booking, total_satang: total, posted });
            return;
        }

        if (action === 'booking_status') {
            const booking = await one<Booking>('bookings', uuid(body.booking_id));
            const to = body.to;
            if (to !== 'check_in' && to !== 'check_out' && to !== 'no_show') throw new HttpError(400, 'invalid_input');
            const charge = booking.charge_id ? await one<Charge>('charges', booking.charge_id) : null;
            let next: Booking['status'];
            if (to === 'no_show') {
                if (booking.status !== 'reserved' || today < booking.check_in) throw new HttpError(409, 'not_allowed');
                next = 'no_show';
            } else {
                const block = bookingActionBlock(booking, to, today, charge ? outstanding(charge) : 0);
                if (block) throw new HttpError(409, block);
                next = to === 'check_in' ? 'checked_in' : 'checked_out';
            }
            const { data, error } = await sb.from('bookings').update({ status: next }).eq('id', booking.id).eq('owner_uid', owner).eq('building_id', buildingId).eq('status', booking.status).select().maybeSingle();
            if (error) fail(error);
            if (!data) throw new HttpError(409, 'changed_meanwhile');
            await audit('UPDATE', 'booking', booking.id, `${booking.status} → ${next}`);
            res.status(200).json({ booking: data });
            return;
        }

        if (action === 'booking_cancel') {
            const booking = await one<Booking>('bookings', uuid(body.booking_id));
            const mode = body.mode;
            if (mode !== 'void' && mode !== 'forfeit' && mode !== 'refund') throw new HttpError(400, 'invalid_input');
            const method = body.method === 'transfer' ? 'transfer' : 'cash';
            const bank = method === 'transfer' && typeof body.bank_account_id === 'string' ? body.bank_account_id : null;
            if (mode === 'refund' && method === 'transfer') { if (!bank) throw new HttpError(400, 'invalid_input'); await activeBank(bank); }
            const { data, error } = await sb.rpc('stays_cancel_booking', {
                p_owner: owner, p_building: buildingId, p_booking: booking.id, p_mode: mode, p_method: method, p_bank: bank, p_by: ctx.uid, p_by_name: ctx.displayName,
            });
            if (error) fail(error);
            await audit('UPDATE', 'booking', booking.id, `cancelled (${mode})`);
            res.status(200).json({ booking: data });
            return;
        }

        // ── end of day ────────────────────────────────────────────────────────
        if (action === 'day_close') {
            const input = cleanDayCloseInput(body);
            if (!input) throw new HttpError(400, 'invalid_input');
            const { data: pays, error: pe } = await sb.from('charge_payments').select('*').eq('owner_uid', owner).eq('building_id', buildingId)
                .gte('received_at', `${addDays(input.date, -1)}T00:00:00Z`).lte('received_at', `${addDays(input.date, 1)}T23:59:59Z`).limit(20000);
            if (pe) fail(pe);
            const totals = dayTotals((pays ?? []) as ChargePayment[], input.date);
            const row = {
                ...scope, close_date: input.date, expected_cash_satang: totals.cash_satang, counted_cash_satang: input.counted_cash_satang,
                transfer_satang: totals.transfer_satang, payments_count: totals.count, difference_satang: input.counted_cash_satang - totals.cash_satang,
                note: input.note, closed_by: ctx.uid, closed_by_name: ctx.displayName,
            };
            const { data, error } = await sb.from('day_closes').insert(row).select().single();
            if (error) {
                if (error.code === '23505') throw new HttpError(409, 'already_closed');
                fail(error);
            }
            await audit('CREATE', 'day_close', input.date, `cash ${totals.cash_satang / 100} counted ${input.counted_cash_satang / 100}`);
            res.status(200).json({ close: data });
            return;
        }
    } catch (e) {
        if (e instanceof HttpError) { res.status(e.status).json({ error: e.code, ...(e.detail ? { detail: e.detail } : {}) }); return; }
        if (e instanceof SupabaseNotConfigured) { res.status(503).json({ error: 'supabase_not_configured' }); return; }
        console.error('collections error', e);
        res.status(500).json({ error: 'internal_error' });
    }
}

