import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import { authorize } from './_rbac.js';
import { addAuthUser, fakeReq, fakeRes, resetFake, seed } from './_fake-firestore.js';
import { permissionsForRole, type MemberDoc } from '../src/shared/permissions.js';

const OWNER = 'owner-1';
const OTHER_ORG_OWNER = 'owner-2';

function member(uid: string, over: Partial<MemberDoc> = {}): MemberDoc {
    return {
        uid, email: `${uid}@x.com`, display_name: uid, role: 'front_desk',
        permissions: permissionsForRole('front_desk'), property_ids: ['bld-A'],
        status: 'active', created_at: '2026-01-01', created_by: OWNER, ...over,
    };
}

beforeEach(() => {
    resetFake();
    addAuthUser(OWNER, 'owner@x.com', 'Owner');
    addAuthUser(OTHER_ORG_OWNER, 'o2@x.com');
    addAuthUser('staff', 'staff@x.com');
    seed(`users/${OWNER}`, { uid: OWNER });
});

async function run(uid: string | undefined, permission: Parameters<typeof authorize>[2]['permission'], buildingId = 'bld-A') {
    const res = fakeRes();
    const ctx = await authorize(fakeReq({}, uid), res as never, { ownerUid: OWNER, buildingId, permission });
    return { ctx, res };
}

describe('authorize()', () => {
    it('rejects requests without a token (401)', async () => {
        const { ctx, res } = await run(undefined, 'room.read');
        expect(ctx).toBeNull();
        expect(res.statusCode).toBe(401);
    });

    it('rejects an invalid token (401)', async () => {
        const res = fakeRes();
        const req = fakeReq({}, undefined) as unknown as { headers: Record<string, string> };
        req.headers.authorization = 'Bearer garbage';
        const ctx = await authorize(req as never, res as never, { ownerUid: OWNER, permission: 'room.read' });
        expect(ctx).toBeNull();
        expect(res.statusCode).toBe(401);
    });

    it('requires owner_uid (400)', async () => {
        const res = fakeRes();
        const ctx = await authorize(fakeReq({}, OWNER), res as never, { ownerUid: undefined, permission: 'room.read' });
        expect(ctx).toBeNull();
        expect(res.statusCode).toBe(400);
    });

    it('lets the owner do anything on their own org', async () => {
        const { ctx } = await run(OWNER, 'member.manage');
        expect(ctx?.role).toBe('owner');
        expect(ctx?.isOwner).toBe(true);
    });

    it('allows an active member with the permission on a granted property', async () => {
        seed(`users/${OWNER}/members/staff`, member('staff'));
        const { ctx } = await run('staff', 'invitation.create', 'bld-A');
        expect(ctx?.role).toBe('front_desk');
    });

    it('denies a member the permission their role lacks (403)', async () => {
        seed(`users/${OWNER}/members/staff`, member('staff'));
        const { ctx, res } = await run('staff', 'payment.reconcile');
        expect(ctx).toBeNull();
        expect(res.statusCode).toBe(403);
    });

    it('cross-property: member cannot reach a property they were not granted (403)', async () => {
        seed(`users/${OWNER}/members/staff`, member('staff', { property_ids: ['bld-A'] }));
        const { ctx, res } = await run('staff', 'invitation.create', 'bld-B');
        expect(ctx).toBeNull();
        expect(res.statusCode).toBe(403);
    });

    it('wildcard property grant covers every property', async () => {
        seed(`users/${OWNER}/members/staff`, member('staff', { property_ids: ['*'] }));
        const { ctx } = await run('staff', 'invitation.create', 'bld-Z');
        expect(ctx).not.toBeNull();
    });

    it('cross-organization: a stranger and another org\'s owner get 403', async () => {
        const stranger = await run('staff', 'room.read');
        expect(stranger.res.statusCode).toBe(403);
        const otherOwner = await run(OTHER_ORG_OWNER, 'room.read');
        expect(otherOwner.ctx).toBeNull();
        expect(otherOwner.res.statusCode).toBe(403);
    });

    it('ignores a tampered denormalised permissions array (role is the source of truth)', async () => {
        seed(`users/${OWNER}/members/staff`, member('staff', { permissions: ['member.manage', 'payment.reconcile'] }));
        const { ctx, res } = await run('staff', 'payment.reconcile');
        expect(ctx).toBeNull();
        expect(res.statusCode).toBe(403);
    });

    it('denies disabled members (403)', async () => {
        seed(`users/${OWNER}/members/staff`, member('staff', { status: 'disabled' }));
        const { ctx } = await run('staff', 'room.read');
        expect(ctx).toBeNull();
    });

    it('denies banned accounts even for their own org (403)', async () => {
        seed(`users/${OWNER}`, { uid: OWNER, status: 'banned' });
        const { ctx, res } = await run(OWNER, 'room.read');
        expect(ctx).toBeNull();
        expect(res.statusCode).toBe(403);
    });
});
