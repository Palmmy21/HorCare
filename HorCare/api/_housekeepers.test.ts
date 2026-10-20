import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);
const limits = vi.hoisted(() => ({ ok: true }));
vi.mock('./_abuse-guard.js', async () => ({
    ...(await vi.importActual<typeof import('./_abuse-guard.js')>('./_abuse-guard.js')),
    rateLimit: async () => ({ ok: limits.ok, retryAfterSec: limits.ok ? 0 : 60 }),
    rateLimitBy: async () => ({ ok: limits.ok, retryAfterSec: limits.ok ? 0 : 60 }),
}));

import handler, { checkPasscode, hashPasscode, housekeeperUid } from './_housekeepers.js';
import { addAuthUser, fakeReq, fakeRes, read, resetFake, revoked, seed } from './_fake-firestore.js';
import { permissionsForRole } from '../src/shared/permissions.js';

const OWNER = 'owner-1';
const BLD = 'bld-A';
const B = `users/${OWNER}/buildings/${BLD}`;

async function call(body: Record<string, unknown>, uid?: string) {
    const res = fakeRes();
    await handler(fakeReq({ owner_uid: OWNER, building_id: BLD, ...body }, uid), res as never);
    return res as { statusCode: number; body: any };
}
const add = (over: Record<string, unknown> = {}, uid = OWNER) => call({ action: 'upsert', name: 'แม่บ้าน ก', phone: '081-234-5678', passcode: '246810', ...over }, uid);
const login = (passcode = '246810', phone = '0812345678') => call({ action: 'login', phone, passcode });

beforeEach(() => {
    resetFake();
    limits.ok = true;
    addAuthUser(OWNER, 'o@x.com', 'Owner');
    addAuthUser('other', 'x@x.com', 'Other owner');
    addAuthUser('tech', 't@x.com', 'Tech');
    seed(`users/${OWNER}`, { uid: OWNER });
    seed(B, { id: BLD });
    seed('users/other', { uid: 'other' });
    seed('users/other/buildings/bo', { id: 'bo' });
    seed(`users/${OWNER}/members/tech`, { uid: 'tech', role: 'technician', permissions: permissionsForRole('technician'), property_ids: ['*'], status: 'active' });
});

describe('passcode hashing', () => {
    it('verifies the right code only, and never stores it readable', async () => {
        const h = await hashPasscode('246810');
        expect(h).not.toContain('246810');
        expect(await checkPasscode('246810', h)).toBe(true);
        expect(await checkPasscode('246811', h)).toBe(false);
        expect(await checkPasscode('246810', '246810')).toBe(false);
    });
});

describe('managing housekeepers', () => {
    it('needs property.update on the building', async () => {
        expect((await add({}, 'tech')).statusCode).toBe(403);
        expect((await call({ action: 'upsert', name: 'x', phone: '0812345678', passcode: '246810' })).statusCode).toBe(401);
    });

    it('stores no passcode on the readable record; the sign-in record holds only a hash', async () => {
        const res = await add();
        expect(res.statusCode).toBe(200);
        const maid = read(`${B}/housekeepers/${res.body.id}`)!;
        expect(maid).toMatchObject({ name: 'แม่บ้าน ก', phone: '0812345678', is_active: true, session_version: 0 });
        expect(JSON.stringify(maid)).not.toContain('246810');
        const auth = read('housekeepers_auth/0812345678')!;
        expect(auth.passcode).toBeUndefined();
        expect(String(auth.passcode_hash)).toMatch(/^scrypt\$/);
    });

    it('requires 6–8 digit codes and a passcode for new accounts', async () => {
        expect((await add({ passcode: '1234' })).body.error).toBe('weak_passcode');
        expect((await add({ passcode: '' })).body.error).toBe('passcode_required');
    });

    it('a phone that belongs to another organisation cannot be taken over', async () => {
        seed('housekeepers_auth/0812345678', { owner_uid: 'other', building_id: 'bo', maid_id: 'm1', phone: '0812345678', passcode_hash: 'x' });
        expect((await add()).body.error).toBe('phone_in_use');
        expect(read('housekeepers_auth/0812345678')?.owner_uid).toBe('other');
    });

    it('changing the passcode or switching the account off ends open sessions', async () => {
        const id = (await add()).body.id;
        await add({ maid_id: id, passcode: '13579135' });
        expect(read(`${B}/housekeepers/${id}`)?.session_version).toBe(1);
        expect(revoked).toContain(housekeeperUid(OWNER, BLD, id));
        await add({ maid_id: id, passcode: '', is_active: false });
        expect(read(`${B}/housekeepers/${id}`)).toMatchObject({ session_version: 2, is_active: false });
        // a plain rename keeps sessions
        await add({ maid_id: id, passcode: '', is_active: false, name: 'แม่บ้าน ข' });
        expect(read(`${B}/housekeepers/${id}`)?.session_version).toBe(2);
    });

    it('migrate strips plain-text passcodes left by older versions', async () => {
        seed(`${B}/housekeepers/maid_0812345678`, { id: 'maid_0812345678', name: 'เก่า', phone: '0812345678', passcode: '1234', is_active: true });
        seed('housekeepers_auth/0812345678', { owner_uid: OWNER, building_id: BLD, maid_id: 'maid_0812345678', phone: '0812345678', passcode: '1234' });
        const res = await call({ action: 'migrate' }, OWNER);
        expect(res.body.stripped).toBe(1);
        expect(read(`${B}/housekeepers/maid_0812345678`)).toMatchObject({ needs_passcode: true, session_version: 1 });
        expect(read(`${B}/housekeepers/maid_0812345678`)?.passcode).toBeUndefined();
        expect(read('housekeepers_auth/0812345678')?.passcode).toBeUndefined();
        expect((await login('1234')).body.error).toBe('passcode_reset_required');
    });

    it('delete removes the record and its sign-in, and signs the housekeeper out', async () => {
        const id = (await add()).body.id;
        expect((await call({ action: 'delete', maid_id: id }, OWNER)).statusCode).toBe(200);
        expect(read(`${B}/housekeepers/${id}`)).toBeUndefined();
        expect(read('housekeepers_auth/0812345678')).toBeUndefined();
        expect(revoked).toContain(housekeeperUid(OWNER, BLD, id));
    });
});

describe('login', () => {
    it('returns a custom token bound to the building, the record and its session version', async () => {
        const id = (await add()).body.id;
        const res = await login();
        expect(res.statusCode).toBe(200);
        const token = JSON.parse(res.body.token);
        expect(token).toEqual({ uid: housekeeperUid(OWNER, BLD, id), claims: { hk_owner: OWNER, hk_building: BLD, hk_maid: id, hk_ver: 0 } });
        expect(res.body.session).toMatchObject({ owner_uid: OWNER, building_id: BLD, maid_id: id, phone: '0812345678' });
    });

    it('gives the same answer for an unknown phone and a wrong code', async () => {
        await add();
        expect((await login('000000')).body.error).toBe('invalid_credentials');
        expect((await login('246810', '0899999999')).body.error).toBe('invalid_credentials');
    });

    it('refuses switched-off accounts and rate-limited guessing', async () => {
        const id = (await add()).body.id;
        await add({ maid_id: id, passcode: '', is_active: false });
        expect((await login()).body.error).toBe('account_disabled');
        limits.ok = false;
        expect((await login()).statusCode).toBe(429);
    });
});
