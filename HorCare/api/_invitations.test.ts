import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import handler, { isInvitationToken, redeemInvitation } from './_invitations.js';
import { addAuthUser, fakeReq, fakeRes, listPaths, read, resetFake, seed } from './_fake-firestore.js';
import { permissionsForRole } from '../src/shared/permissions.js';

const OWNER = 'owner-1';
const BLD = 'bld-A';
const ROOM = 'room-101';
const LINE_A = 'U' + 'a'.repeat(32);
const LINE_B = 'U' + 'b'.repeat(32);

beforeEach(() => {
    resetFake();
    addAuthUser(OWNER, 'owner@x.com', 'Owner');
    addAuthUser('staff', 'staff@x.com');
    addAuthUser('other-owner', 'other@x.com');
    seed(`users/${OWNER}`, { uid: OWNER });
    seed(`users/${OWNER}/buildings/${BLD}`, { id: BLD, name: 'Dorm A' });
    seed(`users/${OWNER}/buildings/${BLD}/data/config`, { bill_customization: { dorm_name: 'Dorm A', due_day: 7 } });
    seed(`users/${OWNER}/buildings/${BLD}/rooms/${ROOM}`, { room_number: '101', is_active: true });
    seed(`users/${OWNER}/buildings/${BLD}/rooms/room-102`, { room_number: '102', is_active: true });
    seed(`users/${OWNER}/buildings/${BLD}/tenants/${ROOM}`, { full_name: 'Somchai' });
});

async function create(uid: string | undefined, body: Record<string, unknown> = {}) {
    const res = fakeRes();
    await handler(fakeReq({ action: 'create', owner_uid: OWNER, building_id: BLD, room_id: ROOM, ...body }, uid), res as never);
    return res;
}

describe('creating invitations', () => {
    it('happy path: owner gets a one-time code and an audit event', async () => {
        const res = await create(OWNER);
        expect(res.statusCode).toBe(200);
        const { code, one_time } = res.body as { code: string; one_time: boolean };
        expect(isInvitationToken(code)).toBe(true);
        expect(one_time).toBe(true);
        // only the hash is stored — never the plaintext code
        const invitePaths = listPaths('invitations/');
        expect(invitePaths).toHaveLength(1);
        expect(JSON.stringify(read(invitePaths[0]))).not.toContain(code);
        expect(listPaths(`users/${OWNER}/audit_logs/`)).toHaveLength(1);
    });

    it('rejects unauthenticated callers (401)', async () => {
        expect((await create(undefined)).statusCode).toBe(401);
    });

    it('rejects a member whose role cannot create invitations (403)', async () => {
        seed(`users/${OWNER}/members/staff`, {
            uid: 'staff', role: 'technician', permissions: permissionsForRole('technician'),
            property_ids: ['*'], status: 'active',
        });
        expect((await create('staff')).statusCode).toBe(403);
    });

    it('cross-property: a member limited to another property gets 403', async () => {
        seed(`users/${OWNER}/members/staff`, {
            uid: 'staff', role: 'front_desk', permissions: permissionsForRole('front_desk'),
            property_ids: ['bld-OTHER'], status: 'active',
        });
        expect((await create('staff')).statusCode).toBe(403);
    });

    it('cross-organization: another org\'s owner cannot invite into this org (403)', async () => {
        expect((await create('other-owner')).statusCode).toBe(403);
    });

    it('rejects a room that does not exist in the property (404) — forged room ids', async () => {
        const res = await create(OWNER, { room_id: 'room-from-elsewhere' });
        expect(res.statusCode).toBe(404);
    });

    it('requires a tenant assignment (400)', async () => {
        seed(`users/${OWNER}/buildings/${BLD}/tenants/${ROOM}`, {}); // profile without a name
        const res = await create(OWNER);
        expect(res.statusCode).toBe(400);
        expect((res.body as { error: string }).error).toBe('tenant_required');
        // an explicit name satisfies it
        expect((await create(OWNER, { tenant_name: 'Malee' })).statusCode).toBe(200);
    });

    it('refuses when the room already has a LINE user unless replacing (409)', async () => {
        seed(`users/${OWNER}/buildings/${BLD}/rooms/${ROOM}`, { room_number: '101', is_active: true, line_user_id: LINE_A });
        expect((await create(OWNER)).statusCode).toBe(409);
        expect((await create(OWNER, { replace_existing: true })).statusCode).toBe(200);
    });

    it('rejects missing building_id and unknown actions (400)', async () => {
        const noBuilding = fakeRes();
        await handler(fakeReq({ action: 'create', owner_uid: OWNER }, OWNER), noBuilding as never);
        expect(noBuilding.statusCode).toBe(400);
        const unknown = fakeRes();
        await handler(fakeReq({ action: 'nope', owner_uid: OWNER, building_id: BLD }, OWNER), unknown as never);
        expect(unknown.statusCode).toBe(400);
    });

    it('clamps absurd expiry values', async () => {
        const res = await create(OWNER, { expires_in_hours: 999999 });
        const { expires_at } = res.body as { expires_at: number };
        expect(expires_at - Date.now()).toBeLessThanOrEqual(30 * 24 * 3600 * 1000 + 5000);
    });
});

describe('redeeming invitations', () => {
    async function issue(body: Record<string, unknown> = {}) {
        const res = await create(OWNER, body);
        return (res.body as { code: string }).code;
    }

    it('happy path: binds the LINE user to the room named by the invitation', async () => {
        const code = await issue();
        const r = await redeemInvitation(LINE_A, code);
        expect(r).toMatchObject({ ok: true, roomId: ROOM, roomNumber: '101', buildingId: BLD });
        expect(read(`users/${OWNER}/buildings/${BLD}/rooms/${ROOM}`)?.line_user_id).toBe(LINE_A);
        expect(read(`line_rooms/${LINE_A}`)).toMatchObject({ uid: OWNER, building_id: BLD, room_id: ROOM, due_day: 7 });
    });

    it('accepts the code case-insensitively and with whitespace', async () => {
        const code = await issue();
        expect((await redeemInvitation(LINE_A, `  ${code.toLowerCase()} `)).ok).toBe(true);
    });

    it('one-time code cannot be used by a second person', async () => {
        const code = await issue();
        expect((await redeemInvitation(LINE_A, code)).ok).toBe(true);
        expect(await redeemInvitation(LINE_B, code)).toEqual({ ok: false, reason: 'used' });
        expect(read(`users/${OWNER}/buildings/${BLD}/rooms/${ROOM}`)?.line_user_id).toBe(LINE_A);
    });

    it('same person re-scanning their own code is harmless', async () => {
        const code = await issue();
        await redeemInvitation(LINE_A, code);
        expect((await redeemInvitation(LINE_A, code)).ok).toBe(true);
    });

    it('rejects expired codes', async () => {
        const code = await issue();
        const [path] = listPaths('invitations/');
        seed(path, { ...read(path)!, expires_at: Date.now() - 1000 });
        expect(await redeemInvitation(LINE_A, code)).toEqual({ ok: false, reason: 'expired' });
        expect(read(`users/${OWNER}/buildings/${BLD}/rooms/${ROOM}`)?.line_user_id).toBeUndefined();
    });

    it('rejects revoked codes', async () => {
        const code = await issue();
        const [path] = listPaths('invitations/');
        const id = path.split('/')[1];
        const res = fakeRes();
        await handler(fakeReq({ action: 'revoke', owner_uid: OWNER, building_id: BLD, invitation_id: id }, OWNER), res as never);
        expect(res.statusCode).toBe(200);
        expect(await redeemInvitation(LINE_A, code)).toEqual({ ok: false, reason: 'revoked' });
    });

    it('rejects unknown and malformed codes without touching data', async () => {
        expect(await redeemInvitation(LINE_A, 'HCI-AAAAAAAAAA')).toEqual({ ok: false, reason: 'not_found' });
        expect(await redeemInvitation(LINE_A, 'room 101')).toEqual({ ok: false, reason: 'not_found' });
        expect(listPaths('line_rooms/')).toHaveLength(0);
    });

    it('blocks taking a room that another LINE user holds', async () => {
        const code = await issue();
        seed(`users/${OWNER}/buildings/${BLD}/rooms/${ROOM}`, { room_number: '101', is_active: true, line_user_id: LINE_B });
        expect(await redeemInvitation(LINE_A, code)).toEqual({ ok: false, reason: 'room_taken' });
    });

    it('replace_existing takes over and removes the previous registration', async () => {
        seed(`users/${OWNER}/buildings/${BLD}/rooms/${ROOM}`, { room_number: '101', is_active: true, line_user_id: LINE_B });
        seed(`line_rooms/${LINE_B}`, { uid: OWNER, building_id: BLD, room_id: ROOM });
        const code = await issue({ replace_existing: true });
        expect((await redeemInvitation(LINE_A, code)).ok).toBe(true);
        expect(read(`line_rooms/${LINE_B}`)).toBeUndefined();
        expect(read(`users/${OWNER}/buildings/${BLD}/rooms/${ROOM}`)?.line_user_id).toBe(LINE_A);
    });

    it('fails if the room was deactivated after the invitation was issued', async () => {
        const code = await issue();
        seed(`users/${OWNER}/buildings/${BLD}/rooms/${ROOM}`, { room_number: '101', is_active: false });
        expect(await redeemInvitation(LINE_A, code)).toEqual({ ok: false, reason: 'room_unavailable' });
    });

    it('moving a LINE user to a new room releases their old room', async () => {
        const first = await issue();
        await redeemInvitation(LINE_A, first);
        const res = await create(OWNER, { room_id: 'room-102', tenant_name: 'Somchai' });
        await redeemInvitation(LINE_A, (res.body as { code: string }).code);
        expect(read(`users/${OWNER}/buildings/${BLD}/rooms/${ROOM}`)?.line_user_id).toBeUndefined();
        expect(read(`users/${OWNER}/buildings/${BLD}/rooms/room-102`)?.line_user_id).toBe(LINE_A);
    });

    it('records an audit event for the redemption', async () => {
        const code = await issue();
        await redeemInvitation(LINE_A, code);
        // 1 for create + 1 for redeem
        expect(listPaths(`users/${OWNER}/audit_logs/`)).toHaveLength(2);
    });
});
