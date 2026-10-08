import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import handler from './_bank-accounts.js';
import { addAuthUser, fakeReq, fakeRes, listPaths, read, resetFake, seed } from './_fake-firestore.js';
import { permissionsForRole } from '../src/shared/permissions.js';

const OWNER = 'owner-1';
const BLD = 'bld-A';
const COL = `users/${OWNER}/buildings/${BLD}/bank_accounts`;

beforeEach(() => {
    resetFake();
    addAuthUser(OWNER, 'o@x.com', 'Owner');
    addAuthUser('mgr', 'm@x.com', 'Manager');
    addAuthUser('fin', 'f@x.com', 'Finance');
    addAuthUser('desk', 'd@x.com', 'Desk');
    addAuthUser('stranger', 's@x.com');
    seed(`users/${OWNER}`, { uid: OWNER });
    seed(`users/${OWNER}/buildings/${BLD}`, { id: BLD });
    seed(`users/${OWNER}/buildings/bld-B`, { id: 'bld-B' });
});

function member(uid: string, role: 'property_manager' | 'finance' | 'front_desk', property_ids = ['*']) {
    seed(`users/${OWNER}/members/${uid}`, { uid, role, permissions: permissionsForRole(role), property_ids, status: 'active' });
}
async function call(uid: string | undefined, body: Record<string, unknown>) {
    const res = fakeRes();
    await handler(fakeReq({ owner_uid: OWNER, building_id: BLD, ...body }, uid), res as never);
    return res as { statusCode: number; body: any };
}
/** uid null = no Authorization header at all (a default of undefined would silently become the owner). */
const create = (uid: string | null = OWNER, over: Record<string, unknown> = {}) =>
    call(uid ?? undefined, { action: 'create', bank_code: '004', account_name: 'สมชาย ใจดี', account_number: '123-4-56789-0', ...over });

describe('create', () => {
    it('stores digits only, derives the bank, makes the first account the default, and audits without the full number', async () => {
        const res = await create();
        expect(res.statusCode).toBe(200);
        expect(res.body.account).toMatchObject({
            bank_code: '004', bank_short: 'KBANK', account_name: 'สมชาย ใจดี', account_number: '1234567890', status: 'active', is_default: true, nickname: null,
        });
        const logs = listPaths(`users/${OWNER}/audit_logs/`).map(p => read(p)!);
        expect(logs).toHaveLength(1);
        expect(JSON.stringify(logs[0])).not.toContain('1234567890');
        expect(logs[0]).toMatchObject({ resource_type: 'bank_account', resource_label: 'KBANK ••••7890' });
    });

    it('only the first active account is default', async () => {
        await create();
        const second = await create(OWNER, { bank_code: '014', account_number: '9876543210' });
        expect(second.body.account.is_default).toBe(false);
    });

    it('validates input (400)', async () => {
        for (const bad of [
            { bank_code: '999' }, { bank_code: undefined }, { account_name: '' }, { account_name: 'x' }, { account_name: 'x'.repeat(101) },
            { account_number: '123' }, { account_number: '12345678901234567' }, { account_number: 'abcdefghij' }, { account_number: undefined },
            { nickname: 'n'.repeat(41) }, { nickname: 5 },
        ]) {
            expect((await create(OWNER, bad)).statusCode).toBe(400);
        }
        expect(listPaths(`${COL}/`)).toHaveLength(0);
    });

    it('rejects the same bank + number twice (409), even typed with dashes', async () => {
        await create();
        expect((await create(OWNER, { account_number: '1234567890' })).statusCode).toBe(409);
        // same number at another bank is a different account
        expect((await create(OWNER, { bank_code: '014' })).statusCode).toBe(200);
    });
});

describe('permissions and isolation', () => {
    it('401 without a token; outsiders get 403', async () => {
        expect((await create(null)).statusCode).toBe(401);
        expect((await create('stranger')).statusCode).toBe(403);
    });

    it('only owner and property manager may manage accounts — finance and front desk may not', async () => {
        member('mgr', 'property_manager');
        member('fin', 'finance');
        member('desk', 'front_desk');
        expect((await create('mgr')).statusCode).toBe(200);
        expect((await create('fin', { account_number: '2222222222' })).statusCode).toBe(403);
        expect((await create('desk', { account_number: '3333333333' })).statusCode).toBe(403);
        expect(listPaths(`${COL}/`)).toHaveLength(1);
    });

    it('a manager limited to another property cannot touch this one', async () => {
        member('mgr', 'property_manager', ['bld-B']);
        expect((await create('mgr')).statusCode).toBe(403);
    });

    it('404 for a property that is not the owner\'s', async () => {
        expect((await call(OWNER, { action: 'create', building_id: 'bld-forged', bank_code: '004', account_name: 'AA', account_number: '1234567890' })).statusCode).toBe(404);
    });

    it('rejects unknown actions, a missing building, and non-POST', async () => {
        expect((await call(OWNER, { action: 'delete' })).statusCode).toBe(400);
        const noBld = fakeRes();
        await handler(fakeReq({ action: 'create', owner_uid: OWNER }, OWNER), noBld as never);
        expect(noBld.statusCode).toBe(400);
        const get = fakeRes();
        await handler(fakeReq({}, OWNER, 'GET'), get as never);
        expect(get.statusCode).toBe(405);
    });
});

describe('update and default', () => {
    async function two() {
        const a = (await create()).body.account.id as string;
        const b = (await create(OWNER, { bank_code: '014', account_number: '9876543210' })).body.account.id as string;
        return { a, b };
    }

    it('edits fields, never deletes, and re-checks duplicates', async () => {
        const { a, b } = await two();
        expect((await call(OWNER, { action: 'update', account_id: a, account_name: 'สมหญิง ใจดี', nickname: 'บัญชีหลัก' })).statusCode).toBe(200);
        expect(read(`${COL}/${a}`)).toMatchObject({ account_name: 'สมหญิง ใจดี', nickname: 'บัญชีหลัก' });
        // moving b onto a's bank+number is a duplicate
        expect((await call(OWNER, { action: 'update', account_id: b, bank_code: '004', account_number: '1234567890' })).statusCode).toBe(409);
        expect((await call(OWNER, { action: 'update', account_id: a, bank_code: '999' })).statusCode).toBe(400);
        expect((await call(OWNER, { action: 'update', account_id: a })).statusCode).toBe(400);
        expect((await call(OWNER, { action: 'update', account_id: 'ghost', nickname: 'x' })).statusCode).toBe(404);
        expect((await call(OWNER, { action: 'update', nickname: 'x' })).statusCode).toBe(400);
    });

    it('disabling the default account clears the default; a disabled account cannot become default', async () => {
        const { a, b } = await two();
        await call(OWNER, { action: 'update', account_id: a, status: 'inactive' });
        expect(read(`${COL}/${a}`)).toMatchObject({ status: 'inactive', is_default: false });
        expect((await call(OWNER, { action: 'set_default', account_id: a })).statusCode).toBe(409);
        expect((await call(OWNER, { action: 'set_default', account_id: b })).statusCode).toBe(200);
        expect(read(`${COL}/${b}`)?.is_default).toBe(true);
    });

    it('set_default moves the default so there is only ever one', async () => {
        const { a, b } = await two();
        await call(OWNER, { action: 'set_default', account_id: b });
        expect(read(`${COL}/${a}`)?.is_default).toBe(false);
        expect(read(`${COL}/${b}`)?.is_default).toBe(true);
    });

    it('invalid status values are rejected and updates are audited without full numbers', async () => {
        const { a } = await two();
        expect((await call(OWNER, { action: 'update', account_id: a, status: 'deleted' })).statusCode).toBe(400);
        await call(OWNER, { action: 'update', account_id: a, account_number: '5555555555' });
        const dump = JSON.stringify(listPaths(`users/${OWNER}/audit_logs/`).map(p => read(p)));
        expect(dump).not.toContain('5555555555');
        expect(dump).not.toContain('1234567890');
    });
});
