import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);
vi.mock('./_abuse-guard.js', async () => ({ ...(await vi.importActual<typeof import('./_abuse-guard.js')>('./_abuse-guard.js')), rateLimit: async () => ({ ok: true, retryAfterSec: 0 }) }));

import portal, { issuePortalLink } from './_staff-portal.js';
import workOrders from './_work-orders.js';
import { fakeReq, fakeRes, read, resetFake, seed } from './_fake-firestore.js';

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
