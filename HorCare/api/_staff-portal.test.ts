import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);
vi.mock('./_abuse-guard.js', async () => ({ ...(await vi.importActual<typeof import('./_abuse-guard.js')>('./_abuse-guard.js')), rateLimit: async () => ({ ok: true, retryAfterSec: 0 }) }));

import portal, { issuePortalLink } from './_staff-portal.js';
import workOrders from './_work-orders.js';
import { addAuthUser, fakeReq, fakeRes, listPaths, read, resetFake, seed } from './_fake-firestore.js';

const LINE = 'U' + 'a'.repeat(32);
const OTHER_LINE = 'U' + 'b'.repeat(32);
const A = 'users/o1/buildings/bA';
const B = 'users/o2/buildings/bB';

async function call(handler: (req: never, res: never) => Promise<unknown>, body: object) {
    const res = fakeRes();
    await handler(fakeReq(body), res as never);
    return res as unknown as { statusCode: number; body: Record<string, any> };
}
const tokenOf = (url: string | null) => new URL(url!).searchParams.get('sp')!;

const order = (id: string, staffId: string, status: string, extra: object = {}) => ({
    id, organization_id: 'o1', property_id: 'bA', room_id: null, area: `ห้อง ${id}`, work_type: 'repair', description: 'แอร์ไม่เย็น',
    priority: 'normal', due_date: null, status, assigned_staff_id: staffId, assigned_staff_name: 'ช่างเอ', assigned_at: '',
    staff_token_hash: 'x', image_count: 0, completion_note: null, reopen_note: null, events: [], created_by: 'o1', created_by_name: 'O',
    created_at: '', updated_at: '', completed_at: null, closed_at: null, closed_by_name: null, ...extra,
});

beforeEach(() => {
    resetFake();
    // one person who works at two owners' properties, plus a colleague
    seed(`${A}/staff/s1`, { name: 'ช่างเอ', phone: '081-111-2222', role: 'technician', active: true, line_user_id: LINE });
    seed(`${B}/staff/s9`, { name: 'เอ', phone: '0811112222', role: 'housekeeping', active: true, line_user_id: LINE });
    seed(`${A}/staff/s2`, { name: 'คนอื่น', phone: '0899999999', role: 'technician', active: true, line_user_id: OTHER_LINE });
    seed(`${A}/data/config`, { bill_customization: { dorm_name: 'หอ A' } });
    seed(`${B}/data/config`, { bill_customization: { dorm_name: 'หอ B' } });
    seed(`${A}/work_orders/w1`, order('w1', 's1', 'assigned'));
    seed(`${A}/work_orders/w2`, order('w2', 's1', 'closed'));
    seed(`${A}/work_orders/w3`, order('w3', 's2', 'assigned'));
    seed(`${B}/housekeepers/m1`, { name: 'เอ', phone: '+66811112222', is_active: true });
    seed(`${B}/cleaning/c1`, { room_number: '201', service_type: 'general', status: 'assigned', assigned_maid_id: 'm1' });
    seed(`${B}/cleaning/c2`, { room_number: '202', service_type: 'general', status: 'completed', assigned_maid_id: 'm1' });
});

describe('housekeeper sign-in from LINE (meter page)', () => {
    const claimsOf = (token: string) => JSON.parse(token) as { uid: string; claims: { hk_owner: string; hk_building: string; hk_maid: string; hk_ver: number } };
    const session = async (line = LINE, place?: string) => call(portal, { action: 'housekeeper_session', token: tokenOf(await issuePortalLink(line)), place });
    const manager = async (body: object) => {
        const res = fakeRes();
        await workOrders(fakeReq({ owner_uid: 'o2', building_id: 'bB', ...body }, 'o2') as never, res as never);
        return res as unknown as { statusCode: number };
    };
    beforeEach(() => {
        addAuthUser('o2', 'o2@x.com', 'Owner 2');
        seed('users/o2', { uid: 'o2' });
        seed('users/o2/buildings/bB', { id: 'bB' });
    });

    it('signs a housekeeper in as the property\'s housekeeper account with the same phone', async () => {
        const r = await session();
        expect(r.statusCode).toBe(200);
        expect(r.body.session).toMatchObject({ owner_uid: 'o2', building_id: 'bB', building_name: 'หอ B', maid_id: 'm1', maid_name: 'เอ' });
        expect(claimsOf(r.body.token).claims).toEqual({ hk_owner: 'o2', hk_building: 'bB', hk_maid: 'm1', hk_ver: 0 });
        expect(listPaths(`${B}/housekeepers/`)).toHaveLength(1);
    });

    it('is refused to a technician, to a bad link, and when the manager switched the account off', async () => {
        expect((await session(OTHER_LINE)).statusCode).toBe(403);
        expect((await call(portal, { action: 'housekeeper_session', token: 'x'.repeat(32) })).statusCode).toBe(401);
        seed(`${B}/housekeepers/m1`, { name: 'เอ', phone: '+66811112222', is_active: false });
        expect((await session()).body.error).toBe('account_disabled');
        expect(listPaths(`${B}/housekeepers/`)).toHaveLength(1);
    });

    it('makes a passcode-less account when the manager never made one, and reuses it', async () => {
        seed(`${B}/staff/s9`, { id: 's9', name: 'เอ', phone: '0822223333', role: 'housekeeping', active: true, line_user_id: LINE });
        const first = await session();
        expect(first.statusCode).toBe(200);
        const made = first.body.session.maid_id as string;
        expect(made).not.toBe('m1');
        expect(read(`${B}/housekeepers/${made}`)).toMatchObject({ name: 'เอ', phone: '0822223333', via_line: true, needs_passcode: true, is_active: true, staff_id: 's9' });
        expect(read('housekeepers_auth/0822223333')).toBeUndefined();   // nothing to sign in to from the login page
        expect((await session()).body.session.maid_id).toBe(made);
        expect(listPaths(`${B}/housekeepers/`)).toHaveLength(2);
    });

    it('ends the session when the staff record is switched off or unlinked, and comes back when it is switched on', async () => {
        seed(`${B}/staff/s9`, { id: 's9', name: 'เอ', phone: '0822223333', role: 'housekeeping', active: true, line_user_id: LINE });
        const made = (await session()).body.session.maid_id as string;

        expect((await manager({ action: 'staff_update_info', staff_id: 's9', active: false })).statusCode).toBe(200);
        expect(read(`${B}/housekeepers/${made}`)).toMatchObject({ is_active: false, session_version: 1, off_by_staff: true });

        expect((await manager({ action: 'staff_update_info', staff_id: 's9', active: true })).statusCode).toBe(200);
        const again = await session();
        expect(again.body.session.maid_id).toBe(made);
        expect(claimsOf(again.body.token).claims.hk_ver).toBe(2);       // the token from before stays dead
        expect(read(`${B}/housekeepers/${made}`)).toMatchObject({ is_active: true, session_version: 2 });

        expect((await manager({ action: 'staff_unlink', staff_id: 's9' })).statusCode).toBe(200);
        expect(read(`${B}/housekeepers/${made}`)).toMatchObject({ is_active: true, session_version: 3 });
    });

    it('asks which property when the person keeps house at more than one', async () => {
        seed(`${A}/staff/s7`, { id: 's7', name: 'เอ', phone: '0811112222', role: 'housekeeping', active: true, line_user_id: LINE });
        const ask = await session();
        expect(ask.body.token).toBeUndefined();
        expect(ask.body.places).toEqual(expect.arrayContaining([{ key: 'o1~bA', name: 'หอ A' }, { key: 'o2~bB', name: 'หอ B' }]));
        expect((await session(LINE, 'o2~bB')).body.session.building_id).toBe('bB');
        expect((await session(LINE, 'o9~nope')).body.token).toBeUndefined();
    });
});

describe('staff portal', () => {
    it('only linked LINE accounts get a portal link', async () => {
        expect(await issuePortalLink('U' + 'z'.repeat(32))).toBeNull();
        expect(await issuePortalLink(LINE)).toMatch(/\/\?sp=[A-Za-z0-9_-]{30,}$/);
    });

    it("shows every open job of this person across properties, and nobody else's", async () => {
        const token = tokenOf(await issuePortalLink(LINE));
        const r = await call(portal, { action: 'overview', token });
        expect(r.statusCode).toBe(200);
        expect(r.body.properties).toBe(2);
        expect(r.body.work.map((j: { key: string }) => j.key)).toEqual(['o1~bA~w1']);
        expect(r.body.cleaning.map((j: { key: string; dorm_name: string }) => [j.key, j.dorm_name])).toEqual([['o2~bB~c1', 'หอ B']]);
    });

    it('works on a job from the portal, but never on a colleague’s', async () => {
        const token = tokenOf(await issuePortalLink(LINE));
        const mine = await call(workOrders, { action: 'staff_view', portal: token, job: 'o1~bA~w1' });
        expect(mine.statusCode).toBe(200);
        expect(mine.body.work_order.area).toBe('ห้อง w1');
        expect((await call(workOrders, { action: 'staff_view', portal: token, job: 'o1~bA~w3' })).statusCode).toBe(404);
        expect((await call(workOrders, { action: 'staff_view', portal: 'nope-nope-nope-nope-nope', job: 'o1~bA~w1' })).statusCode).toBe(401);
    });

    it('updates its own housekeeping request', async () => {
        const token = tokenOf(await issuePortalLink(LINE));
        expect((await call(portal, { action: 'cleaning_update', token, job: 'o2~bB~c1', status: 'in_progress' })).statusCode).toBe(200);
        expect(read(`${B}/cleaning/c1`)).toMatchObject({ status: 'in_progress' });
        expect((await call(portal, { action: 'cleaning_update', token, job: 'o2~bB~c1', status: 'completed', note: 'เรียบร้อย' })).statusCode).toBe(200);
        expect(read(`${B}/cleaning/c1`)).toMatchObject({ status: 'completed', completed_by: 'maid', completion_notes: 'เรียบร้อย' });
        // already finished, or someone else's
        expect((await call(portal, { action: 'cleaning_update', token, job: 'o2~bB~c2', status: 'completed' })).statusCode).toBe(404);
        const other = tokenOf(await issuePortalLink(OTHER_LINE));
        expect((await call(portal, { action: 'cleaning_update', token: other, job: 'o2~bB~c1', status: 'in_progress' })).statusCode).toBe(404);
    });

    it('takes an "after" photo with a finished housekeeping job, and only then', async () => {
        const token = tokenOf(await issuePortalLink(LINE));
        const photo = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
        expect((await call(portal, { action: 'cleaning_update', token, job: 'o2~bB~c1', status: 'in_progress', photo })).statusCode).toBe(400);
        expect((await call(portal, { action: 'cleaning_update', token, job: 'o2~bB~c1', status: 'completed', photo: 'javascript:alert(1)' })).statusCode).toBe(400);
        expect((await call(portal, { action: 'cleaning_update', token, job: 'o2~bB~c1', status: 'completed', photo: `data:image/jpeg;base64,${'A'.repeat(700_001)}` })).statusCode).toBe(400);
        expect(read(`${B}/cleaning/c1`)?.status).toBe('assigned');

        expect((await call(portal, { action: 'cleaning_update', token, job: 'o2~bB~c1', status: 'completed', photo })).statusCode).toBe(200);
        expect(read(`${B}/cleaning/c1`)).toMatchObject({ status: 'completed', completion_has_photo: true });
        expect(read(`${B}/cleaning_images/c1__done`)?.data).toBe(photo);
    });

    it('tells the page who may open the meter page', async () => {
        const token = tokenOf(await issuePortalLink(LINE));
        expect((await call(portal, { action: 'overview', token })).body).toMatchObject({ can_meter: true, roles: ['technician', 'housekeeping'] });
        const other = tokenOf(await issuePortalLink(OTHER_LINE));
        expect((await call(portal, { action: 'overview', token: other })).body).toMatchObject({ can_meter: false, roles: ['technician'] });
    });

    it('closes the portal when the person is deactivated or unlinked, and when the link expires', async () => {
        const token = tokenOf(await issuePortalLink(LINE));
        seed(`${A}/staff/s1`, { name: 'ช่างเอ', role: 'technician', active: false, line_user_id: LINE });
        seed(`${B}/staff/s9`, { name: 'เอ', role: 'housekeeping', active: true, line_user_id: null });
        expect((await call(portal, { action: 'overview', token })).statusCode).toBe(401);

        seed(`${B}/staff/s9`, { name: 'เอ', role: 'housekeeping', active: true, line_user_id: LINE });
        const now = Date.now;
        Date.now = () => now() + 31 * 24 * 3600 * 1000;
        try { expect((await call(portal, { action: 'overview', token })).statusCode).toBe(401); } finally { Date.now = now; }
    });
});

describe('a new housekeeping request reaches the housekeepers', () => {
    it('is offered to every housekeeper of the property until one of them takes it', async () => {
        seed(`${B}/cleaning/c9`, { room_number: '305', service_type: 'general', status: 'pending' });
        const token = tokenOf(await issuePortalLink(LINE));
        const before = (await call(portal, { action: 'overview', token })).body.cleaning as { key: string; unassigned?: boolean }[];
        expect(before.find(c => c.key === 'o2~bB~c9')).toMatchObject({ unassigned: true, status: 'pending' });

        expect((await call(portal, { action: 'cleaning_update', token, job: 'o2~bB~c9', status: 'in_progress' })).statusCode).toBe(200);
        expect(read(`${B}/cleaning/c9`)).toMatchObject({ status: 'in_progress', assigned_maid_id: 'm1', assigned_maid_name: 'เอ' });
        const after = (await call(portal, { action: 'overview', token })).body.cleaning as { key: string; unassigned?: boolean }[];
        expect(after.filter(c => c.key === 'o2~bB~c9')).toHaveLength(1);
        expect(after.find(c => c.key === 'o2~bB~c9')?.unassigned).toBeUndefined();
    });

    it('is not offered to, and cannot be taken by, a technician or someone from another property', async () => {
        seed(`${B}/cleaning/c9`, { room_number: '305', service_type: 'general', status: 'pending' });
        const other = tokenOf(await issuePortalLink(OTHER_LINE));
        expect(((await call(portal, { action: 'overview', token: other })).body.cleaning as unknown[])).toEqual([]);
        expect((await call(portal, { action: 'cleaning_update', token: other, job: 'o2~bB~c9', status: 'in_progress' })).statusCode).toBe(404);
        expect(read(`${B}/cleaning/c9`)?.assigned_maid_id).toBeUndefined();
    });

    it('finishing a job tells the people who manage jobs', async () => {
        seed('users/o2', { uid: 'o2' });
        const token = tokenOf(await issuePortalLink(LINE));
        await call(portal, { action: 'cleaning_update', token, job: 'o2~bB~c1', status: 'completed', note: 'เรียบร้อย' });
        const inbox = listPaths('users/o2/inbox/').map(p => read(p)!);
        expect(inbox).toHaveLength(1);
        expect(inbox[0]).toMatchObject({ type: 'job_status', kind: 'cleaning', building_id: 'bB' });
        expect(String(inbox[0].title)).toContain('ทำเสร็จแล้ว ห้อง 201');
    });
});
