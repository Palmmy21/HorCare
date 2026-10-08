// @vitest-environment node
// Runs the REAL SQL migrations in an in-process Postgres (PGlite) so the constraints and functions the ERP
// modules rely on are tested for real, not only through the in-memory fake.
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
    // the roles Supabase provides
    await pg.exec(`create role anon; create role authenticated; create role service_role;`);
    const dir = join(process.cwd(), 'supabase', 'migrations');
    for (const f of readdirSync(dir).filter(n => n.endsWith('.sql')).sort()) await pg.exec(readFileSync(join(dir, f), 'utf8'));
}, 60_000);

const q = async <T = Record<string, any>>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows;
/** Run a statement that should fail and return the Postgres error. */
const fails = async (sql: string, params: unknown[] = []) => { try { await pg.query(sql, params); } catch (e) { return e as { code?: string; message: string }; } throw new Error('expected an error'); };

describe('migrations', () => {
    it('apply cleanly and every table has RLS on with no policies (clients are denied)', async () => {
        const rows = await q<{ relname: string; relrowsecurity: boolean }>(`select relname, relrowsecurity from pg_class where relname in ('leasing_leads','leasing_reservations','leases','collection_rates','bookings','stall_plans','charges','charge_payments','day_closes')`);
        expect(rows).toHaveLength(9);
        expect(rows.every(r => r.relrowsecurity)).toBe(true);
        expect(await q(`select * from pg_policies where tablename in ('leases','bookings','charges')`)).toEqual([]);
    });

    it('the service role can call the RPC functions, anon and authenticated cannot', async () => {
        const grants = await q<{ proname: string; grantee: string }>(`
            select p.proname, r.rolname as grantee from pg_proc p, pg_roles r
            where p.proname in ('leasing_reserve','stays_create_booking','collections_pay') and has_function_privilege(r.oid, p.oid, 'EXECUTE') and r.rolname in ('anon','authenticated','service_role')`);
        const by = (fn: string) => grants.filter(g => g.proname === fn).map(g => g.grantee).sort();
        for (const fn of ['leasing_reserve', 'stays_create_booking', 'collections_pay']) expect(by(fn)).toEqual(['service_role']);
    });
});

describe('leasing', () => {
    const lead = async (name = 'สมชาย') => (await q<{ id: string }>(`insert into leasing_leads (owner_uid, building_id, name, phone, created_by) values ($1,$2,$3,'0812345678','u') returning id`, [O, B, name]))[0].id;

    it('reserve creates the hold, moves the lead to reserved, and a second lead cannot take the room', async () => {
        const a = await lead(), b = await lead('สมหญิง');
        const r = await q(`select * from leasing_reserve($1,$2,$3,'r1','A01',200000,'2026-12-01','u')`, [O, B, a]);
        expect(r[0]).toMatchObject({ room_id: 'r1', status: 'active' });
        expect((await q(`select status from leasing_leads where id=$1`, [a]))[0].status).toBe('reserved');
        const err = await fails(`select * from leasing_reserve($1,$2,$3,'r1','A01',0,'2026-12-01','u')`, [O, B, b]);
        expect(err.code).toBe('23505');
        expect((await q(`select status from leasing_leads where id=$1`, [b]))[0].status).toBe('new'); // nothing half-done
    });

    it('convert makes the lease, closes the reservation and wins the lead; a room has one lease in force', async () => {
        const a = await lead('ผู้เช่า');
        const res = (await q<{ id: string }>(`select * from leasing_reserve($1,$2,$3,'r2','A02',0,'2026-12-01','u')`, [O, B, a]))[0];
        const lease = await q(`select * from leasing_convert_reservation($1,$2,$3,'ผู้เช่า','0812345678','2026-12-01','2027-11-30',350000,700000,'u')`, [O, B, res.id]);
        expect(lease[0]).toMatchObject({ room_id: 'r2', status: 'active', rent_satang: 350000 });
        expect((await q(`select status from leasing_reservations where id=$1`, [res.id]))[0].status).toBe('converted');
        expect((await q(`select status from leasing_leads where id=$1`, [a]))[0].status).toBe('won');
        expect((await fails(`select * from leasing_convert_reservation($1,$2,$3,'x y','0812345678','2026-12-01','2027-11-30',1,0,'u')`, [O, B, res.id])).message).toBe('reservation_not_active');
        expect((await fails(`insert into leases (owner_uid,building_id,room_id,room_number,tenant_name,start_date,end_date,rent_satang,created_by) values ($1,$2,'r2','A02','คนอื่น','2026-12-01','2027-01-01',1,'u')`, [O, B])).code).toBe('23505');
    });

    it('rejects bad data at the database level', async () => {
        expect((await fails(`insert into leases (owner_uid,building_id,room_id,room_number,tenant_name,start_date,end_date,rent_satang,created_by) values ($1,$2,'r9','A9','ชื่อ','2026-12-01','2026-12-01',1,'u')`, [O, B])).code).toBe('23514'); // end must be after start
        expect((await fails(`insert into leasing_leads (owner_uid,building_id,name,phone,created_by) values ($1,$2,'สมชาย','12345','u')`, [O, B])).code).toBe('23514');
    });
});

describe('collections: bookings', () => {
    const book = (room: string, from: string, to: string, total = 300000, deposit = 0) =>
        q(`select * from stays_create_booking($1,$2,$3,$4,'แขก ทดสอบ','0812345678',2,$5::date,$6::date,null,$7,$8,'cash',null,'u','พนักงาน')`, [O, B, room, room.toUpperCase(), from, to, total, deposit]);

    it('a stay creates its booking and charge together, with the deposit as the first payment', async () => {
        const b = (await book('h1', '2027-01-10', '2027-01-12', 300000, 100000))[0];
        expect(b).toMatchObject({ status: 'reserved', room_id: 'h1' });
        const c = (await q(`select * from charges where id=$1`, [b.charge_id]))[0];
        expect(c).toMatchObject({ kind: 'stay', amount_satang: 300000, paid_satang: 100000, status: 'open', booking_id: b.id });
        expect(c.period_end.toISOString?.().slice(0, 10) ?? String(c.period_end).slice(0, 10)).toBe('2027-01-11'); // last night
        const p = await q(`select kind, amount_satang, method from charge_payments where charge_id=$1`, [c.id]);
        expect(p).toEqual([{ kind: 'deposit', amount_satang: 100000, method: 'cash' }]);
    });

    it('double booking is impossible; the check-out day is free; a cancelled stay frees the room', async () => {
        await book('h2', '2027-02-01', '2027-02-04');
        expect((await fails(`select * from stays_create_booking($1,$2,'h2','H2','ซ้อน ทับ',null,1,'2027-02-03','2027-02-05',null,1,0,'cash',null,'u','x')`, [O, B])).code).toBe('23P01');
        expect((await fails(`select * from stays_create_booking($1,$2,'h2','H2','คลุม ทั้งหมด',null,1,'2027-01-30','2027-02-10',null,1,0,'cash',null,'u','x')`, [O, B])).code).toBe('23P01');
        await book('h2', '2027-02-04', '2027-02-06'); // starts on the previous guest's check-out day
        // a failed attempt leaves nothing behind (no orphan charge)
        expect((await q(`select count(*)::int as n from charges where room_id='h2'`))[0].n).toBe(2);
        const first = (await q<{ id: string }>(`select id from bookings where room_id='h2' and check_in='2027-02-01'`))[0].id;
        await q(`select * from stays_cancel_booking($1,$2,$3,'void','cash',null,'u','x')`, [O, B, first]);
        await book('h2', '2027-02-01', '2027-02-04'); // now available again
    });

    it('other rooms and other properties are unaffected', async () => {
        await book('h3', '2027-03-01', '2027-03-03');
        await book('h4', '2027-03-01', '2027-03-03');
        await q(`select * from stays_create_booking('owner-2',$1,'h3','H3','คนอื่น เจ้าของอื่น',null,1,'2027-03-01','2027-03-03',null,1,0,'cash',null,'u','x')`, [B]);
    });

    it('cancelling settles the money: void when unpaid, forfeit keeps the deposit, refund pays it back', async () => {
        const unpaid = (await book('h5', '2027-04-01', '2027-04-02'))[0];
        await q(`select * from stays_cancel_booking($1,$2,$3,'void','cash',null,'u','x')`, [O, B, unpaid.id]);
        expect((await q(`select status from charges where id=$1`, [unpaid.charge_id]))[0].status).toBe('void');

        const forfeit = (await book('h6', '2027-04-01', '2027-04-03', 400000, 100000))[0];
        expect((await fails(`select * from stays_cancel_booking($1,$2,$3,'void','cash',null,'u','x')`, [O, B, forfeit.id])).message).toBe('has_payments');
        await q(`select * from stays_cancel_booking($1,$2,$3,'forfeit','cash',null,'u','x')`, [O, B, forfeit.id]);
        expect((await q(`select amount_satang, paid_satang, status from charges where id=$1`, [forfeit.charge_id]))[0]).toEqual({ amount_satang: 100000, paid_satang: 100000, status: 'paid' });

        const refund = (await book('h7', '2027-04-01', '2027-04-03', 400000, 150000))[0];
        await q(`select * from stays_cancel_booking($1,$2,$3,'refund','cash',null,'u','x')`, [O, B, refund.id]);
        expect((await q(`select paid_satang, status from charges where id=$1`, [refund.charge_id]))[0]).toEqual({ paid_satang: 0, status: 'void' });
        expect((await q(`select kind, amount_satang from charge_payments where charge_id=$1 order by received_at, amount_satang`, [refund.charge_id])).map(r => r.amount_satang).sort((a, b) => a - b)).toEqual([-150000, 150000]);
        expect((await fails(`select * from stays_cancel_booking($1,$2,$3,'void','cash',null,'u','x')`, [O, B, refund.id])).message).toBe('cannot_cancel');
    });
});

describe('collections: charges and payments', () => {
    const charge = async (key: string, amount = 100000) => (await q<{ id: string }>(`select * from collections_ensure_charge($1,$2,'stall_day','s1','A1','ร้านผัก',null,'2027-05-01','2027-05-01','ค่าแผง',$3,$4,'u')`, [O, B, amount, key]))[0];

    it('ensure_charge is idempotent: the same key never charges twice', async () => {
        const a = await charge('stall-day:s1:2027-05-01');
        const b = await charge('stall-day:s1:2027-05-01', 999);
        expect(b.id).toBe(a.id);
        expect((await q(`select count(*)::int as n from charges where dedupe_key='stall-day:s1:2027-05-01'`))[0].n).toBe(1);
        expect((await q(`select amount_satang from charges where id=$1`, [a.id]))[0].amount_satang).toBe(100000); // first one wins
    });

    it('pay: partial then full; overpayment, zero and voided charges are refused', async () => {
        const c = await charge('k-pay');
        const pay = (amount: number, kind = 'payment') => q(`select * from collections_pay($1,$2,$3,$4,'cash',$5,null,null,'u','พนักงาน')`, [O, B, c.id, amount, kind]);
        await pay(30000);
        expect((await q(`select paid_satang, status from charges where id=$1`, [c.id]))[0]).toEqual({ paid_satang: 30000, status: 'open' });
        expect((await fails(`select * from collections_pay($1,$2,$3,70001,'cash','payment',null,null,'u','x')`, [O, B, c.id])).message).toBe('exceeds_outstanding');
        expect((await fails(`select * from collections_pay($1,$2,$3,0,'cash','payment',null,null,'u','x')`, [O, B, c.id])).message).toBe('invalid_amount');
        await pay(70000);
        expect((await q(`select paid_satang, status from charges where id=$1`, [c.id]))[0]).toEqual({ paid_satang: 100000, status: 'paid' });
        expect((await fails(`select * from collections_pay($1,$2,$3,1,'cash','payment',null,null,'u','x')`, [O, B, c.id])).message).toBe('exceeds_outstanding');
        const v = await charge('k-void');
        await q(`update charges set status='void' where id=$1`, [v.id]);
        expect((await fails(`select * from collections_pay($1,$2,$3,1,'cash','payment',null,null,'u','x')`, [O, B, v.id])).message).toBe('charge_void');
    });

    it('a payment never reaches another property\'s charge; a transfer must name an account; refunds are bounded', async () => {
        const c = await charge('k-iso');
        expect((await fails(`select * from collections_pay('owner-2',$1,$2,100,'cash','payment',null,null,'u','x')`, [B, c.id])).message).toBe('charge_not_found');
        expect((await fails(`select * from collections_pay($1,$2,$3,100,'transfer','payment',null,null,'u','x')`, [O, B, c.id])).code).toBe('23514');
        await q(`select * from collections_pay($1,$2,$3,5000,'cash','payment',null,null,'u','x')`, [O, B, c.id]);
        expect((await fails(`select * from collections_pay($1,$2,$3,-5001,'cash','refund',null,null,'u','x')`, [O, B, c.id])).message).toBe('refund_exceeds_paid');
        await q(`select * from collections_pay($1,$2,$3,-5000,'cash','refund',null,null,'u','x')`, [O, B, c.id]);
        expect((await q(`select paid_satang, status from charges where id=$1`, [c.id]))[0]).toEqual({ paid_satang: 0, status: 'open' });
    });

    it('stall plans: one live plan per stall; daily-actual must be per day; one close per day', async () => {
        const plan = (room: string, mode = 'weekly_advance', unit = 'day') => pg.query(`insert into stall_plans (owner_uid,building_id,room_id,room_number,mode,unit,open_days,starts_on,created_by) values ($1,$2,$3,'A1',$4,$5,'{6,0}','2027-01-01','u')`, [O, B, room, mode, unit]);
        await plan('s9');
        expect((await fails(`insert into stall_plans (owner_uid,building_id,room_id,room_number,mode,unit,open_days,starts_on,created_by) values ($1,$2,'s9','A1','weekly_advance','day','{1}','2027-01-01','u')`, [O, B])).code).toBe('23505');
        await q(`update stall_plans set status='ended' where room_id='s9'`);
        await plan('s9'); // a new plan once the old one ended
        expect((await fails(`insert into stall_plans (owner_uid,building_id,room_id,room_number,mode,unit,open_days,starts_on,created_by) values ($1,$2,'s8','A8','daily_actual','week','{1}','2027-01-01','u')`, [O, B])).code).toBe('23514');
        const close = () => pg.query(`insert into day_closes (owner_uid,building_id,close_date,expected_cash_satang,counted_cash_satang,transfer_satang,payments_count,difference_satang,closed_by,closed_by_name) values ($1,$2,'2027-05-01',0,0,0,0,0,'u','x')`, [O, B]);
        await close();
        expect((await fails(`insert into day_closes (owner_uid,building_id,close_date,expected_cash_satang,counted_cash_satang,transfer_satang,payments_count,difference_satang,closed_by,closed_by_name) values ($1,$2,'2027-05-01',0,0,0,0,0,'u','x')`, [O, B])).code).toBe('23505');
    });
});