import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import handler, { billToDoc, legacyPayment } from './_accounting.js';
import { addAuthUser, fakeReq, fakeRes, listPaths, read, resetFake, seed } from './_fake-firestore.js';
import { permissionsForRole } from '../src/shared/permissions.js';

const OWNER = 'owner-1';
const B1 = 'bld-1';
const B2 = 'bld-2';
const b1 = `users/${OWNER}/buildings/${B1}`;

const bill = (id: string, room: string, over: Record<string, unknown> = {}) => ({
    id, room_id: room, room_number: room.toUpperCase(), month: '2026-10', room_rent: 3000, elec_bill: 400, water_bill: 100, common_fee: 0, total_bill: 3500,
    is_saved: true, created_at: '2026-10-05T03:00:00Z', updated_at: '2026-10-05T03:00:00Z', payment_status: 'unpaid', ...over,
});

beforeEach(() => {
    resetFake();
    for (const [u, n] of [[OWNER, 'Owner'], ['fin', 'Fin'], ['desk', 'Desk'], ['mgr', 'Mgr'], ['stranger', 'S']]) addAuthUser(u, `${u}@x.com`, n);
    seed(`users/${OWNER}`, { uid: OWNER });
    for (const b of [B1, B2]) seed(`users/${OWNER}/buildings/${b}`, { id: b });
    seed(`${b1}/rooms/r1`, { room_number: 'R1' });
    seed(`${b1}/rooms/r2`, { room_number: 'R2' });
    seed(`${b1}/bank_accounts/acc1`, { id: 'acc1', status: 'active', bank_short: 'KBANK' });
    seed(`${b1}/bills/b1`, bill('b1', 'r1'));
    seed(`${b1}/bills/b2`, bill('b2', 'r2', { month: '2026-09', created_at: '2026-09-05T03:00:00Z' }));
    seed(`${b1}/bills/draft`, bill('draft', 'r1', { is_saved: false }));
    seed(`${b1}/fines/f1`, { id: 'f1', room_id: 'r1', room_number: 'R1', reason: 'x', amount: 500, date: '2026-10-07', status: 'unpaid', created_at: '2026-10-07T03:00:00Z' });
    for (const [uid, role, props] of [['fin', 'finance', ['*']], ['desk', 'front_desk', ['*']], ['mgr', 'property_manager', [B2]]] as const)
        seed(`users/${OWNER}/members/${uid}`, { uid, role, permissions: permissionsForRole(role), property_ids: props, status: 'active' });
});

async function call(uid: string | null, body: Record<string, unknown>) {
    const res = fakeRes();
    await handler(fakeReq({ owner_uid: OWNER, ...body }, uid ?? undefined), res as never);
    return res as { statusCode: number; body: any };
}
const pay = (over: Record<string, unknown> = {}, uid: string | null = OWNER) =>
    call(uid, { action: 'record_payment', building_id: B1, room_id: 'r1', method: 'cash', paid_at: '2026-10-07T03:00:00Z', allocations: [{ kind: 'bill', id: 'b1', amount: 3500 }], ...over });

describe('the Mango export is gone', () => {
    it('its actions are unknown now', async () => {
        for (const action of ['profile_save', 'preview', 'create_batch', 'download', 'confirm_import']) {
            expect((await call(OWNER, { action, building_id: B1 })).body.error).toBe('unknown_action');
        }
    });
});

describe('record_payment', () => {
    it('partial payment: the bill stays unpaid until fully allocated', async () => {
        expect((await pay({ allocations: [{ kind: 'bill', id: 'b1', amount: 1500 }] })).statusCode).toBe(200);
        expect(read(`${b1}/bills/b1`)).toMatchObject({ allocated_satang: 150000, payment_status: 'unpaid', payments_recorded: true });
        expect((await pay({ allocations: [{ kind: 'bill', id: 'b1', amount: 2000 }] })).statusCode).toBe(200);
        expect(read(`${b1}/bills/b1`)).toMatchObject({ allocated_satang: 350000, payment_status: 'paid' });
        expect(listPaths(`${b1}/payments/`)).toHaveLength(2);
    });

    it('one payment can settle several bills of the same room', async () => {
        seed(`${b1}/bills/b3`, bill('b3', 'r1', { month: '2026-08', created_at: '2026-08-05T03:00:00Z' }));
        const r = await pay({ allocations: [{ kind: 'bill', id: 'b1', amount: 3500 }, { kind: 'bill', id: 'b3', amount: 3500 }] });
        expect(r.statusCode).toBe(200);
        expect(r.body.payment.gross_satang).toBe(700000);
        expect(read(`${b1}/bills/b3`)).toMatchObject({ payment_status: 'paid' });
    });

    it('rejects over-payment, wrong room, drafts, bad amounts, future dates, duplicates, and missing bank account', async () => {
        expect((await pay({ allocations: [{ kind: 'bill', id: 'b1', amount: 3500.01 }] })).body.error).toBe('exceeds_outstanding');
        expect((await pay({ allocations: [{ kind: 'bill', id: 'b2', amount: 10 }] })).body.error).toBe('target_wrong_room');
        expect((await pay({ allocations: [{ kind: 'bill', id: 'draft', amount: 10 }] })).body.error).toBe('target_not_issued');
        expect((await pay({ allocations: [{ kind: 'bill', id: 'ghost', amount: 10 }] })).body.error).toBe('target_not_found');
        for (const bad of [
            { allocations: [] }, { allocations: [{ kind: 'bill', id: 'b1', amount: 0 }] }, { allocations: [{ kind: 'bill', id: 'b1', amount: -5 }] },
            { allocations: [{ kind: 'room', id: 'b1', amount: 5 }] }, { allocations: [{ kind: 'bill', id: 'b1', amount: 5 }, { kind: 'bill', id: 'b1', amount: 5 }] },
            { paid_at: '2999-01-01T00:00:00Z' }, { paid_at: 'nope' }, { method: 'barter' }, { note: 'x'.repeat(201) },
        ]) expect((await pay(bad)).statusCode).toBe(400);
        expect((await pay({ method: 'bank_transfer' })).body.error).toBe('bank_account_required');
        expect((await pay({ method: 'bank_transfer', bank_account_id: 'ghost' })).body.error).toBe('bank_account_invalid');
        expect((await pay({ building_id: undefined })).statusCode).toBe(400);
        expect(listPaths(`${b1}/payments/`)).toHaveLength(0);
    });

    it('needs payment.create on that property', async () => {
        expect((await pay({}, 'desk')).statusCode).toBe(200); // front desk has payment.create
        expect((await pay({}, 'stranger')).statusCode).toBe(403);
        expect((await pay({}, null)).statusCode).toBe(401);
        expect((await pay({}, 'mgr')).statusCode).toBe(403); // a manager of another property only
    });
});

describe('verify_payment', () => {
    it('a transfer is confirmed only against a matching, unused bank transaction', async () => {
        const p = (await pay({ method: 'bank_transfer', bank_account_id: 'acc1' })).body.payment;
        expect(p.verification).toBe('unverified');
        seed(`${b1}/bank_transactions/t-bad`, { id: 't-bad', amount: 3499, bank_account_id: 'acc1', status: 'unmatched' });
        seed(`${b1}/bank_transactions/t-acc`, { id: 't-acc', amount: 3500, bank_account_id: 'other', status: 'unmatched' });
        seed(`${b1}/bank_transactions/t-ok`, { id: 't-ok', amount: 3500, bank_account_id: 'acc1', status: 'matched' });
        const verify = (tx: string, uid: string | null = 'fin') => call(uid, { action: 'verify_payment', building_id: B1, payment_id: p.id, bank_transaction_id: tx });
        expect((await verify('t-bad')).body.error).toBe('amount_mismatch');
        expect((await verify('t-acc')).body.error).toBe('account_mismatch');
        expect((await verify('t-ok', 'desk')).statusCode).toBe(403); // payment.reconcile only
        expect((await verify('t-ok')).statusCode).toBe(200);
        expect(read(`${b1}/bank_transactions/t-ok`)).toMatchObject({ status: 'reconciled', payment_id: p.id });
        expect(read(`${b1}/payments/${p.id}`)).toMatchObject({ verification: 'verified', bank_transaction_id: 't-ok' });
        expect((await verify('t-ok')).body.error).toBe('transaction_already_used');
    });
});

describe('conversion helpers', () => {
    it('billToDoc builds lines that add up to the total, ignoring zero components', () => {
        const d = billToDoc(bill('x', 'r1') as never);
        expect(d.lines.map(l => [l.category, l.amount_satang])).toEqual([['rent', 300000], ['electric', 40000], ['water', 10000]]);
        expect(d.lines.reduce((s, l) => s + l.amount_satang, 0)).toBe(d.total_satang);
    });
    it('the revision ignores payment fields so paying a bill never looks like an edit', () => {
        const a = billToDoc(bill('x', 'r1') as never).revision;
        const b = billToDoc(bill('x', 'r1', { payment_status: 'paid', paid_at: 'now', updated_at: 'later' }) as never).revision;
        expect(a).toBe(b);
    });
    it('legacyPayment only exists for paid, not-yet-migrated items', () => {
        expect(legacyPayment('bill', bill('x', 'r1') as never)).toBeNull();
        expect(legacyPayment('bill', bill('x', 'r1', { payment_status: 'paid', payments_recorded: true }) as never)).toBeNull();
        const l = legacyPayment('bill', bill('x', 'r1', { payment_status: 'paid', paid_amount: 3500, slip_ref: 'r', verification_status: 'verified', bank_account_id: 'acc1', paid_at: '2026-10-07T00:00:00Z' }) as never)!;
        expect(l).toMatchObject({ method: 'bank_transfer', channel: 'bank:acc1', gross_satang: 350000, verification: 'verified' });
    });
});
