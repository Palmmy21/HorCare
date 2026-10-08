import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import handler from './_reconciliation.js';
import { addAuthUser, fakeReq, fakeRes, listPaths, read, resetFake, seed } from './_fake-firestore.js';
import { permissionsForRole } from '../src/shared/permissions.js';

const OWNER = 'owner-1';
const BLD = 'bld-A';
const B = `users/${OWNER}/buildings/${BLD}`;

beforeEach(() => {
    resetFake();
    for (const [u, n] of [[OWNER, 'Owner'], ['fin', 'Fin'], ['desk', 'Desk'], ['stranger', 'S']]) addAuthUser(u, `${u}@x.com`, n);
    seed(`users/${OWNER}`, { uid: OWNER });
    seed(B, { id: BLD });
    seed(`users/${OWNER}/buildings/bld-B`, { id: 'bld-B' });
    seed(`${B}/bank_accounts/acc1`, { id: 'acc1' });
    seed(`${B}/bills/b1`, { id: 'b1', room_id: 'r1', room_number: '101', total_bill: 3500, payment_status: 'paid', verification_status: 'unverified', transaction_ref: 'REF123456', bank_account_id: 'acc1', paid_at: '2026-10-05T10:00:00.000Z' });
    seed(`${B}/bills/b2`, { id: 'b2', room_id: 'r2', room_number: '102', total_bill: 4200, payment_status: 'unpaid' });
    seed(`${B}/fines/f1`, { id: 'f1', room_id: 'r1', room_number: '101', amount: 500, status: 'unpaid' });
    seed(`users/${OWNER}/members/fin`, { uid: 'fin', role: 'finance', permissions: permissionsForRole('finance'), property_ids: ['*'], status: 'active' });
    seed(`users/${OWNER}/members/desk`, { uid: 'desk', role: 'front_desk', permissions: permissionsForRole('front_desk'), property_ids: ['*'], status: 'active' });
});

async function call(uid: string | undefined, body: Record<string, unknown>) {
    const res = fakeRes();
    await handler(fakeReq({ owner_uid: OWNER, building_id: BLD, ...body }, uid), res as never);
    return res as { statusCode: number; body: any };
}
const row = (over: Record<string, unknown> = {}) => ({ occurred_at: '2026-10-05T10:01:00.000Z', amount: 3500, reference: 'ref-123456', description: 'โอนเงิน', ...over });
const imp = (rows: unknown[], uid: string | null = OWNER, over: Record<string, unknown> = {}) => call(uid ?? undefined, { action: 'import', bank_account_id: 'acc1', rows, ...over });
const txs = () => listPaths(`${B}/bank_transactions/`).map(p => read(p)!);

describe('permissions & isolation', () => {
    it('only payment.reconcile may write: owner and finance yes, front desk / stranger / anonymous no', async () => {
        expect((await imp([row()], OWNER)).statusCode).toBe(200);
        expect((await imp([row({ amount: 4200, reference: null })], 'fin')).statusCode).toBe(200);
        expect((await imp([row()], 'desk')).statusCode).toBe(403);
        expect((await imp([row()], 'stranger')).statusCode).toBe(403);
        expect((await imp([row()], null)).statusCode).toBe(401);
    });

    it('a member limited to another property is refused', async () => {
        seed(`users/${OWNER}/members/fin`, { uid: 'fin', role: 'finance', permissions: permissionsForRole('finance'), property_ids: ['bld-B'], status: 'active' });
        expect((await imp([row()], 'fin')).statusCode).toBe(403);
    });
});

describe('import', () => {
    it('matches by reference, stores the result, audits, and is idempotent', async () => {
        const first = await imp([row()]);
        expect(first.body).toMatchObject({ created: 1, skipped: 0, counts: { matched: 1 } });
        const [tx] = txs();
        expect(tx).toMatchObject({ status: 'matched', amount: 3500, bank_account_id: 'acc1', matched: { kind: 'bill', id: 'b1' } });
        expect(listPaths(`users/${OWNER}/audit_logs/`)).toHaveLength(1);
        const again = await imp([row()]);
        expect(again.body).toMatchObject({ created: 0, skipped: 1 });
        expect(txs()).toHaveLength(1);
    });

    it('leaves unrelated money unmatched', async () => {
        await imp([row({ amount: 999, reference: null })]);
        expect(txs()[0].status).toBe('unmatched');
    });

    it('rejects bad input and writes nothing', async () => {
        for (const bad of [
            [], [row({ amount: 0 })], [row({ amount: -5 })], [row({ amount: '3500' })], [row({ amount: 99_999_999 })],
            [row({ occurred_at: 'nope' })], [row({ occurred_at: '2999-01-01T00:00:00Z' })], [row({ reference: 5 })], [row({ description: 'x'.repeat(201) })],
            [row(), row({ amount: -1 })], Array.from({ length: 501 }, (_, i) => row({ amount: i + 1 })),
        ]) expect((await imp(bad as unknown[])).statusCode).toBe(400);
        expect((await imp([row()], OWNER, { bank_account_id: undefined })).statusCode).toBe(400);
        expect((await imp([row()], OWNER, { bank_account_id: 'ghost' })).statusCode).toBe(404);
        expect(txs()).toHaveLength(0);
    });

    it('another property cannot be targeted through this one', async () => {
        const res = await call(OWNER, { action: 'import', building_id: 'bld-B', bank_account_id: 'acc1', rows: [row()] });
        expect(res.statusCode).toBe(404);
    });
});

describe('confirm', () => {
    it('verifies the payment only through a confirmed bank transaction', async () => {
        await imp([row()]);
        const [tx] = txs();
        expect(read(`${B}/bills/b1`)!.verification_status).toBe('unverified');
        const res = await call('fin', { action: 'confirm', tx_id: tx.id, item_kind: 'bill', item_id: 'b1' });
        expect(res.statusCode).toBe(200);
        expect(read(`${B}/bills/b1`)).toMatchObject({ verification_status: 'verified', bank_transaction_id: tx.id, payment_status: 'paid' });
        expect(read(`${B}/bank_transactions/${tx.id}`)).toMatchObject({ status: 'reconciled', reconciled_by: 'fin' });
    });

    it('refuses a bill whose money is tracked by payments + allocations (verify the payment instead)', async () => {
        seed(`${B}/bills/b1`, { ...read(`${B}/bills/b1`)!, payments_recorded: true, allocated_satang: 150000 });
        await imp([row()]);
        const [tx] = txs();
        const res = await call('fin', { action: 'confirm', tx_id: tx.id, item_kind: 'bill', item_id: 'b1' });
        expect(res.statusCode).toBe(409);
        expect(res.body.error).toBe('use_payment_verification');
        expect(read(`${B}/bills/b1`)!.verification_status).toBe('unverified');
        expect(read(`${B}/bank_transactions/${tx.id}`)!.status).not.toBe('reconciled');
    });

    it('never suggests allocation-tracked bills in the first place', async () => {
        seed(`${B}/bills/b1`, { ...read(`${B}/bills/b1`)!, payments_recorded: true, allocated_satang: 150000 });
        await imp([row()]);
        expect(txs()[0]).toMatchObject({ status: 'unmatched', matched: null, candidates: [] });
    });

    it('can mark an unpaid bill paid when the money is seen first', async () => {
        await imp([row({ amount: 4200, reference: null, occurred_at: '2026-10-06T09:00:00.000Z' })]);
        const [tx] = txs();
        expect((await call(OWNER, { action: 'confirm', tx_id: tx.id, item_kind: 'bill', item_id: 'b2' })).statusCode).toBe(200);
        expect(read(`${B}/bills/b2`)).toMatchObject({ payment_status: 'paid', verification_status: 'verified', paid_at: '2026-10-06T09:00:00.000Z', payment_method: 'bank_transfer' });
    });

    it('a fine becomes paid too', async () => {
        await imp([row({ amount: 500, reference: null })]);
        const [tx] = txs();
        await call(OWNER, { action: 'confirm', tx_id: tx.id, item_kind: 'fine', item_id: 'f1' });
        expect(read(`${B}/fines/f1`)).toMatchObject({ status: 'paid', verification_status: 'verified' });
    });

    it('refuses a different amount, a reconciled transaction, an item already taken, unknown ids, and bad input', async () => {
        await imp([row(), row({ amount: 3500, occurred_at: '2026-10-07T10:00:00.000Z', reference: 'OTHER99999' })]);
        const [a, b] = txs();
        expect((await call(OWNER, { action: 'confirm', tx_id: a.id, item_kind: 'bill', item_id: 'b2' })).body.error).toBe('amount_mismatch');
        expect((await call(OWNER, { action: 'confirm', tx_id: a.id, item_kind: 'bill', item_id: 'b1' })).statusCode).toBe(200);
        expect((await call(OWNER, { action: 'confirm', tx_id: a.id, item_kind: 'bill', item_id: 'b1' })).body.error).toBe('already_reconciled');
        expect((await call(OWNER, { action: 'confirm', tx_id: b.id, item_kind: 'bill', item_id: 'b1' })).body.error).toBe('item_already_reconciled');
        expect((await call(OWNER, { action: 'confirm', tx_id: 'ghost', item_kind: 'bill', item_id: 'b1' })).statusCode).toBe(404);
        expect((await call(OWNER, { action: 'confirm', tx_id: b.id, item_kind: 'bill', item_id: 'ghost' })).statusCode).toBe(404);
        expect((await call(OWNER, { action: 'confirm', tx_id: b.id, item_kind: 'room', item_id: 'b1' })).statusCode).toBe(400);
        expect((await call('desk', { action: 'confirm', tx_id: b.id, item_kind: 'bill', item_id: 'b1' })).statusCode).toBe(403);
    });

    it('a second identical transfer cannot verify the same bill twice (conflict, not auto-match)', async () => {
        await imp([row(), row({ occurred_at: '2026-10-07T10:00:00.000Z', reference: 'OTHER99999' })]);
        const [a, b] = txs();
        await call(OWNER, { action: 'confirm', tx_id: a.id, item_kind: 'bill', item_id: 'b1' });
        await call(OWNER, { action: 'rematch' });
        expect(read(`${B}/bank_transactions/${b.id}`)).toMatchObject({ status: 'conflict', conflict_reason: 'already_reconciled' });
    });
});

describe('confirm_matched / reject / rematch', () => {
    it('confirm_matched only touches reference-backed matches', async () => {
        await imp([row(), row({ amount: 4200, reference: null })]);
        const res = await call(OWNER, { action: 'confirm_matched' });
        expect(res.body).toEqual({ confirmed: 1, failed: 0 });
        expect(read(`${B}/bills/b2`)!.verification_status).toBeUndefined();
    });

    it('reject drops the wrong suggestion for good', async () => {
        await imp([row()]);
        const [tx] = txs();
        const res = await call(OWNER, { action: 'reject', tx_id: tx.id });
        expect(res.body.status).toBe('unmatched');
        await call(OWNER, { action: 'rematch' });
        expect(read(`${B}/bank_transactions/${tx.id}`)).toMatchObject({ status: 'unmatched', matched: null });
        expect((await call(OWNER, { action: 'reject', tx_id: 'ghost' })).statusCode).toBe(404);
    });

    it('rematch picks up a slip that arrived after the import', async () => {
        await imp([row({ amount: 4200, reference: 'LATE123456', occurred_at: '2026-10-06T09:00:00.000Z' })]);
        expect(txs()[0].status).toBe('unmatched');
        seed(`${B}/bills/b2`, { id: 'b2', room_id: 'r2', room_number: '102', total_bill: 4200, payment_status: 'paid', verification_status: 'unverified', transaction_ref: 'LATE123456', bank_account_id: 'acc1' });
        expect((await call(OWNER, { action: 'rematch' })).body.changed).toBe(1);
        expect(txs()[0]).toMatchObject({ status: 'matched', matched: { id: 'b2' } });
    });

    it('rejects unknown actions', async () => {
        expect((await call(OWNER, { action: 'nuke' })).statusCode).toBe(400);
    });
});