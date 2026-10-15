import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import members from './_members.js';
import staffRegistration from './_staff-registration.js';
import { addAuthUser, fakeReq, fakeRes, listPaths, read, resetFake, revoked, seed } from './_fake-firestore.js';
import { passwordProblem, validEmail } from './_member-accounts.js';

const OWNER = 'owner-1';
const A = 'bld-A';
const B = 'bld-B';

beforeEach(() => {
    resetFake();
    addAuthUser(OWNER, 'owner@x.com', 'Owner');
    addAuthUser('plain', 'plain@x.com', 'Plain User');
    seed(`users/${OWNER}`, { uid: OWNER, display_name: 'เจ้าของหอ', license: 'active', access_until: 0 });
    for (const b of [A, B]) seed(`users/${OWNER}/buildings/${b}`, { id: b });
});

async function call(uid: string | null, body: Record<string, unknown>, fn: typeof members = members) {
    const res = fakeRes();
    await fn(fakeReq({ owner_uid: OWNER, ...body }, uid ?? undefined), res as never);
    return res as { statusCode: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
}
const create = (over: Record<string, unknown> = {}, uid: string | null = OWNER) =>
    call(uid, { action: 'create_account', email: 'Admin.A@Example.com', password: 'Secret123', display_name: 'ผู้ดูแล ตึก A', role: 'property_manager', property_ids: [A], ...over });
/** The account the owner just made, signed in. */
const asNew = (email = 'admin.a@example.com') => {
    const found = [...listPaths(`users/${OWNER}/members/`)].map(p => read(p)!).find(m => m.email === email);
    return found!.uid as string;
};

describe('input rules', () => {
    it('emails and passwords', () => {
        expect(validEmail('a@b.co')).toBe(true);
        for (const bad of ['', 'a', 'a@b', 'a b@c.com', 'x'.repeat(250) + '@b.com', undefined, 5]) expect(validEmail(bad)).toBe(false);
        expect(passwordProblem('Secret123')).toBeNull();
        expect(passwordProblem('short1')).toBe('too_short');
        expect(passwordProblem('onlyletters')).toBe('too_simple');
        expect(passwordProblem('12345678')).toBe('too_simple');
        expect(passwordProblem('a1'.repeat(40))).toBe('too_long');
        expect(passwordProblem(undefined)).toBe('invalid');
    });
});

describe('creating an administrator account', () => {
    it('makes a verified sign-in with the chosen password, limited to the chosen building, and audits it', async () => {
        const r = await create();
        expect(r.statusCode).toBe(200);
        expect(r.body.member).toMatchObject({ email: 'admin.a@example.com', role: 'property_manager', property_ids: [A], status: 'active', managed: true });
        expect(r.body.member.permissions).toContain('room.update');
        expect(r.body.member.permissions).not.toContain('member.manage'); // can never hand out access
        expect(JSON.stringify(r.body)).not.toContain('Secret123');
        const uid = asNew();
        expect(read(`users/${uid}`)).toMatchObject({ email: 'admin.a@example.com', staff_account_of: OWNER, license: 'free' });
        expect(read(`member_index/${uid}`)).toEqual({ orgs: [OWNER] });
        expect(listPaths(`users/${OWNER}/audit_logs/`).length).toBe(1);
        expect(JSON.stringify(read(listPaths(`users/${OWNER}/audit_logs/`)[0]))).not.toContain('Secret123');
    });

    it('refuses weak passwords, bad emails, an existing account, the owner role, unknown buildings and empty scope', async () => {
        for (const [over, code] of [
            [{ password: 'short1' }, 'password_too_short'], [{ password: 'noDigitsHere' }, 'password_too_simple'], [{ email: 'nope' }, 'invalid_email'],
            [{ display_name: 'x' }, 'invalid_name'], [{ role: 'owner' }, 'invalid_role'], [{ role: 'tenant' }, 'invalid_role'], [{ role: 'god' }, 'invalid_role'],
            [{ property_ids: ['ghost'] }, 'unknown_property'], [{ property_ids: [] }, 'invalid_property_ids'], [{ property_ids: undefined }, 'invalid_property_ids'],
            [{ email: 'plain@x.com' }, 'user_exists'],
        ] as const) {
            const r = await create(over as Record<string, unknown>);
            expect([r.statusCode, r.body.error]).toEqual([over.email === 'plain@x.com' ? 409 : 400, code]);
        }
        expect(listPaths(`users/${OWNER}/members/`)).toHaveLength(0);
    });

    it('only the owner can create accounts, not a manager or front desk', async () => {
        const first = await create();
        const mgr = first.body.member.uid as string;
        const r = await create({ email: 'second@example.com' }, mgr);
        expect(r.statusCode).toBe(403);
        expect(listPaths(`users/${OWNER}/members/`)).toHaveLength(1);
        expect((await create({}, null)).statusCode).toBe(401);
    });
});

describe('signing in as an administrator', () => {
    it('my_memberships tells the app which organisation and buildings, with permissions taken from the role, and the owner\'s plan', async () => {
        const uid = (await create()).body.member.uid as string;
        const r = await call(uid, { action: 'my_memberships' });
        expect(r.statusCode).toBe(200);
        expect(r.body.memberships).toHaveLength(1);
        expect(r.body.memberships[0]).toMatchObject({ owner_uid: OWNER, owner_name: 'เจ้าของหอ', role: 'property_manager', property_ids: [A], managed: true, license: 'active' });
        // a tampered stored copy of the permissions changes nothing: they are recomputed from the role
        seed(`users/${OWNER}/members/${uid}`, { ...read(`users/${OWNER}/members/${uid}`)!, permissions: ['member.manage', 'property.update'], role: 'technician' });
        const again = await call(uid, { action: 'my_memberships' });
        expect(again.body.memberships[0].permissions).not.toContain('member.manage');
        expect(again.body.memberships[0].permissions).toContain('work_order.update');
    });

    it('someone with no membership gets an empty list; a disabled one is not listed; no token is refused', async () => {
        expect((await call('plain', { action: 'my_memberships' })).body.memberships).toEqual([]);
        const uid = (await create()).body.member.uid as string;
        await call(OWNER, { action: 'update', member_uid: uid, status: 'disabled' });
        expect((await call(uid, { action: 'my_memberships' })).body.memberships).toEqual([]);
        expect(revoked).toContain(uid); // and they are signed out everywhere
        expect((await call(null, { action: 'my_memberships' })).statusCode).toBe(401);
    });
});

describe('an administrator of building A', () => {
    it('can work in A but is refused everything in B, and cannot widen their own access', async () => {
        const uid = (await create()).body.member.uid as string;
        expect((await call(uid, { action: 'list' }, staffRegistration)).statusCode).toBe(400); // missing building_id, never a 200
        const inA = await call(uid, { action: 'list', building_id: A }, staffRegistration);
        expect(inA.statusCode).toBe(200);
        const inB = await call(uid, { action: 'list', building_id: B }, staffRegistration);
        expect(inB.statusCode).toBe(403);
        expect((await call(uid, { action: 'code_rotate', building_id: B }, staffRegistration)).statusCode).toBe(403);
        // cannot give themselves building B, nor create more accounts, nor reset anyone's password
        expect((await call(uid, { action: 'update', member_uid: uid, property_ids: [A, B] })).statusCode).toBe(403);
        expect((await call(uid, { action: 'update', member_uid: uid, property_ids: ['*'] })).statusCode).toBe(403);
        expect((await call(uid, { action: 'reset_password', member_uid: uid, password: 'Another123' })).statusCode).toBe(403);
        expect((await call(uid, { action: 'add', email: 'plain@x.com', role: 'owner', property_ids: ['*'] })).statusCode).toBe(403);
    });

    it('widening the scope is the owner\'s decision and takes effect at once', async () => {
        const uid = (await create()).body.member.uid as string;
        expect((await call(uid, { action: 'list', building_id: B }, staffRegistration)).statusCode).toBe(403);
        expect((await call(OWNER, { action: 'update', member_uid: uid, property_ids: [A, B] })).statusCode).toBe(200);
        expect((await call(uid, { action: 'list', building_id: B }, staffRegistration)).statusCode).toBe(200);
    });

    it('only sees colleagues who share a building with them; the owner sees everyone', async () => {
        const a = (await create()).body.member.uid as string;
        const b = (await create({ email: 'admin.b@example.com', display_name: 'ผู้ดูแล ตึก B', property_ids: [B] })).body.member.uid as string;
        const wide = (await create({ email: 'wide@example.com', display_name: 'ผู้จัดการทุกตึก', role: 'finance', property_ids: ['*'] })).body.member.uid as string;
        const both = (await create({ email: 'ab@example.com', display_name: 'ดูแลสองตึก', property_ids: [A, B] })).body.member.uid as string;
        const seenByA = (await call(a, { action: 'list' })).body.members.map((m: { uid: string }) => m.uid).sort();
        expect(seenByA).toEqual([a, both].sort());
        expect(seenByA).not.toContain(b);
        expect(seenByA).not.toContain(wide);
        expect((await call(OWNER, { action: 'list' })).body.members).toHaveLength(4);
    });
});

describe('password reset and removal', () => {
    it('the owner can reset the password of an account made here, which signs the person out; never of anyone else\'s account', async () => {
        const uid = (await create()).body.member.uid as string;
        expect((await call(OWNER, { action: 'reset_password', member_uid: uid, password: 'NewSecret456' })).statusCode).toBe(200);
        expect(revoked).toContain(uid);
        expect((await call(OWNER, { action: 'reset_password', member_uid: uid, password: 'weak' })).body.error).toBe('password_too_short');
        // an ordinary HorCare user added as staff keeps control of their own password
        await call(OWNER, { action: 'add', email: 'plain@x.com', role: 'front_desk', property_ids: ['*'] });
        const r = await call(OWNER, { action: 'reset_password', member_uid: 'plain', password: 'Hijack12345' });
        expect(r.statusCode).toBe(409);
        expect(r.body.error).toBe('not_a_managed_account');
        expect((await call(OWNER, { action: 'reset_password', member_uid: 'ghost', password: 'Whatever123' })).statusCode).toBe(404);
    });

    it('removing an administrator locks the sign-in and drops the membership', async () => {
        const uid = (await create()).body.member.uid as string;
        expect((await call(OWNER, { action: 'remove', member_uid: uid })).statusCode).toBe(200);
        expect(read(`users/${OWNER}/members/${uid}`)).toBeUndefined();
        expect(read(`member_index/${uid}`)).toEqual({ orgs: [] });
        expect(revoked).toContain(uid);
        expect((await call(uid, { action: 'list', building_id: A }, staffRegistration)).statusCode).toBe(403);
    });
});
