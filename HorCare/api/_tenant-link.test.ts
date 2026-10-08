import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import invitations, { redeemInvitation } from './_invitations.js';
import tenantLink from './_tenant-link.js';
import securityAlerts from './_security-alerts.js';
import { addAuthUser, fakeReq, fakeRes, listPaths, read, resetFake, seed } from './_fake-firestore.js';
import { permissionsForRole } from '../src/shared/permissions.js';

const OWNER = 'owner-1';
const BLD = 'bld-A';
const B = `users/${OWNER}/buildings/${BLD}`;
const LINE_A = 'U' + 'a'.repeat(31) + '1';
const LINE_B = 'U' + 'b'.repeat(31) + '2';
const fetchMock = vi.fn();

beforeEach(() => {
    resetFake();
    for (const [u, n] of [[OWNER, 'Owner'], ['mgr', 'Mgr'], ['desk', 'Desk'], ['other-owner', 'Other']]) addAuthUser(u, `${u}@x.com`, n);
    seed(`users/${OWNER}`, { uid: OWNER });
    seed(B, { id: BLD });
    seed(`users/${OWNER}/buildings/bld-B`, { id: 'bld-B' });
    seed(`${B}/data/config`, { bill_customization: { dorm_name: 'Dorm A', due_day: 5 } });
    for (const [id, n] of [['r101', '101'], ['r102', '102'], ['r103', '103']]) {
        seed(`${B}/rooms/${id}`, { room_number: n, is_active: true });
        seed(`${B}/tenants/${id}`, { full_name: `T${n}` });
    }
    seed(`users/${OWNER}/buildings/bld-B/rooms/rB`, { room_number: 'B1', is_active: true });
    seed(`users/${OWNER}/members/mgr`, { uid: 'mgr', role: 'property_manager', permissions: permissionsForRole('property_manager'), property_ids: ['*'], status: 'active' });
    seed(`users/${OWNER}/members/desk`, { uid: 'desk', role: 'front_desk', permissions: permissionsForRole('front_desk'), property_ids: ['*'], status: 'active' });
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '', headers: new Headers() });
    vi.stubGlobal('fetch', fetchMock);
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'tok';
});
afterEach(() => { vi.unstubAllGlobals(); delete process.env.LINE_CHANNEL_ACCESS_TOKEN; });

async function invite(roomId: string, over: Record<string, unknown> = {}) {
    const res = fakeRes();
    await invitations(fakeReq({ action: 'create', owner_uid: OWNER, building_id: BLD, room_id: roomId, ...over }, OWNER), res as never);
    return (res.body as { code: string }).code;
}
const alerts = () => listPaths(`${B}/security_alerts/`).map(p => read(p)!);
async function link(uid: string | null, body: Record<string, unknown>) {
    const res = fakeRes();
    await tenantLink(fakeReq({ owner_uid: OWNER, building_id: BLD, ...body }, uid ?? undefined), res as never);
    return res as { statusCode: number; body: any };
}
async function sec(uid: string | null, body: Record<string, unknown>) {
    const res = fakeRes();
    await securityAlerts(fakeReq({ owner_uid: OWNER, building_id: BLD, ...body }, uid ?? undefined), res as never);
    return res as { statusCode: number; body: any };
}

describe('binding alerts', () => {
    it('a first binding raises an info alert that stores only the last 4 characters of the LINE id', async () => {
        await redeemInvitation(LINE_A, await invite('r101'));
        expect(alerts()).toHaveLength(1);
        expect(alerts()[0]).toMatchObject({ type: 'line_bound', severity: 'info', room_number: '101', status: 'open', via: 'invitation', line_ref: 'aaa1'.slice(-4) });
        expect(JSON.stringify(alerts()[0])).not.toContain(LINE_A);
    });

    it('moving a LINE account to another room raises a warning naming both rooms', async () => {
        await redeemInvitation(LINE_A, await invite('r101'));
        await redeemInvitation(LINE_A, await invite('r102'));
        const moved = alerts().find(a => a.type === 'line_moved')!;
        expect(moved).toMatchObject({ severity: 'warning', room_number: '102', from_room_number: '101' });
    });

    it('replacing the room\'s LINE account raises a warning', async () => {
        await redeemInvitation(LINE_A, await invite('r101'));
        await redeemInvitation(LINE_B, await invite('r101', { replace_existing: true }));
        expect(alerts().some(a => a.type === 'line_replaced' && a.severity === 'warning')).toBe(true);
    });

    it('re-scanning your own code does not raise another alert', async () => {
        const code = await invite('r101');
        await redeemInvitation(LINE_A, code);
        await redeemInvitation(LINE_A, code);
        expect(alerts()).toHaveLength(1);
    });

    it('a failed redemption raises nothing', async () => {
        await redeemInvitation(LINE_A, 'HCI-NOPENOPE22');
        expect(alerts()).toHaveLength(0);
    });
});

describe('tenant-link: move / unlink', () => {
    beforeEach(async () => {
        await redeemInvitation(LINE_A, await invite('r101'));
        seed(`${B}/line_threads/${LINE_A}`, { line_user_id: LINE_A, room_id: 'r101', room_number: '101' });
    });

    it('moves the binding to the right room, updates thread, informs the tenant, and audits', async () => {
        const res = await link('mgr', { action: 'move', room_id: 'r101', to_room_id: 'r102' });
        expect(res.statusCode).toBe(200);
        expect(read(`${B}/rooms/r101`)!.line_user_id).toBeUndefined();
        expect(read(`${B}/rooms/r102`)!.line_user_id).toBe(LINE_A);
        expect(read(`line_rooms/${LINE_A}`)).toMatchObject({ room_id: 'r102', room_number: '102', uid: OWNER, building_id: BLD });
        expect(read(`${B}/line_threads/${LINE_A}`)).toMatchObject({ room_id: 'r102', room_number: '102' });
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ to: LINE_A });
        expect(listPaths(`users/${OWNER}/audit_logs/`).map(p => read(p)!).some(l => l.resource_type === 'line_link')).toBe(true);
    });

    it('never displaces another tenant, and validates rooms', async () => {
        await redeemInvitation(LINE_B, await invite('r102'));
        expect((await link(OWNER, { action: 'move', room_id: 'r101', to_room_id: 'r102' })).body.error).toBe('target_occupied');
        expect(read(`${B}/rooms/r101`)!.line_user_id).toBe(LINE_A);
        expect((await link(OWNER, { action: 'move', room_id: 'r101', to_room_id: 'ghost' })).statusCode).toBe(404);
        expect((await link(OWNER, { action: 'move', room_id: 'ghost', to_room_id: 'r103' })).statusCode).toBe(404);
        expect((await link(OWNER, { action: 'move', room_id: 'r103', to_room_id: 'r102' })).body.error).toBe('not_linked');
        expect((await link(OWNER, { action: 'move', room_id: 'r101', to_room_id: 'r101' })).statusCode).toBe(400);
        expect((await link(OWNER, { action: 'move', room_id: 'r101' })).statusCode).toBe(400);
        seed(`${B}/rooms/r103`, { room_number: '103', is_active: false });
        expect((await link(OWNER, { action: 'move', room_id: 'r101', to_room_id: 'r103' })).statusCode).toBe(404);
    });

    it('cannot reach rooms of another property', async () => {
        expect((await link(OWNER, { action: 'move', room_id: 'r101', to_room_id: 'rB' })).statusCode).toBe(404);
        expect((await link(OWNER, { action: 'unlink', room_id: 'r101', building_id: 'bld-B' })).statusCode).toBe(404);
    });

    it('unlink removes the binding on both sides', async () => {
        expect((await link('mgr', { action: 'unlink', room_id: 'r101' })).statusCode).toBe(200);
        expect(read(`${B}/rooms/r101`)!.line_user_id).toBeUndefined();
        expect(read(`line_rooms/${LINE_A}`)).toBeUndefined();
        expect((await link('mgr', { action: 'unlink', room_id: 'r101' })).body.error).toBe('not_linked');
    });

    it('refuses a registration that belongs to another property', async () => {
        seed(`line_rooms/${LINE_A}`, { uid: 'someone-else', building_id: 'x', room_id: 'r101', room_number: '101' });
        expect((await link(OWNER, { action: 'move', room_id: 'r101', to_room_id: 'r102' })).body.error).toBe('link_mismatch');
        expect(read(`${B}/rooms/r102`)!.line_user_id).toBeUndefined();
    });

    it('only owner and property manager; others and anonymous are refused', async () => {
        expect((await link('desk', { action: 'unlink', room_id: 'r101' })).statusCode).toBe(403);
        expect((await link('other-owner', { action: 'unlink', room_id: 'r101' })).statusCode).toBe(403);
        expect((await link(null, { action: 'unlink', room_id: 'r101' })).statusCode).toBe(401);
        expect((await link(OWNER, { action: 'nuke', room_id: 'r101' })).statusCode).toBe(400);
        expect(read(`${B}/rooms/r101`)!.line_user_id).toBe(LINE_A);
    });
});

describe('security-alerts: acknowledge', () => {
    it('ack and ack_all mark alerts, permission-checked', async () => {
        await redeemInvitation(LINE_A, await invite('r101'));
        await redeemInvitation(LINE_B, await invite('r102'));
        const [first] = alerts();
        expect((await sec('desk', { action: 'ack_all' })).statusCode).toBe(403);
        expect((await sec(null, { action: 'ack_all' })).statusCode).toBe(401);
        expect((await sec('mgr', { action: 'ack', alert_id: first.id })).body.acknowledged).toBe(1);
        expect(alerts().filter(a => a.status === 'acknowledged')).toHaveLength(1);
        expect((await sec(OWNER, { action: 'ack_all' })).body.acknowledged).toBe(1);
        expect(alerts().every(a => a.status === 'acknowledged' && a.ack_by)).toBe(true);
        expect((await sec(OWNER, { action: 'ack', alert_id: 'ghost' })).statusCode).toBe(404);
        expect((await sec(OWNER, { action: 'ack' })).statusCode).toBe(400);
    });
});