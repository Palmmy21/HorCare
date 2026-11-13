import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import { FakeSupabase } from './_fake-supabase.js';
const sb = new FakeSupabase();
vi.mock('./_supabase.js', async () => {
    const real = await vi.importActual<typeof import('./_supabase.js')>('./_supabase.js');
    return { ...real, supabase: () => sb };
});

import handler from './_rental-parties.js';
import { addAuthUser, fakeReq, fakeRes, listPaths, read, resetFake, seed } from './_fake-firestore.js';
import { permissionsForRole } from '../src/shared/permissions.js';
import { todayTh } from '../src/shared/market.js';

const OWNER = 'owner-1';
const BLD = 'bld-1';
const B = `users/${OWNER}/buildings/${BLD}`;
const LEASE = '11111111-1111-4111-8111-111111111111';
const month = todayTh().slice(0, 7);

beforeEach(() => {
    resetFake(); sb.reset();
    for (const [u, n] of [[OWNER, 'Owner'], ['desk', 'Desk'], ['fin', 'Fin']]) addAuthUser(u, `${u}@x.com`, n);
    seed(`users/${OWNER}`, { uid: OWNER });
    seed(B, { id: BLD });
    seed(`${B}/data/config`, { bill_customization: { dorm_name: 'Condo A' } });
    seed(`${B}/rooms/r1`, { room_number: '820/63', is_active: true });
    seed(`${B}/rooms/r2`, { room_number: '10', is_active: true });
    seed(`${B}/bills/b1`, { room_id: 'r1', room_number: '820/63', month, is_saved: true, payment_status: 'paid', room_rent: 7000, total_bill: 7500 });
    seed(`${B}/bills/b2`, { room_id: 'r2', room_number: '10', month, is_saved: true, payment_status: 'unpaid', room_rent: 5000, total_bill: 5300 });
    for (const [uid, role] of [['desk', 'front_desk'], ['fin', 'finance']] as const)
        seed(`users/${OWNER}/members/${uid}`, { uid, role, permissions: permissionsForRole(role), property_ids: ['*'], status: 'active' });
    sb.seed('leases', { id: LEASE, owner_uid: OWNER, building_id: BLD, room_id: 'r1', room_number: '820/63', tenant_name: 'คุณมานัส', start_date: '2026-01-01', end_date: '2026-12-31', rent_satang: 700000, deposit_satang: 0, status: 'active' });
});

async function call(uid: string | undefined, body: Record<string, unknown>) {
    const res = Object.assign(fakeRes(), { setHeader() { /* headers are not under test */ } });
    await handler(fakeReq({ owner_uid: OWNER, building_id: BLD, ...body }, uid), res as never);
    return res as unknown as { statusCode: number; body: any };
}

describe('subleases', () => {
    it('records B under A\'s lease, inside its term, one at a time', async () => {
        const ok = await call(OWNER, { action: 'sublease_create', lease_id: LEASE, tenant_name: 'สมชาย ใจดี', tenant_phone: '0812345678', start_date: '2026-03-01', end_date: '2026-09-01', rent: 8000 });
        expect(ok.statusCode).toBe(200);
        expect(ok.body.sublease).toMatchObject({ master_tenant: 'คุณมานัส', tenant_name: 'สมชาย ใจดี', rent_satang: 800000, status: 'active' });
        expect((await call(OWNER, { action: 'sublease_create', lease_id: LEASE, tenant_name: 'คนที่สอง', start_date: '2026-08-01', end_date: '2026-10-01' })).body.error).toBe('overlaps_sublease');
        expect((await call(OWNER, { action: 'sublease_create', lease_id: LEASE, tenant_name: 'คนที่สาม', start_date: '2026-10-01', end_date: '2027-03-01' })).body.error).toBe('outside_lease');
        const end = await call(OWNER, { action: 'sublease_end', sublease_id: ok.body.sublease.id });
        expect(end.statusCode).toBe(200);
        expect(read(`${B}/subleases/${ok.body.sublease.id}`)).toMatchObject({ status: 'ended' });
    });
    it('needs leasing.manage, and the lease must be this property\'s', async () => {
        expect((await call('fin', { action: 'sublease_create', lease_id: LEASE, tenant_name: 'สมชาย', start_date: '2026-03-01', end_date: '2026-09-01' })).statusCode).toBe(403);
        sb.seed('leases', { id: '22222222-2222-4222-8222-222222222222', owner_uid: 'someone-else', building_id: BLD, room_id: 'r1', room_number: 'x', tenant_name: 'x', start_date: '2026-01-01', end_date: '2026-12-31', status: 'active' });
        expect((await call(OWNER, { action: 'sublease_create', lease_id: '22222222-2222-4222-8222-222222222222', tenant_name: 'สมชาย', start_date: '2026-03-01', end_date: '2026-09-01' })).statusCode).toBe(404);
    });
});

describe('unit owners', () => {
    async function owner(name = 'คุณจิตรวรรณ', fee: Record<string, unknown> = { fee_type: 'percent', fee_value: 10 }) {
        return (await call(OWNER, { action: 'owner_save', name, payout_to: 'กสิกร 123-4-56789-0', ...fee })).body.owner.id as string;
    }

    it('a room has one owner: assigning it elsewhere moves it', async () => {
        const a = await owner('คุณเอ');
        const b = await owner('คุณบี');
        await call(OWNER, { action: 'owner_rooms', owner_id: a, room_ids: ['r1', 'r2', 'ghost'] });
        expect(read(`${B}/unit_owners/${a}`)!.room_ids).toEqual(['r1', 'r2']);
        await call(OWNER, { action: 'owner_rooms', owner_id: b, room_ids: ['r2'] });
        expect(read(`${B}/unit_owners/${a}`)!.room_ids).toEqual(['r1']);
        expect(read(`${B}/unit_owners/${b}`)!.room_ids).toEqual(['r2']);
    });

    it('works out the month: collected rent − fee, and records the payout', async () => {
        const id = await owner();
        await call(OWNER, { action: 'owner_rooms', owner_id: id, room_ids: ['r1', 'r2'] });
        const st = await call('fin', { action: 'statement', owner_id: id, month });
        expect(st.body.statement).toMatchObject({ rent_billed: 12000, rent_collected: 7000, fee: 700, payout: 6300, outstanding: 5000 });
        expect(st.body.payout).toBeNull();
        expect((await call('desk', { action: 'statement', owner_id: id, month })).statusCode).toBe(403);   // money needs finance.read
        await call('fin', { action: 'payout_mark', owner_id: id, month, amount: 6300 });
        expect((await call('fin', { action: 'statement', owner_id: id, month })).body.payout).toMatchObject({ amount: 6300, paid_by: 'Fin' });
    });

    it('gives the owner a read-only link that names nobody else, and a new link cuts the old one', async () => {
        const id = await owner();
        await call(OWNER, { action: 'owner_rooms', owner_id: id, room_ids: ['r1'] });
        const first = (await call(OWNER, { action: 'owner_link', owner_id: id })).body.url as string;
        const token = new URL(first).searchParams.get('unit')!;
        const page = await call(undefined, { action: 'summary', token });
        expect(page.statusCode).toBe(200);
        expect(page.body).toMatchObject({ owner_name: 'คุณจิตรวรรณ', property: 'Condo A', rooms: [{ room_number: '820/63' }] });
        expect(page.body.months[0]).toMatchObject({ month, rent_collected: 7000, payout: 6300 });
        expect(JSON.stringify(page.body)).not.toContain('คุณมานัส');   // no tenant names
        await call(OWNER, { action: 'owner_link', owner_id: id });
        expect((await call(undefined, { action: 'summary', token })).statusCode).toBe(404);
        expect(listPaths('unit_owner_links/')).toHaveLength(1);
    });
});
