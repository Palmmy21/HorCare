// @vitest-environment node
// The R0/R1 core schema (supabase/migrations/20261020000000_core_billing.sql) against real Postgres (PGlite):
// the money and occupancy rules are enforced by the database, so they are tested there.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { beforeAll, describe, expect, it } from 'vitest';

let pg: PGlite;
const O = 'owner-1', B = 'bld-1';

beforeAll(async () => {
    pg = await PGlite.create({ extensions: { btree_gist, pgcrypto } });
    await pg.exec(`create role anon; create role authenticated; create role service_role;`);
    const dir = join(process.cwd(), 'supabase', 'migrations');
    for (const f of readdirSync(dir).filter(n => n.endsWith('.sql')).sort()) await pg.exec(readFileSync(join(dir, f), 'utf8'));
}, 60_000);

const q =async <T = Record<string, any>>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows;
const fails = async (sql: string, params: unknown[] = []) => { try { await pg.query(sql, params); } catch (e) { return e as { code?: string; message: string }; } throw new Error('expected an error'); };

const party = async (name = 'สมชาย ใจดี') => (await q<{ id: string }>(`insert into parties (owner_uid, display_name, phone, created_by) values ($1,$2,'0812345678','u') returning id`, [O, name]))[0].id;
const lease = async (room: string, status = 'active') => (await q<{ id: string }>(
    `insert into leases (owner_uid,building_id,room_id,room_number,tenant_name,start_date,end_date,rent_satang,status,created_by)
     values ($1,$2,$3,$3,'ผู้เช่า ทดสอบ','2026-01-01','2027-01-01',350000,$4,'u') returning id`, [O, B, room, status]))[0].id;

/** A draft invoice with the given line amounts (satang). */
async function draft(room: string, period: string, amounts: number[], source?: [string, string]) {
    const inv = (await q<{ id: string }>(`insert into invoices (owner_uid,building_id,room_id,room_number,period,dedupe_key,created_by) values ($1,$2,$3,$3,$4,$5,'u') returning id`,
        [O, B, room, period, `regular:${room}:${period}`]))[0].id;
    for (const [i, a] of amounts.entries()) {
        const src = i === 0 && source ? source : [null, null];
        await q(`insert into invoice_lines (owner_uid,building_id,invoice_id,kind,description,amount_satang,source_type,source_id,sort) values ($1,$2,$3,'rent','ค่าเช่า',$4,$5,$6,$7)`, [O, B, inv, a, src[0], src[1], i]);
    }
    return inv;
}
async function issue(inv: string) {
    const v = (await q<{ version: number }>(`select version from invoices where id=$1`, [inv]))[0].version;
    await q(`select * from billing_approve_invoice($1,$2,$3,'u',$4)`, [O, B, inv, v]);
    await q(`select * from billing_issue_invoice($1,$2,$3,'u','2026-10-01','2026-10-05',null)`, [O, B, inv]);
}
async function pay(amount: number, status: 'confirmed' | 'pending_verification' = 'confirmed', ref: string | null = null, method = 'cash') {
    const id = (await q<{ id: string }>(`insert into payments (owner_uid,building_id,method,amount_satang,received_on,reference,bank_account_id,received_by) values ($1,$2,$3,$4,'2026-10-03',$5,$6,'u') returning id`,
        [O, B, method, amount, ref, method === 'transfer' ? 'acc1' : null]))[0].id;
    if (status === 'confirmed') await q(`select * from billing_set_payment_status($1,$2,$3,'confirmed','u',null)`, [O, B, id]);
    return id;
}
const balance = async (inv: string) => (await q(`select total_satang, allocated_satang, outstanding_satang, payment_state from invoice_balances where invoice_id=$1`, [inv]))[0];
const allocate = (p: string, inv: string, amount: number) => `select * from billing_allocate('${O}','${B}','${p}','${inv}',${amount},'u')`;

describe('core schema: access', () => {
    it('every new table has RLS on and no policies; only the service role may call the functions', async () => {
        const tables = ['outbox', 'parties', 'lease_parties', 'lease_units', 'meter_readings', 'invoices', 'invoice_lines', 'payments', 'payment_allocations', 'deposit_entries', 'portal_grants', 'migration_runs', 'migration_issues'];
        const rows = await q<{ relname: string; relrowsecurity: boolean }>(`select relname, relrowsecurity from pg_class where relkind='r' and relname = any($1)`, [tables]);
        expect(rows).toHaveLength(tables.length);
        expect(rows.every(r => r.relrowsecurity)).toBe(true);
        expect(await q(`select * from pg_policies where tablename = any($1)`, [tables])).toEqual([]);
        const fns = ['billing_allocate', 'billing_issue_invoice', 'billing_void_invoice', 'billing_set_payment_status', 'billing_approve_invoice', 'core_enqueue', 'meter_record_reading'];
        const grants = await q<{ proname: string; grantee: string }>(`
            select p.proname, r.rolname as grantee from pg_proc p, pg_roles r
            where p.proname = any($1) and has_function_privilege(r.oid, p.oid, 'EXECUTE') and r.rolname in ('anon','authenticated','service_role')`, [fns]);
        for (const fn of fns) expect(grants.filter(g => g.proname === fn).map(g => g.grantee)).toEqual(['service_role']);
    });
});

describe('contracts and occupancy', () => {
    it('two contracts can never hold the same room on overlapping days (UAT-02); back-to-back is fine', async () => {
        const a = await lease('occ1'), b = await lease('occ1', 'scheduled');
        await q(`insert into lease_units (owner_uid,building_id,lease_id,room_id,room_number,starts_on,ends_on,status) values ($1,$2,$3,'occ1','occ1','2026-01-01','2026-07-01','occupied')`, [O, B, a]);
        expect((await fails(`insert into lease_units (owner_uid,building_id,lease_id,room_id,room_number,starts_on,ends_on) values ($1,$2,$3,'occ1','occ1','2026-06-30','2026-09-01')`, [O, B, b])).code).toBe('23P01');
        await q(`insert into lease_units (owner_uid,building_id,lease_id,room_id,room_number,starts_on) values ($1,$2,$3,'occ1','occ1','2026-07-01')`, [O, B, b]);
        // open-ended occupancy blocks everything after it; a cancelled one blocks nothing
        expect((await fails(`insert into lease_units (owner_uid,building_id,lease_id,room_id,room_number,starts_on,ends_on) values ($1,$2,$3,'occ1','occ1','2030-01-01','2030-02-01')`, [O, B, a])).code).toBe('23P01');
        await q(`update lease_units set status='cancelled' where lease_id=$1`, [b]);
        await q(`insert into lease_units (owner_uid,building_id,lease_id,room_id,room_number,starts_on,ends_on) values ($1,$2,$3,'occ1','occ1','2030-01-01','2030-02-01')`, [O, B, a]);
    });

    it('a contract status change queues exactly one outbox event and bumps the version', async () => {
        const l = await lease('occ2', 'scheduled');
        await q(`update leases set status='active' where id=$1`, [l]);
        await q(`update leases set note='x' where id=$1`, [l]); // not a status change: no event
        const ev = await q(`select topic, payload, status from outbox where payload->>'lease_id' = $1`, [l]);
        expect(ev).toHaveLength(1);
        expect(ev[0]).toMatchObject({ topic: 'lease.active', status: 'queued', payload: { from: 'scheduled', to: 'active', room_id: 'occ2' } });
        expect((await q(`select version from leases where id=$1`, [l]))[0].version).toBe(2);
    });

    it('accepts the new contract states (draft / pending approval / cancelled) and nothing else', async () => {
        for (const s of ['draft', 'pending_approval', 'cancelled']) await lease(`st-${s}`, s);
        expect((await fails(`insert into leases (owner_uid,building_id,room_id,room_number,tenant_name,start_date,end_date,rent_satang,status,created_by) values ($1,$2,'x','x','ผู้เช่า','2026-01-01','2027-01-01',1,'bogus','u')`, [O, B])).code).toBe('23514');
    });

    it('parties are per organisation and never merged by name', async () => {
        const a = await party('สมชาย ใจดี'), b = await party('สมชาย ใจดี');
        expect(a).not.toBe(b);
        await q(`insert into parties (owner_uid, display_name, legacy_ref, created_by) values ($1,'x','firestore:tenants/b/r1','u')`, [O]);
        expect((await fails(`insert into parties (owner_uid, display_name, legacy_ref, created_by) values ($1,'y','firestore:tenants/b/r1','u')`, [O])).code).toBe('23505');
    });
});

describe('meter readings (MET-01)', () => {
    const read = (room: string, period: string, reading: number, prev: number | null, baseline = false, reason: string | null = null) =>
        `insert into meter_readings (owner_uid,building_id,room_id,meter,period,reading,previous_reading,is_baseline,baseline_reason,recorded_by) values ('${O}','${B}','${room}','electricity','${period}',${reading},${prev ?? 'null'},${baseline},${reason ? `'${reason}'` : 'null'},'u') returning id`;

    it('a reading may not go down unless a replaced meter starts a new baseline with a reason', async () => {
        expect((await fails(read('m1', '2026-10', 90, 100))).code).toBe('23514');
        expect((await fails(read('m1', '2026-10', 5, 100, true))).code).toBe('23514');
        await q(read('m1', '2026-10', 5, 100, true, 'เปลี่ยนมิเตอร์ใหม่'));
    });

    const record = (room: string, reading: number, correction: string | null = null) =>
        `select * from meter_record_reading('${O}','${B}','${room}','electricity','2026-10',${reading},100,false,null,null,'u',${correction ? `'${correction}'` : 'null'})`;

    it('one live reading per room, meter and period; a correction needs a reason, supersedes the old one and keeps it', async () => {
        const first = (await q<{ id: string }>(record('m2', 150)))[0].id;
        expect((await fails(read('m2', '2026-10', 160, 100))).code).toBe('23505');
        expect((await fails(record('m2', 160))).message).toBe('reading_exists');
        const second = (await q<{ id: string }>(record('m2', 160, 'อ่านเลขผิด')))[0].id;
        expect((await q(`select superseded_by, correction_reason from meter_readings where id=$1`, [first]))[0]).toEqual({ superseded_by: second, correction_reason: 'อ่านเลขผิด' });
        expect((await q(`select count(*)::int as n from meter_readings where room_id='m2'`))[0].n).toBe(2);
    });

    it('a reading on an issued invoice cannot be corrected: the closed month stays as issued (UAT-06)', async () => {
        const r = (await q<{ id: string }>(record('m3', 150)))[0].id;
        const inv = (await q<{ id: string }>(`insert into invoices (owner_uid,building_id,room_id,room_number,period,dedupe_key,created_by) values ($1,$2,'m3','m3','2026-10','regular:m3:2026-10','u') returning id`, [O, B]))[0].id;
        await q(`insert into invoice_lines (owner_uid,building_id,invoice_id,kind,description,amount_satang,meter_reading_id) values ($1,$2,$3,'electricity','ค่าไฟ',40000,$4)`, [O, B, inv, r]);
        await q(record('m3', 151, 'แก้ก่อนออกบิล')); // still a draft: allowed
        const live = (await q<{ id: string }>(`select id from meter_readings where room_id='m3' and superseded_at is null`))[0].id;
        await q(`update invoice_lines set meter_reading_id=$1 where invoice_id=$2`, [live, inv]);
        await q(`select * from billing_approve_invoice($1,$2,$3,'u',1)`, [O, B, inv]);
        expect((await fails(record('m3', 152, 'แก้หลังออกบิล'))).message).toBe('reading_billed');
    });
});

describe('invoices (BIL-01/02/03)', () => {
    it('the total follows the lines while a draft; approval checks the version; an empty invoice cannot be approved', async () => {
        const inv = await draft('i1', '2026-10', [350000, 48000]);
        expect((await q(`select total_satang, status, version from invoices where id=$1`, [inv]))[0]).toEqual({ total_satang: 398000, status: 'draft', version: 1 });
        expect((await fails(`select * from billing_approve_invoice($1,$2,$3,'u',99)`, [O, B, inv])).message).toBe('stale_version');
        const empty = (await q<{ id: string }>(`insert into invoices (owner_uid,building_id,room_id,room_number,period,dedupe_key,created_by) values ($1,$2,'i1e','i1e','2026-10','regular:i1e:2026-10','u') returning id`, [O, B]))[0].id;
        expect((await fails(`select * from billing_approve_invoice($1,$2,$3,'u',1)`, [O, B, empty])).message).toBe('invoice_empty');
    });

    it('an issued invoice is frozen: no line changes, no total change; issuing again changes nothing and queues once', async () => {
        const inv = await draft('i2', '2026-10', [350000]);
        await issue(inv);
        await q(`select * from billing_issue_invoice($1,$2,$3,'u','2026-10-01','2026-10-05',null)`, [O, B, inv]); // retry
        expect((await q(`select count(*)::int as n from outbox where topic='invoice.issued' and payload->>'invoice_id'=$1`, [inv]))[0].n).toBe(1);
        expect((await fails(`insert into invoice_lines (owner_uid,building_id,invoice_id,kind,description,amount_satang) values ($1,$2,$3,'other','เพิ่ม',100)`, [O, B, inv])).message).toBe('invoice_not_draft');
        expect((await fails(`update invoice_lines set amount_satang=1 where invoice_id=$1`, [inv])).message).toBe('invoice_not_draft');
        expect((await fails(`delete from invoice_lines where invoice_id=$1`, [inv])).message).toBe('invoice_not_draft');
        expect((await fails(`update invoices set total_satang=1 where id=$1`, [inv])).message).toBe('invoice_frozen');
    });

    it('creating the same invoice twice finds the existing one (dedupe key); a source charge is billed once', async () => {
        await draft('i3', '2026-10', [100]);
        expect((await fails(`insert into invoices (owner_uid,building_id,room_id,room_number,period,dedupe_key,created_by) values ($1,$2,'i3','i3','2026-10','regular:i3:2026-10','u')`, [O, B])).code).toBe('23505');
        const a = await draft('i4', '2026-10', [5000], ['fine', 'fine-1']);
        expect((await fails(`insert into invoice_lines (owner_uid,building_id,invoice_id,kind,description,amount_satang,source_type,source_id) values ($1,$2,$3,'fine','ค่าปรับ',5000,'fine','fine-1')`, [O, B, a])).code).toBe('23505');
        // voiding frees the source so a corrected invoice can bill it
        await issue(a);
        await q(`select * from billing_void_invoice($1,$2,$3,'u','ออกผิดห้อง')`, [O, B, a]);
        await draft('i4b', '2026-10', [5000], ['fine', 'fine-1']);
    });

    it('a voided invoice needs a reason, cannot come back, and cannot be voided while money is allocated', async () => {
        const inv = await draft('i5', '2026-10', [10000]);
        await issue(inv);
        const p = await pay(10000);
        await q(allocate(p, inv, 10000));
        expect((await fails(`select * from billing_void_invoice($1,$2,$3,'u','ผิด')`, [O, B, inv])).message).toBe('invoice_has_allocations');
        const other = await draft('i6', '2026-10', [10000]);
        await issue(other);
        expect((await fails(`select * from billing_void_invoice($1,$2,$3,'u',null)`, [O, B, other])).code).toBe('23514');
        await q(`select * from billing_void_invoice($1,$2,$3,'u','ออกซ้ำ')`, [O, B, other]);
        expect((await fails(`update invoices set status='issued' where id=$1`, [other])).message).toBe('invoice_frozen');
    });
});

describe('payments and allocations (PAY-01..04, UAT-04/05)', () => {
    it('partial then full payment: outstanding and state are derived from allocations', async () => {
        const inv = await draft('p1', '2026-10', [400000]);
        await issue(inv);
        expect(await balance(inv)).toMatchObject({ outstanding_satang: 400000 });
        await q(allocate(await pay(150000), inv, 150000));
        expect(await balance(inv)).toMatchObject({ allocated_satang: 150000, outstanding_satang: 250000 });
        await q(allocate(await pay(250000), inv, 250000));
        expect(await balance(inv)).toMatchObject({ outstanding_satang: 0, payment_state: 'paid' });
    });

    it('one payment across several invoices never exceeds the payment nor what each invoice owes; the rest waits unallocated', async () => {
        const a = await draft('p2a', '2026-10', [100000]), b = await draft('p2b', '2026-10', [50000]);
        await issue(a); await issue(b);
        const p = await pay(200000);
        expect((await fails(allocate(p, a, 100001))).message).toBe('exceeds_outstanding');
        await q(allocate(p, a, 100000));
        await q(allocate(p, b, 50000));
        expect((await q(`select unallocated_satang from payment_balances where payment_id=$1`, [p]))[0].unallocated_satang).toBe(50000);
        const c = await draft('p2c', '2026-10', [90000]);
        await issue(c);
        expect((await fails(allocate(p, c, 50001))).message).toBe('exceeds_payment');
    });

    it('only confirmed money is allocated; a slip waiting for verification counts for nothing', async () => {
        const inv = await draft('p3', '2026-10', [100000]);
        await issue(inv);
        const p = await pay(100000, 'pending_verification', 'SLIP-1', 'transfer');
        expect((await fails(allocate(p, inv, 100000))).message).toBe('payment_not_confirmed');
        expect((await fails(allocate(p, await draft('p3d', '2026-10', [1]), 1))).message).toBe('payment_not_confirmed');
    });

    it('a bank reference is accepted once per channel; a rejected one can be entered again', async () => {
        await pay(1000, 'pending_verification', 'TX-9', 'transfer');
        expect((await fails(`insert into payments (owner_uid,building_id,method,amount_satang,received_on,reference,bank_account_id,received_by) values ($1,$2,'transfer',1000,'2026-10-03','TX-9','acc1','u')`, [O, B])).code).toBe('23505');
        const id = (await q<{ id: string }>(`select id from payments where reference='TX-9'`))[0].id;
        await q(`select * from billing_set_payment_status($1,$2,$3,'rejected','u','สลิปปลอม')`, [O, B, id]);
        await pay(1000, 'pending_verification', 'TX-9', 'transfer');
    });

    it('reversing a payment reverses its allocations, keeps the history and reopens the debt', async () => {
        const inv = await draft('p4', '2026-10', [80000]);
        await issue(inv);
        const p = await pay(80000);
        await q(allocate(p, inv, 80000));
        expect((await fails(`select * from billing_set_payment_status($1,$2,$3,'reversed','u',null)`, [O, B, p])).code).toBe('23514'); // reason required
        await q(`select * from billing_set_payment_status($1,$2,$3,'reversed','u','เช็คเด้ง')`, [O, B, p]);
        expect(await balance(inv)).toMatchObject({ outstanding_satang: 80000 });
        expect((await q(`select count(*)::int as n from payment_allocations where payment_id=$1 and reversed_at is not null`, [p]))[0].n).toBe(1);
        expect((await fails(`select * from billing_set_payment_status($1,$2,$3,'confirmed','u',null)`, [O, B, p])).message).toBe('invalid_transition');
    });

    it('money never crosses properties', async () => {
        const inv = await draft('p5', '2026-10', [1000]);
        await issue(inv);
        const p = await pay(1000);
        expect((await fails(`select * from billing_allocate('${O}','other-bld','${p}','${inv}',1000,'u')`)).message).toBe('payment_not_found');
    });
});

describe('deposits (OUT-02)', () => {
    it('held = received − deducted − refunded; deductions and refunds need an approver and a reason', async () => {
        const l = await lease('d1');
        const add = (kind: string, amount: number, approved: string | null = null, reason: string | null = null) =>
            pg.query(`insert into deposit_entries (owner_uid,building_id,lease_id,kind,amount_satang,approved_by,reason,created_by) values ($1,$2,$3,$4,$5,$6,$7,'u')`, [O, B, l, kind, amount, approved, reason]);
        await add('required', 700000);
        await add('received', 700000);
        expect((await fails(`insert into deposit_entries (owner_uid,building_id,lease_id,kind,amount_satang,created_by) values ($1,$2,$3,'deducted',50000,'u')`, [O, B, l])).code).toBe('23514');
        await add('deducted', 50000, 'owner', 'ซ่อมผนัง');
        await add('refunded', 650000, 'owner', 'คืนเงินประกัน');
        expect((await q(`select required_satang, held_satang from deposit_balances where lease_id=$1`, [l]))[0]).toEqual({ required_satang: 700000, held_satang: 0 });
    });
});
