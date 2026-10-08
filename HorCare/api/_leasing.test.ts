import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import { FakeSupabase } from './_fake-supabase.js';
const sb = new FakeSupabase();
let configured = true;
vi.mock('./_supabase.js', async () => {
    const real = await vi.importActual<typeof import('./_supabase.js')>('./_supabase.js');
    return { ...real, supabase: () => { if (!configured) throw new real.SupabaseNotConfigured(); return sb; } };
});

import handler from './_leasing.js';
import { addAuthUser, fakeReq, fakeRes, listPaths, read, resetFake, seed } from './_fake-firestore.js';
import { permissionsForRole } from '../src/shared/permissions.js';
import { addDays, todayTh } from '../src/shared/market.js';

const OWNER = 'owner-1';
const B1 = 'bld-1';
const B2 = 'bld-2';
const today = todayTh();
const d = (n: number) => addDays(today, n);

beforeEach(() => {
    resetFake(); sb.reset(); configured = true;
    for (const [u, n] of [[OWNER, 'Owner'], ['desk', 'Desk'], ['fin', 'Fin'], ['tech', 'Tech'], ['other', 'Other']]) addAuthUser(u, `${u}@x.com`, n);
    seed(`users/${OWNER}`, { uid: OWNER });
    for (const b of [B1, B2]) seed(`users/${OWNER}/buildings/${b}`, { id: b });
    seed(`users/${OWNER}/buildings/${B1}/rooms/r1`, { room_number: 'A01', is_active: true });
    seed(`users/${OWNER}/buildings/${B1}/rooms/r2`, { room_number: 'A02', is_active: true });
    seed(`users/${OWNER}/buildings/${B1}/rooms/old`, { room_number: 'A99', is_active: false });
    seed(`users/${OWNER}/buildings/${B2}/rooms/x1`, { room_number: 'B01', is_active: true });
    for (const [uid, role, props] of [['desk', 'front_desk', ['*']], ['fin', 'finance', ['*']], ['tech', 'technician', ['*']]] as const)
        seed(`users/${OWNER}/members/${uid}`, { uid, role, permissions: permissionsForRole(role), property_ids: props, status: 'active' });
});

async function call(uid: string | null, body: Record<string, unknown>) {
    const res = fakeRes();
    await handler(fakeReq({ owner_uid: OWNER, building_id: B1, ...body }, uid ?? undefined), res as never);
    return res as { statusCode: number; body: any };
}
const newLead = (over: Record<string, unknown> = {}, uid: string | null = OWNER) =>
    call(uid, { action: 'lead_create', name: 'สมชาย ใจดี', phone: '081-234-5678', source: 'walk_in', budget: 4000, ...over });
const leadId = async () => (await newLead()).body.lead.id as string;
const reserve = (lead: string, over: Record<string, unknown> = {}, uid: string | null = OWNER) =>
    call(uid, { action: 'reserve', lead_id: lead, room_id: 'r1', deposit: 2000, reserved_until: d(10), ...over });
const terms = (over: Record<string, unknown> = {}) => ({ tenant_name: 'สมชาย ใจดี', tenant_phone: '0812345678', start_date: today, end_date: d(364), rent: 3500, deposit: 7000, ...over });

describe('access', () => {
    it('owner and front desk manage; finance only reads; technician and strangers cannot even read', async () => {
        expect((await newLead({}, OWNER)).statusCode).toBe(200);
        expect((await newLead({}, 'desk')).statusCode).toBe(200);
        expect((await newLead({}, 'fin')).statusCode).toBe(403);
        expect((await call('fin', { action: 'overview' })).statusCode).toBe(200);
        expect((await call('tech', { action: 'overview' })).statusCode).toBe(403);
        expect((await call('other', { action: 'overview' })).statusCode).toBe(403);
        expect((await call(null, { action: 'overview' })).statusCode).toBe(401);
        expect((await call(OWNER, { action: 'nuke' })).statusCode).toBe(400);
    });

    it('answers 503 with a clear message while Supabase is not configured', async () => {
        configured = false;
        const r = await call(OWNER, { action: 'overview' });
        expect(r.statusCode).toBe(503);
        expect(r.body.error).toBe('supabase_not_configured');
    });

    it('a database failure becomes a 502, never a stack trace', async () => {
        sb.failWith = { code: 'XX000', message: 'boom' };
        const r = await call(OWNER, { action: 'overview' });
        expect(r.statusCode).toBe(502);
        expect(JSON.stringify(r.body)).not.toContain('boom');
    });
});

describe('leads', () => {
    it('creates a lead scoped to the property, with money in satang, and audits it', async () => {
        const r = await newLead({ interested_room_id: 'r1' });
        expect(r.body.lead).toMatchObject({ owner_uid: OWNER, building_id: B1, name: 'สมชาย ใจดี', phone: '0812345678', budget_satang: 400000, status: 'new', created_by: OWNER });
        expect(listPaths(`users/${OWNER}/audit_logs/`)).toHaveLength(1);
    });

    it('validates input and the room', async () => {
        for (const bad of [{ name: 'x' }, { phone: '1' }, { phone: undefined }, { source: 'tv' }, { budget: -1 }, { note: 'x'.repeat(1001) }]) expect((await newLead(bad)).statusCode).toBe(400);
        expect((await newLead({ interested_room_id: 'ghost' })).body.error).toBe('room_not_found');
        expect((await newLead({ interested_room_id: 'old' })).body.error).toBe('room_not_found');
        expect((await newLead({ interested_room_id: 'x1' })).body.error).toBe('room_not_found'); // another property's room
        expect(sb.rows('leasing_leads')).toHaveLength(0);
    });

    it('moves along the pipeline, rejects illegal moves, and reopens a lost lead', async () => {
        const id = await leadId();
        const move = (status: string, extra: Record<string, unknown> = {}) => call(OWNER, { action: 'lead_move', lead_id: id, status, ...extra });
        expect((await move('contacted')).body.lead.status).toBe('contacted');
        expect((await move('reserved')).body.error).toBe('invalid_transition');
        expect((await move('won')).body.error).toBe('invalid_transition');
        expect((await move('lost', { lost_reason: 'แพงไป' })).body.lead).toMatchObject({ status: 'lost', lost_reason: 'แพงไป' });
        expect((await move('new')).body.lead).toMatchObject({ status: 'new', lost_reason: null });
        expect((await move('bogus')).statusCode).toBe(400);
        expect((await call(OWNER, { action: 'lead_move', lead_id: 'not-a-uuid', status: 'new' })).statusCode).toBe(400);
        expect((await call(OWNER, { action: 'lead_move', lead_id: '123e4567-e89b-12d3-a456-426614174000', status: 'new' })).statusCode).toBe(404);
    });

    it('a lead of another property is invisible', async () => {
        const id = await leadId();
        const r = await call(OWNER, { action: 'lead_move', lead_id: id, status: 'contacted', building_id: B2 });
        expect(r.statusCode).toBe(404);
        const ov = await call(OWNER, { action: 'overview', building_id: B2 });
        expect(ov.body.leads).toEqual([]);
    });

    it('updates a lead but not one that already became a lease', async () => {
        const id = await leadId();
        expect((await call(OWNER, { action: 'lead_update', lead_id: id, name: 'ชื่อใหม่', phone: '0899999999' })).body.lead.name).toBe('ชื่อใหม่');
        const res = (await reserve(id)).body.reservation;
        await call(OWNER, { action: 'convert', reservation_id: res.id, ...terms() });
        expect((await call(OWNER, { action: 'lead_update', lead_id: id, name: 'แก้ไม่ได้', phone: '0899999999' })).body.error).toBe('lead_closed');
    });
});

describe('reservations', () => {
    it('reserves a room: creates the hold and moves the lead to reserved', async () => {
        const id = await leadId();
        const r = await reserve(id);
        expect(r.statusCode).toBe(200);
        expect(r.body.reservation).toMatchObject({ room_id: 'r1', room_number: 'A01', deposit_satang: 200000, status: 'active', reserved_until: d(10) });
        expect(sb.rows('leasing_leads')[0]).toMatchObject({ status: 'reserved', interested_room_id: 'r1' });
    });

    it('two leads cannot hold the same room (the database decides)', async () => {
        const a = await leadId(); const b = await leadId();
        expect((await reserve(a)).statusCode).toBe(200);
        const second = await reserve(b);
        expect(second.statusCode).toBe(409);
        expect(second.body.error).toBe('room_already_reserved');
        expect(sb.rows('leasing_reservations')).toHaveLength(1);
        expect(sb.rows('leasing_leads').find(l => l.id === b)!.status).toBe('new');
    });

    it('rejects bad input, unknown rooms, closed leads, and rooms with a lease in force', async () => {
        const id = await leadId();
        for (const bad of [{ reserved_until: d(-1) }, { reserved_until: d(200) }, { deposit: -5 }, { lead_id: 'x' }]) expect((await reserve(id, bad)).statusCode).toBe(400);
        expect((await reserve(id, { room_id: 'ghost' })).body.error).toBe('room_not_found');
        expect((await reserve(id, { room_id: 'x1' })).body.error).toBe('room_not_found');
        await call(OWNER, { action: 'lease_create', room_id: 'r2', ...terms() });
        expect((await reserve(id, { room_id: 'r2' })).body.error).toBe('room_leased');
        await call(OWNER, { action: 'lead_move', lead_id: id, status: 'lost' });
        expect((await reserve(id)).body.error).toBe('lead_closed');
    });

    it('cancelling frees the room and returns the lead to the pipeline', async () => {
        const a = await leadId(); const b = await leadId();
        const res = (await reserve(a)).body.reservation;
        expect((await call(OWNER, { action: 'reservation_cancel', reservation_id: res.id, reason: 'ลูกค้าเปลี่ยนใจ' })).body.reservation).toMatchObject({ status: 'cancelled', cancel_reason: 'ลูกค้าเปลี่ยนใจ' });
        expect(sb.rows('leasing_leads').find(l => l.id === a)!.status).toBe('viewing');
        expect((await reserve(b)).statusCode).toBe(200); // room is free again
        expect((await call(OWNER, { action: 'reservation_cancel', reservation_id: res.id })).body.error).toBe('reservation_not_active');
    });
});

describe('convert a reservation into a lease', () => {
    it('creates the lease, closes the reservation, and marks the lead won — together', async () => {
        const id = await leadId();
        const res = (await reserve(id)).body.reservation;
        const r = await call(OWNER, { action: 'convert', reservation_id: res.id, ...terms() });
        expect(r.statusCode).toBe(200);
        expect(r.body.lease).toMatchObject({ room_id: 'r1', room_number: 'A01', status: 'active', rent_satang: 350000, deposit_satang: 700000, reservation_id: res.id, lead_id: id });
        expect(sb.rows('leasing_reservations')[0].status).toBe('converted');
        expect(sb.rows('leasing_leads')[0].status).toBe('won');
        expect((await call(OWNER, { action: 'convert', reservation_id: res.id, ...terms() })).body.error).toBe('reservation_not_active');
        expect(sb.rows('leases')).toHaveLength(1);
    });

    it('rejects bad terms and nothing changes', async () => {
        const id = await leadId();
        const res = (await reserve(id)).body.reservation;
        for (const bad of [{ end_date: today }, { rent: -1 }, { tenant_name: '' }, { start_date: 'x' }]) {
            expect((await call(OWNER, { action: 'convert', reservation_id: res.id, ...terms(bad) })).statusCode).toBe(400);
        }
        expect(sb.rows('leasing_reservations')[0].status).toBe('active');
        expect(sb.rows('leases')).toHaveLength(0);
    });

    it('is refused if the room already has a lease in force, and leaves the reservation untouched', async () => {
        const id = await leadId();
        const res = (await reserve(id)).body.reservation;
        sb.seed('leases', { id: 'existing', owner_uid: OWNER, building_id: B1, room_id: 'r1', room_number: 'A01', tenant_name: 'คนเดิม', start_date: d(-100), end_date: d(100), rent_satang: 1, status: 'active', created_by: 'u' });
        const r = await call(OWNER, { action: 'convert', reservation_id: res.id, ...terms() });
        expect(r.body.error).toBe('room_has_active_lease');
        expect(sb.rows('leasing_reservations')[0].status).toBe('active');
        expect(sb.rows('leasing_leads')[0].status).toBe('reserved');
    });
});

describe('leases: create, renew, activate, end', () => {
    const create = (over: Record<string, unknown> = {}) => call(OWNER, { action: 'lease_create', room_id: 'r1', ...terms(over) });

    it('creates an active lease; a future start waits as scheduled; one lease per room in force', async () => {
        const a = await create();
        expect(a.body.lease.status).toBe('active');
        expect((await create()).body.error).toBe('room_has_active_lease');
        const future = await call(OWNER, { action: 'lease_create', room_id: 'r2', ...terms({ start_date: d(30), end_date: d(394) }) });
        expect(future.body.lease.status).toBe('scheduled');
        expect((await call(OWNER, { action: 'lease_create', room_id: 'ghost', ...terms() })).statusCode).toBe(404);
        expect((await call('fin', { action: 'lease_create', room_id: 'r2', ...terms() })).statusCode).toBe(403);
    });

    it('renews into a scheduled lease that starts after the current one ends, once only', async () => {
        const lease = (await create({ end_date: d(30), start_date: d(-335) })).body.lease;
        const renewal = await call(OWNER, { action: 'lease_renew', lease_id: lease.id, rent: 3700 });
        expect(renewal.statusCode).toBe(200);
        expect(renewal.body.lease).toMatchObject({ status: 'scheduled', renewal_of: lease.id, start_date: d(31), rent_satang: 370000, deposit_satang: 0, room_id: 'r1' });
        expect((await call(OWNER, { action: 'lease_renew', lease_id: lease.id })).body.error).toBe('already_renewed');
        const overlapping = (await create({ start_date: d(-5), end_date: d(360) })).statusCode; // room is taken
        expect(overlapping).toBe(409);
    });

    it('refuses a renewal that overlaps the current term', async () => {
        const lease = (await create({ end_date: d(30), start_date: d(-335) })).body.lease;
        expect((await call(OWNER, { action: 'lease_renew', lease_id: lease.id, start_date: d(10), end_date: d(400) })).statusCode).toBe(400);
        expect(sb.rows('leases')).toHaveLength(1);
    });

    it('activating a renewal needs the old lease ended first and the start date reached', async () => {
        const lease = (await create({ end_date: d(1), start_date: d(-364) })).body.lease;
        const renewal = (await call(OWNER, { action: 'lease_renew', lease_id: lease.id })).body.lease;
        expect((await call(OWNER, { action: 'lease_activate', lease_id: renewal.id })).body.error).toBe('not_started_yet');
        sb.rows('leases').find(l => l.id === renewal.id)!.start_date = today; // time passes
        expect((await call(OWNER, { action: 'lease_activate', lease_id: renewal.id })).body.error).toBe('room_has_active_lease');
        expect((await call(OWNER, { action: 'lease_end', lease_id: lease.id, ended_on: today })).body.lease.status).toBe('ended');
        expect((await call(OWNER, { action: 'lease_activate', lease_id: renewal.id })).body.lease.status).toBe('active');
        expect((await call(OWNER, { action: 'lease_activate', lease_id: renewal.id })).body.error).toBe('lease_not_scheduled');
    });

    it('ends a lease normally or terminates it early (reason required)', async () => {
        const lease = (await create()).body.lease;
        expect((await call(OWNER, { action: 'lease_end', lease_id: lease.id, ended_on: today, terminated: true })).statusCode).toBe(400);
        expect((await call(OWNER, { action: 'lease_end', lease_id: lease.id, ended_on: d(-1000) })).statusCode).toBe(400);
        const r = await call(OWNER, { action: 'lease_end', lease_id: lease.id, ended_on: today, terminated: true, reason: 'ย้ายงาน' });
        expect(r.body.lease).toMatchObject({ status: 'terminated', ended_on: today, end_reason: 'ย้ายงาน' });
        expect((await call(OWNER, { action: 'lease_end', lease_id: lease.id, ended_on: today })).body.error).toBe('lease_not_active');
        expect((await create()).statusCode).toBe(200); // the room is free again
    });

    it('leases of other properties are unreachable', async () => {
        const lease = (await create()).body.lease;
        expect((await call(OWNER, { action: 'lease_end', lease_id: lease.id, ended_on: today, building_id: B2 })).statusCode).toBe(404);
        expect((await call(OWNER, { action: 'overview', building_id: B2 })).body.leases).toEqual([]);
    });

    it('everything is audited without leaking phone numbers', async () => {
        await create();
        const logs = listPaths(`users/${OWNER}/audit_logs/`).map(p => read(p)!);
        expect(logs.length).toBeGreaterThan(0);
        expect(JSON.stringify(logs)).not.toContain('0812345678');
    });
});

describe('overview', () => {
    it('returns the property\'s leads, reservations and leases, newest first', async () => {
        const id = await leadId();
        await reserve(id);
        await call(OWNER, { action: 'lease_create', room_id: 'r2', ...terms() });
        const r = await call('fin', { action: 'overview' });
        expect(r.body.leads).toHaveLength(1);
        expect(r.body.reservations).toHaveLength(1);
        expect(r.body.leases).toHaveLength(1);
    });
});