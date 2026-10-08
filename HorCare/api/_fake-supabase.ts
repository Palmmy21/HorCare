/**
 * In-memory stand-in for the slice of supabase-js the API uses, for tests.
 * Supports from().select/insert/update/delete with eq/neq/in/lt/lte/gt/gte filters, order, limit,
 * single/maybeSingle, partial unique indexes (error 23505) and the two leasing RPCs (same rules as the SQL).
 */
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Err = { code?: string; message: string } | null;
type Result = { data: any; error: Err }; // eslint-disable-line @typescript-eslint/no-explicit-any

interface Unique { table: string; name: string; key: (row: Row) => string | null }

const DEFAULTS: Record<string, () => Row> = {
    leasing_leads: () => ({ status: 'new', source: 'walk_in', phone: null, line_id: null, interested_room_id: null, budget_satang: null, target_move_in: null, lost_reason: null, note: null }),
    leasing_reservations: () => ({ status: 'active', deposit_satang: 0, cancel_reason: null }),
    leases: () => ({ status: 'active', deposit_satang: 0, tenant_phone: null, lead_id: null, reservation_id: null, renewal_of: null, ended_on: null, end_reason: null, note: null }),
};

const UNIQUES: Unique[] = [
    { table: 'leasing_reservations', name: 'leasing_one_active_reservation_per_room', key: r => (r.status === 'active' ? `${r.owner_uid}|${r.building_id}|${r.room_id}` : null) },
    { table: 'leases', name: 'leases_one_active_per_room', key: r => (r.status === 'active' ? `${r.owner_uid}|${r.building_id}|${r.room_id}` : null) },
];

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
        return fail('42883', `unknown function ${name}`);
    }

    insert(table: string, input: Row | Row[]): { data: Row[]; error: Err } {
        const out: Row[] = [];
        for (const r of Array.isArray(input) ? input : [input]) {
            const row: Row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...(DEFAULTS[table]?.() ?? {}), ...r };
            for (const u of UNIQUES.filter(x => x.table === table)) {
                const k = u.key(row);
                if (k !== null && this.rows(table).some(e => u.key(e) === k)) return { data: [], error: { code: '23505', message: `duplicate key value violates unique constraint "${u.name}"` } };
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
