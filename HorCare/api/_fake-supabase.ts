/**
 * In-memory stand-in for the slice of supabase-js the API uses, for tests.
 * Supports from().select/insert/update/delete with eq/neq/in/lt/lte/gt/gte filters, order, limit,
 * single/maybeSingle, partial unique indexes (error 23505), the booking exclusion constraint (23P01) and the RPCs of
 * the leasing and collections modules (same rules as the SQL, which api/_migrations.test.ts runs for real in PGlite).
 */
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Err = { code?: string; message: string } | null;
type Result = { data: any; error: Err }; // eslint-disable-line @typescript-eslint/no-explicit-any

interface Unique { table: string; name: string; key: (row: Row) => string | null }

const DEFAULTS: Record<string, () => Row> = {
    leasing_leads: () => ({ status: 'new', source: 'walk_in', phone: null, line_id: null, interested_room_id: null, budget_satang: null, target_move_in: null, lost_reason: null, note: null }),
    leasing_reservations: () => ({ status: 'active', deposit_satang: 0, cancel_reason: null }),
    leases: () => ({ status: 'active', deposit_satang: 0, tenant_phone: null, lead_id: null, reservation_id: null, renewal_of: null, ended_on: null, end_reason: null, note: null }),
    collection_rates: () => ({ scope: 'all', zone: null, room_id: null, valid_from: null, valid_to: null, priority: 0, active: true }),
    bookings: () => ({ status: 'reserved', adults: 1, guest_phone: null, charge_id: null, source: 'staff', notes: null }),
    stall_plans: () => ({ status: 'active', rate_satang: null, ends_on: null }),
    charges: () => ({ paid_satang: 0, status: 'open', room_id: null, room_number: null, party_phone: null, booking_id: null, description: '' }),
    charge_payments: () => ({ kind: 'payment', bank_account_id: null, note: null }),
};

const UNIQUES: Unique[] = [
    { table: 'leasing_reservations', name: 'leasing_one_active_reservation_per_room', key: r => (r.status === 'active' ? `${r.owner_uid}|${r.building_id}|${r.room_id}` : null) },
    { table: 'leases', name: 'leases_one_active_per_room', key: r => (r.status === 'active' ? `${r.owner_uid}|${r.building_id}|${r.room_id}` : null) },
    { table: 'stall_plans', name: 'stall_plans_one_active_per_room', key: r => (r.status === 'active' ? `${r.owner_uid}|${r.building_id}|${r.room_id}` : null) },
    { table: 'charges', name: 'charges_owner_uid_building_id_dedupe_key_key', key: r => `${r.owner_uid}|${r.building_id}|${r.dedupe_key}` },
    { table: 'day_closes', name: 'day_closes_owner_uid_building_id_close_date_key', key: r => `${r.owner_uid}|${r.building_id}|${r.close_date}` },
    { table: 'stall_attendance', name: 'stall_attendance_owner_uid_building_id_room_id_visit_date_key', key: r => `${r.owner_uid}|${r.building_id}|${r.room_id}|${r.visit_date}` },
];

const HOLDING = ['reserved', 'checked_in'];
/** bookings_no_double_booking: two holding stays of one room may not share a night (the check-out day is free). */
export function bookingsClash(a: Row, b: Row): boolean {
    return a.owner_uid === b.owner_uid && a.building_id === b.building_id && a.room_id === b.room_id
        && HOLDING.includes(a.status) && HOLDING.includes(b.status) && a.check_in < b.check_out && b.check_in < a.check_out;
}

export class FakeSupabase {
    tables = new Map<string, Row[]>();
    /** Set to make every call fail, to test error handling. */
    failWith: Err = null;

    reset() { this.tables.clear(); this.failWith = null; }
    rows(table: string): Row[] { if (!this.tables.has(table)) this.tables.set(table, []); return this.tables.get(table)!; }
    seed(table: string, row: Row) { this.rows(table).push({ ...(DEFAULTS[table]?.() ?? {}), created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...row }); }

    from(table: string) { return new Query(this, table); }

    async rpc(name: string, args: Row): Promise<Result> {
        if (this.failWith) return { data: null, error: this.failWith };
        const fail = (code: string, message: string): Result => ({ data: null, error: { code, message } });
        if (name === 'leasing_reserve') {
            const lead = this.rows('leasing_leads').find(l => l.id === args.p_lead && l.owner_uid === args.p_owner && l.building_id === args.p_building);
            if (!lead) return fail('P0002', 'lead_not_found');
            if (lead.status === 'won' || lead.status === 'lost') return fail('P0001', 'lead_closed');
            const ins = this.insert('leasing_reservations', {
                owner_uid: args.p_owner, building_id: args.p_building, lead_id: args.p_lead, room_id: args.p_room_id, room_number: args.p_room_number,
                deposit_satang: args.p_deposit, reserved_until: args.p_until, created_by: args.p_by,
            });
            if (ins.error) return { data: null, error: ins.error };
            lead.status = 'reserved'; lead.interested_room_id = args.p_room_id;
            return { data: ins.data[0], error: null };
        }
        if (name === 'leasing_convert_reservation') {
            const res = this.rows('leasing_reservations').find(r => r.id === args.p_reservation && r.owner_uid === args.p_owner && r.building_id === args.p_building);
            if (!res) return fail('P0002', 'reservation_not_found');
            if (res.status !== 'active') return fail('P0001', 'reservation_not_active');
            const ins = this.insert('leases', {
                owner_uid: args.p_owner, building_id: args.p_building, room_id: res.room_id, room_number: res.room_number, tenant_name: args.p_tenant_name,
                tenant_phone: args.p_tenant_phone, lead_id: res.lead_id, reservation_id: res.id, start_date: args.p_start, end_date: args.p_end,
                rent_satang: args.p_rent, deposit_satang: args.p_deposit, status: 'active', created_by: args.p_by,
            });
            if (ins.error) return { data: null, error: ins.error };
            res.status = 'converted';
            const lead = this.rows('leasing_leads').find(l => l.id === res.lead_id);
            if (lead) lead.status = 'won';
            return { data: ins.data[0], error: null };
        }
        if (name === 'collections_ensure_charge') {
            const existing = this.rows('charges').find(c => c.owner_uid === args.p_owner && c.building_id === args.p_building && c.dedupe_key === args.p_key);
            if (existing) return { data: { ...existing }, error: null };
            const ins = this.insert('charges', {
                owner_uid: args.p_owner, building_id: args.p_building, kind: args.p_kind, room_id: args.p_room_id, room_number: args.p_room_number, party_name: args.p_party,
                party_phone: args.p_phone, period_start: args.p_start, period_end: args.p_end, description: args.p_desc, amount_satang: args.p_amount, dedupe_key: args.p_key, created_by: args.p_by,
            });
            return ins.error ? { data: null, error: ins.error } : { data: ins.data[0], error: null };
        }
        if (name === 'collections_pay') return this.pay(args);
        if (name === 'stays_create_booking') {
            const ins = this.insert('bookings', {
                owner_uid: args.p_owner, building_id: args.p_building, room_id: args.p_room_id, room_number: args.p_room_number, guest_name: args.p_guest,
                guest_phone: args.p_phone, adults: args.p_adults, check_in: args.p_in, check_out: args.p_out, notes: args.p_notes, created_by: args.p_by,
            });
            if (ins.error) return { data: null, error: ins.error };
            const b = this.rows('bookings').find(x => x.id === ins.data[0].id)!;
            const last = new Date(`${args.p_out}T00:00:00Z`);
            last.setUTCDate(last.getUTCDate() - 1);
            const c = this.insert('charges', {
                owner_uid: args.p_owner, building_id: args.p_building, kind: 'stay', room_id: args.p_room_id, room_number: args.p_room_number, party_name: args.p_guest, party_phone: args.p_phone,
                booking_id: b.id, period_start: args.p_in, period_end: last.toISOString().slice(0, 10), description: `ค่าห้อง ${args.p_room_number} ${args.p_in} – ${args.p_out}`,
                amount_satang: args.p_total, dedupe_key: `stay:${b.id}`, created_by: args.p_by,
            }).data[0];
            b.charge_id = c.id;
            if (args.p_deposit > 0) {
                const paid = this.pay({ p_owner: args.p_owner, p_building: args.p_building, p_charge: c.id, p_amount: args.p_deposit, p_method: args.p_method, p_kind: 'deposit', p_bank: args.p_bank, p_note: null, p_by: args.p_by, p_by_name: args.p_by_name });
                if (paid.error) return { data: null, error: paid.error };
            }
            return { data: { ...b }, error: null };
        }
        if (name === 'stays_cancel_booking') {
            const b = this.rows('bookings').find(x => x.id === args.p_booking && x.owner_uid === args.p_owner && x.building_id === args.p_building);
            if (!b) return fail('P0002', 'booking_not_found');
            if (!HOLDING.includes(b.status)) return fail('P0001', 'cannot_cancel');
            const c = this.rows('charges').find(x => x.id === b.charge_id);
            if (c) {
                if (c.paid_satang > 0 && args.p_mode === 'void') return fail('P0001', 'has_payments');
                if (args.p_mode === 'refund' && c.paid_satang > 0) {
                    const r = this.pay({ p_owner: args.p_owner, p_building: args.p_building, p_charge: c.id, p_amount: -c.paid_satang, p_method: args.p_method, p_kind: 'refund', p_bank: args.p_bank, p_note: 'refund on cancellation', p_by: args.p_by, p_by_name: args.p_by_name });
                    if (r.error) return { data: null, error: r.error };
                    c.status = 'void';
                } else if (args.p_mode === 'forfeit' && c.paid_satang > 0) {
                    c.amount_satang = c.paid_satang;
                    c.status = 'paid';
                } else c.status = 'void';
            }
            b.status = 'cancelled';
            return { data: { ...b }, error: null };
        }
        return fail('42883', `unknown function ${name}`);
    }

    /** collections_pay: money in, or a refund, against a charge — never more than is owed. */
    pay(args: Row): Result {
        const fail = (code: string, message: string): Result => ({ data: null, error: { code, message } });
        const c = this.rows('charges').find(x => x.id === args.p_charge && x.owner_uid === args.p_owner && x.building_id === args.p_building);
        if (!c) return fail('P0002', 'charge_not_found');
        if (c.status === 'void') return fail('P0001', 'charge_void');
        if (args.p_kind === 'refund') {
            if (args.p_amount >= 0 || -args.p_amount > c.paid_satang) return fail('P0001', 'refund_exceeds_paid');
        } else {
            if (args.p_amount <= 0) return fail('P0001', 'invalid_amount');
            if (args.p_amount > c.amount_satang - c.paid_satang) return fail('P0001', 'exceeds_outstanding');
        }
        if (args.p_method === 'transfer' && !args.p_bank) return fail('23514', 'transfer needs a bank account');
        const ins = this.insert('charge_payments', {
            owner_uid: args.p_owner, building_id: args.p_building, charge_id: args.p_charge, amount_satang: args.p_amount, method: args.p_method, kind: args.p_kind,
            bank_account_id: args.p_bank ?? null, note: args.p_note ?? null, received_by: args.p_by, received_by_name: args.p_by_name, received_at: new Date().toISOString(),
        });
        c.paid_satang += args.p_amount;
        c.status = c.paid_satang >= c.amount_satang && c.amount_satang > 0 ? 'paid' : 'open';
        return { data: ins.data[0], error: null };
    }

    insert(table: string, input: Row | Row[]): { data: Row[]; error: Err } {
        const out: Row[] = [];
        for (const r of Array.isArray(input) ? input : [input]) {
            const row: Row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...(DEFAULTS[table]?.() ?? {}), ...r };
            for (const u of UNIQUES.filter(x => x.table === table)) {
                const k = u.key(row);
                if (k !== null && this.rows(table).some(e => u.key(e) === k)) return { data: [], error: { code: '23505', message: `duplicate key value violates unique constraint "${u.name}"` } };
            }
            if (table === 'bookings' && this.rows(table).some(e => bookingsClash(e, row))) {
                return { data: [], error: { code: '23P01', message: 'conflicting key value violates exclusion constraint "bookings_no_double_booking"' } };
            }
            this.rows(table).push(row);
            out.push(row);
        }
        return { data: out.map(r => ({ ...r })), error: null };
    }
}

type Filter = (r: Row) => boolean;

class Query implements PromiseLike<Result> {
    private op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    private payload: Row | Row[] = {};
    private filters: Filter[] = [];
    private orderBy: { col: string; asc: boolean }[] = [];
    private max: number | null = null;
    private returning = true;
    private mode: 'many' | 'single' | 'maybe' = 'many';

    constructor(private db: FakeSupabase, private table: string) {}

    select(_cols?: string) { void _cols; if (this.op !== 'select') this.returning = true; return this; }
    insert(row: Row | Row[]) { this.op = 'insert'; this.payload = row; this.returning = false; return this; }
    update(patch: Row) { this.op = 'update'; this.payload = patch; this.returning = false; return this; }
    delete() { this.op = 'delete'; this.returning = false; return this; }
    eq(col: string, val: unknown) { this.filters.push(r => r[col] === val); return this; }
    neq(col: string, val: unknown) { this.filters.push(r => r[col] !== val); return this; }
    in(col: string, vals: unknown[]) { this.filters.push(r => vals.includes(r[col])); return this; }
    lt(col: string, val: any) { this.filters.push(r => r[col] < val); return this; } // eslint-disable-line @typescript-eslint/no-explicit-any
    lte(col: string, val: any) { this.filters.push(r => r[col] <= val); return this; } // eslint-disable-line @typescript-eslint/no-explicit-any
    gt(col: string, val: any) { this.filters.push(r => r[col] > val); return this; } // eslint-disable-line @typescript-eslint/no-explicit-any
    gte(col: string, val: any) { this.filters.push(r => r[col] >= val); return this; } // eslint-disable-line @typescript-eslint/no-explicit-any
    order(col: string, opts?: { ascending?: boolean }) { this.orderBy.push({ col, asc: opts?.ascending !== false }); return this; }
    limit(n: number) { this.max = n; return this; }
    single() { this.mode = 'single'; return this; }
    maybeSingle() { this.mode = 'maybe'; return this; }

    private run(): Result {
        if (this.db.failWith) return { data: null, error: this.db.failWith };
        const match = (r: Row) => this.filters.every(f => f(r));
        let rows: Row[];
        if (this.op === 'insert') {
            const r = this.db.insert(this.table, this.payload);
            if (r.error) return { data: null, error: r.error };
            rows = r.data;
        } else if (this.op === 'update') {
            const hit = this.db.rows(this.table).filter(match);
            const after = hit.map(r => ({ ...r, ...(this.payload as Row), updated_at: new Date().toISOString() }));
            for (const u of UNIQUES.filter(x => x.table === this.table)) {
                const keys = after.map(u.key).filter((k): k is string => k !== null);
                const others = this.db.rows(this.table).filter(r => !hit.includes(r));
                if (keys.some(k => others.some(o => u.key(o) === k)) || new Set(keys).size !== keys.length) {
                    return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint "${u.name}"` } };
                }
            }
            hit.forEach((r, i) => Object.assign(r, after[i]));
            rows = hit.map(r => ({ ...r }));
        } else if (this.op === 'delete') {
            const all = this.db.rows(this.table);
            rows = all.filter(match);
            this.db.tables.set(this.table, all.filter(r => !rows.includes(r)));
        } else {
            rows = this.db.rows(this.table).filter(match).map(r => ({ ...r }));
        }
        for (const o of [...this.orderBy].reverse()) rows.sort((a, b) => (a[o.col] > b[o.col] ? 1 : a[o.col] < b[o.col] ? -1 : 0) * (o.asc ? 1 : -1));
        if (this.max !== null) rows = rows.slice(0, this.max);
        if (this.op !== 'select' && !this.returning) return { data: null, error: null };
        if (this.mode === 'many') return { data: rows, error: null };
        if (rows.length === 1) return { data: rows[0], error: null };
        if (rows.length === 0 && this.mode === 'maybe') return { data: null, error: null };
        return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
    }

    then<R1 = Result, R2 = never>(onfulfilled?: ((v: Result) => R1 | PromiseLike<R1>) | null, onrejected?: ((e: unknown) => R2 | PromiseLike<R2>) | null): PromiseLike<R1 | R2> {
        return Promise.resolve().then(() => this.run()).then(onfulfilled, onrejected);
    }
}
