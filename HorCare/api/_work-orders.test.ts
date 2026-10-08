import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import handler, { isStaffLinkCode, redeemStaffLink } from './_work-orders.js';
import { buildWorkOrderFlex, renderMessage } from './_notify.js';
import { addAuthUser, fakeReq, fakeRes, listPaths, read, resetFake, seed } from './_fake-firestore.js';
import { permissionsForRole } from '../src/shared/permissions.js';
import { canTransition, isOverdue } from '../src/shared/workOrders.js';

const OWNER = 'owner-1';
const BLD = 'bld-A';
const B = `users/${OWNER}/buildings/${BLD}`;
const LINE_STAFF = 'U' + 's'.repeat(32);

function member(uid: string, role: 'property_manager' | 'front_desk' | 'technician', property_ids = ['*']) {
    seed(`users/${OWNER}/members/${uid}`, { uid, role, permissions: permissionsForRole(role), property_ids, status: 'active' });
}

beforeEach(() => {
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    resetFake();
    addAuthUser(OWNER, 'o@x.com', 'Owner');
    addAuthUser('mgr', 'm@x.com', 'Manager');
    addAuthUser('desk', 'd@x.com', 'Desk');
    addAuthUser('tech', 't@x.com', 'Tech');
    addAuthUser('other-owner', 'oo@x.com');
    seed(`users/${OWNER}`, { uid: OWNER });
    seed(B, { id: BLD });
    seed(`${B}/data/config`, { bill_customization: { dorm_name: 'Dorm A' } });
    seed(`${B}/rooms/r101`, { room_number: '101', is_active: true });
    seed(`${B}/rooms/r102`, { room_number: '102', is_active: false });
    seed(`users/${OWNER}/buildings/bld-B`, { id: 'bld-B' });
    seed(`users/${OWNER}/buildings/bld-B/rooms/rB1`, { room_number: 'B1', is_active: true });
});

async function call(uid: string | undefined, body: Record<string, unknown>) {
    const res = fakeRes();
    await handler(fakeReq({ owner_uid: OWNER, building_id: BLD, ...body }, uid), res as never);
    return res;
}
type R = { statusCode: number; body: any };

async function newStaff(role = 'technician', name = 'Somsak') {
    const res = (await call(OWNER, { action: 'staff_create', name, role, phone: '0812345678' })) as R;
    return res.body.staff.id as string;
}
async function newOrder(over: Record<string, unknown> = {}) {
    const res = (await call(OWNER, { action: 'create', room_id: 'r101', work_type: 'repair', description: 'Leaking tap', priority: 'high', ...over })) as R;
    return res;
}
/** Assign and return the staff link the manager would send. */
async function assigned(staffId?: string) {
    const sid = staffId ?? await newStaff();
    const created = (await newOrder()) as R;
    const id = created.body.work_order.id as string;
    const a = (await call(OWNER, { action: 'assign', work_order_id: id, staff_id: sid })) as R;
    return { id, sid, link: a.body.link as string, res: a };
}
const linkParam = (url: string) => decodeURIComponent(new URL(url).searchParams.get('w')!);
const staffCall = (link: string, body: Record<string, unknown>) => {
    const res = fakeRes();
    return handler(fakeReq({ link: linkParam(link), ...body }, undefined), res as never).then(() => res as R);
};

describe('staff directory', () => {
    it('manager creates staff; validates input', async () => {
        const id = await newStaff();
        expect(read(`${B}/staff/${id}`)).toMatchObject({ name: 'Somsak', role: 'technician', active: true, line_user_id: null });
        for (const bad of [{ name: '', role: 'technician' }, { name: 'x', role: 'ceo' }, { name: 'x'.repeat(81), role: 'technician' }]) {
            expect(((await call(OWNER, { action: 'staff_create', ...bad })) as R).statusCode).toBe(400);
        }
    });

    it('needs work_order.create; outsiders and cross-property members are refused', async () => {
        expect(((await call(undefined, { action: 'staff_create', name: 'A', role: 'technician' })) as R).statusCode).toBe(401);
        expect(((await call('other-owner', { action: 'staff_create', name: 'A', role: 'technician' })) as R).statusCode).toBe(403);
        member('tech', 'technician');
        expect(((await call('tech', { action: 'staff_create', name: 'A', role: 'technician' })) as R).statusCode).toBe(403);
        member('desk', 'front_desk', ['bld-B']);
        expect(((await call('desk', { action: 'staff_create', name: 'A', role: 'technician' })) as R).statusCode).toBe(403);
    });

    it('LINE link: code binds the sender to the staff member, once', async () => {
        const sid = await newStaff();
        const { code } = (await call(OWNER, { action: 'staff_link_code', staff_id: sid })).body as { code: string };
        expect(isStaffLinkCode(code)).toBe(true);
        const r = await redeemStaffLink(LINE_STAFF, code);
        expect(r).toMatchObject({ ok: true, staffName: 'Somsak', dormName: 'Dorm A' });
        expect(read(`${B}/staff/${sid}`)?.line_user_id).toBe(LINE_STAFF);
        expect(await redeemStaffLink('U' + 'z'.repeat(32), code)).toEqual({ ok: false, reason: 'used' });
        expect(await redeemStaffLink(LINE_STAFF, 'HCS-AAAAAAAA')).toEqual({ ok: false, reason: 'not_found' });
        expect(await redeemStaffLink(LINE_STAFF, 'garbage')).toEqual({ ok: false, reason: 'not_found' });
    });

    it('expired codes and deactivated staff cannot link', async () => {
        const sid = await newStaff();
        const { code } = (await call(OWNER, { action: 'staff_link_code', staff_id: sid })).body as { code: string };
        const [p] = listPaths('staff_links/');
        seed(p, { ...read(p)!, expires_at: Date.now() - 1 });
        expect(await redeemStaffLink(LINE_STAFF, code)).toEqual({ ok: false, reason: 'expired' });
        seed(p, { ...read(p)!, expires_at: Date.now() + 1000 });
        await call(OWNER, { action: 'staff_update_info', staff_id: sid, active: false });
        expect(await redeemStaffLink(LINE_STAFF, code)).toEqual({ ok: false, reason: 'staff_unavailable' });
        expect(((await call(OWNER, { action: 'staff_link_code', staff_id: sid })) as R).statusCode).toBe(409);
    });
});

describe('creating work orders', () => {
    it('happy path for a room job; audited; no token hash leaks to the response', async () => {
        const res = await newOrder({ images: ['AAAA'] });
        expect(res.statusCode).toBe(200);
        const wo = res.body.work_order;
        expect(wo).toMatchObject({ area: 'ห้อง 101', status: 'created', work_type: 'repair', priority: 'high', image_count: 1 });
        expect(wo.staff_token_hash).toBeUndefined();
        expect(listPaths(`${B}/work_order_images/`)).toHaveLength(1);
        expect(listPaths(`users/${OWNER}/audit_logs/`)).toHaveLength(1);
    });

    it('common-area job needs an area; room and area rules', async () => {
        expect((await newOrder({ room_id: undefined, area: 'Lobby' })).statusCode).toBe(200);
        expect((await newOrder({ room_id: undefined })).statusCode).toBe(400);
        expect((await newOrder({ room_id: 'r102' })).statusCode).toBe(404);   // inactive
        expect((await newOrder({ room_id: 'rB1' })).statusCode).toBe(404);    // other property
    });

    it('validates type, priority, due date, description and images', async () => {
        for (const bad of [
            { work_type: 'party' }, { priority: 'asap' }, { due_date: 'tomorrow' }, { due_date: '2026-13-45' },
            { description: '' }, { description: 'x'.repeat(1001) },
            { images: ['AAAA', 'AAAA', 'AAAA', 'AAAA'] }, { images: ['<svg>'] }, { images: 'AAAA' },
        ]) {
            expect((await newOrder(bad)).statusCode).toBe(400);
        }
        expect(listPaths(`${B}/work_orders/`)).toHaveLength(0);
    });

    it('create + assign in one step moves to assigned and notifies', async () => {
        const sid = await newStaff();
        const res = await newOrder({ assign_staff_id: sid });
        expect(res.body.work_order.status).toBe('assigned');
        expect(res.body.link).toContain('/?w=');
        expect(res.body.notify).toEqual({ line: 'skipped', in_app: 'sent' });
    });

    it('rejects an unknown or inactive staff member without creating the order', async () => {
        expect((await newOrder({ assign_staff_id: 'ghost' })).statusCode).toBe(404);
        expect(listPaths(`${B}/work_orders/`)).toHaveLength(0);
    });
});

describe('assigning', () => {
    it('stores only a hash of the link secret and tells the manager if LINE is not connected', async () => {
        const { id, link, res } = await assigned();
        const secret = linkParam(link).split('~')[3];
        expect(JSON.stringify(read(`${B}/work_orders/${id}`))).not.toContain(secret);
        expect(read(`${B}/work_orders/${id}`)?.staff_token_hash).toHaveLength(64);
        expect(res.body.notify.line).toBe('skipped');
    });

    it('reassigning issues a new link and kills the old one', async () => {
        const { id, link } = await assigned();
        const other = await newStaff('housekeeping', 'Malee');
        const b = (await call(OWNER, { action: 'assign', work_order_id: id, staff_id: other })) as R;
        expect(b.statusCode).toBe(200);
        expect((await staffCall(link, { action: 'staff_view' })).statusCode).toBe(404);
        expect((await staffCall(b.body.link, { action: 'staff_view' })).statusCode).toBe(200);
    });

    it('cannot assign once work has started or finished (409), nor to unknown staff (404)', async () => {
        const { id, link, sid } = await assigned();
        await staffCall(link, { action: 'staff_update', status: 'accepted' });
        await staffCall(link, { action: 'staff_update', status: 'in_progress' });
        expect(((await call(OWNER, { action: 'assign', work_order_id: id, staff_id: sid })) as R).statusCode).toBe(409);
        const fresh = (await newOrder()).body.work_order.id;
        expect(((await call(OWNER, { action: 'assign', work_order_id: fresh, staff_id: 'ghost' })) as R).statusCode).toBe(404);
    });

    it('a technician (work_order.update only) cannot assign', async () => {
        const id = (await newOrder()).body.work_order.id;
        member('tech', 'technician');
        expect(((await call('tech', { action: 'assign', work_order_id: id, staff_id: 'x' })) as R).statusCode).toBe(403);
    });
});

describe('staff link access', () => {
    it('view shows the job but nothing internal', async () => {
        const { link } = await assigned();
        const res = await staffCall(link, { action: 'staff_view' });
        expect(res.statusCode).toBe(200);
        expect(res.body.work_order).toMatchObject({ area: 'ห้อง 101', staff_name: 'Somsak', dorm_name: 'Dorm A', status: 'assigned' });
        expect(JSON.stringify(res.body)).not.toMatch(/staff_token_hash|organization_id|created_by|events/);
    });

    it('rejects malformed links, wrong secrets and other jobs with the same 404', async () => {
        const { link, id } = await assigned();
        const parts = linkParam(link).split('~');
        const forge = (p: string[]) => ({ link: p.join('~') });
        for (const bad of [
            { link: 'nonsense' }, { link: '' }, { link: undefined }, forge([parts[0], parts[1], parts[2], 'WRONGSECRETWRONGSECRET']),
            forge([parts[0], parts[1], 'other-id', parts[3]]),
        ]) {
            const res = fakeRes();
            await handler(fakeReq({ action: 'staff_view', ...bad }, undefined), res as never);
            expect([400, 404]).toContain(res.statusCode);
        }
        // a second order's secret must not open the first
        const sid = await newStaff('technician', 'Other');
        const second = (await newOrder()).body.work_order.id;
        const l2 = ((await call(OWNER, { action: 'assign', work_order_id: second, staff_id: sid })) as R).body.link as string;
        const mixed = linkParam(l2).split('~'); mixed[2] = id;
        const res = fakeRes();
        await handler(fakeReq({ action: 'staff_view', link: mixed.join('~') }, undefined), res as never);
        expect(res.statusCode).toBe(404);
    });

    it('deactivated staff lose access immediately', async () => {
        const { link, sid } = await assigned();
        await call(OWNER, { action: 'staff_update_info', staff_id: sid, active: false });
        expect((await staffCall(link, { action: 'staff_view' })).statusCode).toBe(404);
    });

    it('issue photos are visible to the assigned staff', async () => {
        const sid = await newStaff();
        const created = await newOrder({ images: ['AAAA'] });
        const id = created.body.work_order.id;
        const link = ((await call(OWNER, { action: 'assign', work_order_id: id, staff_id: sid })) as R).body.link;
        const res = await staffCall(link, { action: 'staff_images' });
        expect(res.body.images).toEqual([expect.objectContaining({ kind: 'issue', data_url: 'data:image/jpeg;base64,AAAA' })]);
    });
});

describe('workflow', () => {
    it('Created → Assigned → Accepted → In Progress → Completed → Closed', async () => {
        const { id, link } = await assigned();
        expect((await staffCall(link, { action: 'staff_update', status: 'accepted' })).statusCode).toBe(200);
        expect((await staffCall(link, { action: 'staff_update', status: 'in_progress', note: 'Started' })).statusCode).toBe(200);
        const done = await staffCall(link, { action: 'staff_update', status: 'completed', note: 'Replaced washer', images: [{ kind: 'after', base64: 'AAAA' }] });
        expect(done.statusCode).toBe(200);
        expect(read(`${B}/work_orders/${id}`)).toMatchObject({ status: 'completed', completion_note: 'Replaced washer', image_count: 1 });
        expect(read(`${B}/work_orders/${id}`)?.completed_at).toBeTruthy();
        expect(((await call(OWNER, { action: 'verify', work_order_id: id })) as R).statusCode).toBe(200);
        expect(read(`${B}/work_orders/${id}`)).toMatchObject({ status: 'closed', closed_by_name: 'Owner' });
        // closed jobs can no longer be touched through the link
        expect((await staffCall(link, { action: 'staff_view' })).statusCode).toBe(404);
    });

    it('staff cannot skip steps or go backwards (409)', async () => {
        const { link } = await assigned();
        expect((await staffCall(link, { action: 'staff_update', status: 'in_progress' })).statusCode).toBe(409);
        expect((await staffCall(link, { action: 'staff_update', status: 'completed' })).statusCode).toBe(409);
        await staffCall(link, { action: 'staff_update', status: 'accepted' });
        expect((await staffCall(link, { action: 'staff_update', status: 'accepted' })).statusCode).toBe(409);
        expect((await staffCall(link, { action: 'staff_update', status: 'closed' })).statusCode).toBe(400);
    });

    it('staff cannot close their own job; verify needs work_order.verify', async () => {
        const { id, link } = await assigned();
        for (const s of ['accepted', 'in_progress', 'completed']) await staffCall(link, { action: 'staff_update', status: s });
        // once completed the link is read-only for staff: no status change of any kind
        for (const s of ['closed', 'in_progress', 'completed']) {
            expect((await staffCall(link, { action: 'staff_update', status: s })).statusCode).toBe(409);
        }
        expect(read(`${B}/work_orders/${id}`)?.status).toBe('completed');
        member('tech', 'technician');
        member('desk', 'front_desk');
        expect(((await call('tech', { action: 'verify', work_order_id: id })) as R).statusCode).toBe(403);
        expect(((await call('desk', { action: 'verify', work_order_id: id })) as R).statusCode).toBe(403);
        member('mgr', 'property_manager');
        expect(((await call('mgr', { action: 'verify', work_order_id: id })) as R).statusCode).toBe(200);
    });

    it('verify only works on completed jobs; reopen needs a reason and unlocks the link', async () => {
        const { id, link } = await assigned();
        expect(((await call(OWNER, { action: 'verify', work_order_id: id })) as R).statusCode).toBe(409);
        for (const s of ['accepted', 'in_progress', 'completed']) await staffCall(link, { action: 'staff_update', status: s });
        expect(((await call(OWNER, { action: 'reopen', work_order_id: id })) as R).statusCode).toBe(400);
        expect(((await call(OWNER, { action: 'reopen', work_order_id: id, note: 'Still leaking' })) as R).statusCode).toBe(200);
        expect(read(`${B}/work_orders/${id}`)).toMatchObject({ status: 'in_progress', reopen_note: 'Still leaking', completed_at: null });
        expect((await staffCall(link, { action: 'staff_update', status: 'completed', note: 'Fixed again' })).statusCode).toBe(200);
    });

    it('notes and photos can be added while working; limits and validation apply', async () => {
        const { link } = await assigned();
        expect((await staffCall(link, { action: 'staff_update', note: 'Parts ordered', images: [{ kind: 'before', base64: 'AAAA' }] })).statusCode).toBe(200);
        expect((await staffCall(link, { action: 'staff_update' })).statusCode).toBe(400);
        expect((await staffCall(link, { action: 'staff_update', note: 'x'.repeat(501) })).statusCode).toBe(400);
        expect((await staffCall(link, { action: 'staff_update', images: [{ kind: 'hack', base64: 'AAAA' }] })).statusCode).toBe(400);
        expect((await staffCall(link, { action: 'staff_update', images: [{ kind: 'after', base64: '<x>' }] })).statusCode).toBe(400);
        const many = Array.from({ length: 8 }, () => ({ kind: 'after', base64: 'AAAA' }));
        expect((await staffCall(link, { action: 'staff_update', images: many })).statusCode).toBe(409);
    });

    it('every step is audited, including staff actions', async () => {
        const { link } = await assigned();
        const before = listPaths(`users/${OWNER}/audit_logs/`).length;
        await staffCall(link, { action: 'staff_update', status: 'accepted' });
        const logs = listPaths(`users/${OWNER}/audit_logs/`);
        expect(logs.length).toBe(before + 1);
        const last = logs.map(p => read(p)!).find(l => String(l.user_id).startsWith('staff:'));
        expect(last).toMatchObject({ action: 'UPDATE', resource_type: 'work_order' });
    });

    it('unknown actions, missing ids and wrong methods', async () => {
        expect(((await call(OWNER, { action: 'explode' })) as R).statusCode).toBe(400);
        expect(((await call(OWNER, { action: 'verify' })) as R).statusCode).toBe(400);
        expect(((await call(OWNER, { action: 'verify', work_order_id: 'ghost' })) as R).statusCode).toBe(404);
        const noBld = fakeRes();
        await handler(fakeReq({ action: 'create', owner_uid: OWNER }, OWNER), noBld as never);
        expect(noBld.statusCode).toBe(400);
        const get = fakeRes();
        await handler(fakeReq({}, OWNER, 'GET'), get as never);
        expect(get.statusCode).toBe(405);
    });
});

describe('shared rules + LINE message', () => {
    it('transition tables by actor', () => {
        expect(canTransition('staff', 'assigned', 'accepted')).toBe(true);
        expect(canTransition('staff', 'completed', 'closed')).toBe(false);
        expect(canTransition('manager', 'completed', 'closed')).toBe(true);
        expect(canTransition('manager', 'in_progress', 'closed')).toBe(false);
        expect(canTransition('manager', 'closed', 'in_progress')).toBe(false);
    });

    it('overdue ignores finished jobs', () => {
        expect(isOverdue({ due_date: '2026-01-01', status: 'in_progress' }, '2026-02-01')).toBe(true);
        expect(isOverdue({ due_date: '2026-01-01', status: 'completed' }, '2026-02-01')).toBe(false);
        expect(isOverdue({ due_date: null, status: 'assigned' }, '2026-02-01')).toBe(false);
    });

    it('assignment message is a flex card with the details and a "ดูงาน" button', () => {
        const data = { area: 'ห้อง 101', work_type_label: 'ซ่อม', priority: 'urgent', due_date: '2026-10-10', description: 'Leaking tap' };
        const flex = buildWorkOrderFlex(data, 'Dorm A', 'https://x/?w=1') as any;
        const text = JSON.stringify(flex);
        expect(flex.type).toBe('flex');
        expect(text).toContain('ห้อง 101');
        expect(text).toContain('2026-10-10');
        expect(text).toContain('Leaking tap');
        expect(flex.contents.footer.contents[0]).toMatchObject({ type: 'button', action: { type: 'uri', label: 'ดูงาน', uri: 'https://x/?w=1' } });
        expect(flex.altText.length).toBeLessThanOrEqual(400);
        const m = renderMessage('work_order.assigned', data, 'Dorm A', 'https://x/?w=1');
        expect(m.lineMessage).toBeDefined();
        expect(m.body).toContain('https://x/?w=1');
    });
});
