import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import handler from './_members.js';
import { addAuthUser, fakeReq, fakeRes, listPaths, read, resetFake, seed } from './_fake-firestore.js';
import { permissionsForRole } from '../src/shared/permissions.js';

const OWNER = 'owner-1';

async function call(uid: string | undefined, body: Record<string, unknown>) {
    const res = fakeRes();
    await handler(fakeReq({ owner_uid: OWNER, ...body }, uid), res as never);
    return res;
}

beforeEach(() => {
    resetFake();
    addAuthUser(OWNER, 'owner@x.com', 'Owner');
    addAuthUser('mgr', 'mgr@x.com', 'Manager');
    addAuthUser('desk', 'desk@x.com', 'Desk');
    addAuthUser('intruder', 'intruder@x.com');
    seed(`users/${OWNER}`, { uid: OWNER });
    seed(`users/${OWNER}/buildings/bld-A`, { id: 'bld-A' });
    seed(`users/other-owner/buildings/bld-X`, { id: 'bld-X' });
    seed(`users/${OWNER}/members/mgr`, {
        uid: 'mgr', email: 'mgr@x.com', role: 'property_manager',
        permissions: permissionsForRole('property_manager'), property_ids: ['*'], status: 'active',
    });
});

describe('/api/members', () => {
    it('adds a member by the phone number on their profile, in any common format, and refuses unknown or shared numbers', async () => {
        seed('users/desk', { uid: 'desk', phone: '0812345678' });
        seed('users/mgr', { uid: 'mgr', phone: '081-999-0000' });
        const ok = await call(OWNER, { action: 'add', phone: '081 234 5678', role: 'front_desk', property_ids: ['*'] });
        expect(ok.statusCode).toBe(200);
        expect(ok.body.member.uid).toBe('desk');
        expect((await call(OWNER, { action: 'add', phone: '0819990000', role: 'front_desk', property_ids: ['*'] })).body.member.uid).toBe('mgr'); // stored with dashes
        expect((await call(OWNER, { action: 'add', phone: '0800000000', role: 'front_desk', property_ids: ['*'] })).statusCode).toBe(404);
        expect((await call(OWNER, { action: 'add', phone: '12345', role: 'front_desk', property_ids: ['*'] })).statusCode).toBe(400);
        seed('users/dup', { uid: 'dup', phone: '+66855550000' });
        seed('users/dup2', { uid: 'dup2', phone: '0855550000' });
        addAuthUser('dup', 'dup@x.com'); addAuthUser('dup2', 'dup2@x.com');
        expect((await call(OWNER, { action: 'add', phone: '0855550000', role: 'front_desk', property_ids: ['*'] })).statusCode).toBe(409);
        expect((await call('mgr', { action: 'add', phone: '0812345678', role: 'front_desk', property_ids: ['*'] })).statusCode).toBe(403);
    });

    it('owner adds a member; permissions are derived from the role and the change is audited', async () => {
        const res = await call(OWNER, { action: 'add', email: 'desk@x.com', role: 'front_desk', property_ids: ['bld-A'] });
        expect(res.statusCode).toBe(200);
        const doc = read(`users/${OWNER}/members/desk`)!;
        expect(doc.role).toBe('front_desk');
        expect(doc.permissions).toEqual(permissionsForRole('front_desk'));
        expect(doc.property_ids).toEqual(['bld-A']);
        expect(listPaths(`users/${OWNER}/audit_logs/`)).toHaveLength(1);
    });

    it('a property manager can list but cannot manage members (no privilege escalation)', async () => {
        expect((await call('mgr', { action: 'list' })).statusCode).toBe(200);
        const add = await call('mgr', { action: 'add', email: 'desk@x.com', role: 'front_desk', property_ids: ['*'] });
        expect(add.statusCode).toBe(403);
        expect(read(`users/${OWNER}/members/desk`)).toBeUndefined();
    });

    it('rejects unauthenticated and outsider callers', async () => {
        expect((await call(undefined, { action: 'list' })).statusCode).toBe(401);
        expect((await call('intruder', { action: 'list' })).statusCode).toBe(403);
        expect((await call('intruder', { action: 'add', email: 'desk@x.com', role: 'front_desk', property_ids: ['*'] })).statusCode).toBe(403);
    });

    it('cannot assign the owner or tenant role, or an unknown role (400)', async () => {
        for (const role of ['owner', 'tenant', 'god']) {
            const res = await call(OWNER, { action: 'add', email: 'desk@x.com', role, property_ids: ['*'] });
            expect(res.statusCode).toBe(400);
        }
    });

    it('rejects empty/invalid property lists and properties from another organization', async () => {
        expect((await call(OWNER, { action: 'add', email: 'desk@x.com', role: 'front_desk', property_ids: [] })).statusCode).toBe(400);
        expect((await call(OWNER, { action: 'add', email: 'desk@x.com', role: 'front_desk', property_ids: [42] })).statusCode).toBe(400);
        const foreign = await call(OWNER, { action: 'add', email: 'desk@x.com', role: 'front_desk', property_ids: ['bld-X'] });
        expect(foreign.statusCode).toBe(400);
        expect((foreign.body as { error: string }).error).toBe('unknown_property');
    });

    it('404 for an email without a HorCare account; cannot add the owner as a member', async () => {
        expect((await call(OWNER, { action: 'add', email: 'ghost@x.com', role: 'front_desk', property_ids: ['*'] })).statusCode).toBe(404);
        expect((await call(OWNER, { action: 'add', email: 'owner@x.com', role: 'front_desk', property_ids: ['*'] })).statusCode).toBe(400);
    });

    it('updating a role re-derives permissions; disabling and removing work and are audited', async () => {
        await call(OWNER, { action: 'add', email: 'desk@x.com', role: 'front_desk', property_ids: ['*'] });
        await call(OWNER, { action: 'update', member_uid: 'desk', role: 'finance' });
        expect(read(`users/${OWNER}/members/desk`)?.permissions).toEqual(permissionsForRole('finance'));
        await call(OWNER, { action: 'update', member_uid: 'desk', status: 'disabled' });
        expect(read(`users/${OWNER}/members/desk`)?.status).toBe('disabled');
        await call(OWNER, { action: 'remove', member_uid: 'desk' });
        expect(read(`users/${OWNER}/members/desk`)).toBeUndefined();
        expect(listPaths(`users/${OWNER}/audit_logs/`)).toHaveLength(4);
    });

    it('update rejects invalid input and unknown members', async () => {
        await call(OWNER, { action: 'add', email: 'desk@x.com', role: 'front_desk', property_ids: ['*'] });
        expect((await call(OWNER, { action: 'update', member_uid: 'desk', role: 'owner' })).statusCode).toBe(400);
        expect((await call(OWNER, { action: 'update', member_uid: 'desk', status: 'maybe' })).statusCode).toBe(400);
        expect((await call(OWNER, { action: 'update', member_uid: 'desk' })).statusCode).toBe(400);
        expect((await call(OWNER, { action: 'update', member_uid: 'nobody', role: 'finance' })).statusCode).toBe(404);
    });

    it('only accepts POST', async () => {
        const res = fakeRes();
        await handler(fakeReq({}, OWNER, 'GET'), res as never);
        expect(res.statusCode).toBe(405);
    });
});
