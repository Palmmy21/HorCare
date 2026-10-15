import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import { applySlipSplit, outstandingSatang, recordSlipPayment, SlipPaymentError } from './_slip-payment.js';
import { read, resetFake, seed } from './_fake-firestore.js';
import type { PaidItem } from './_accounting-data.js';

const B = 'users/o1/buildings/b1';
const pay = (amountSatang: number, slipRef: string) => recordSlipPayment({
    ownerUid: 'o1', buildingId: 'b1', kind: 'bill', itemId: 'bill1', amountSatang, bankAccountId: 'acc1', slipRef,
    paidAt: '2026-10-15T09:30:00+07:00', note: 'test',
});

beforeEach(() => {
    resetFake();
    seed(`${B}/bank_accounts/acc1`, { id: 'acc1', bank_short: 'KBANK', status: 'active' });
    seed(`${B}/bills/bill1`, {
        id: 'bill1', room_id: 'r1', room_number: '101', month: '2026-10', is_saved: true, created_at: '2026-10-01T00:00:00Z',
        room_rent: 3000, elec_bill: 400, water_bill: 100, total_bill: 3500, payment_status: 'pending',
    });
});

describe('recordSlipPayment', () => {
    it('records a part payment, leaves the rest owed, then settles the bill with the last part', async () => {
        const first = await pay(200000, 'ref1');
        expect(first).toMatchObject({ duplicate: false, paid_satang: 200000, outstanding_satang: 150000, fully_paid: false });
        expect(read(`${B}/bills/bill1`)).toMatchObject({ allocated_satang: 200000, payments_recorded: true, payment_status: 'unpaid' });
        expect(read(`${B}/payments/slip-ref1`)).toMatchObject({ gross_satang: 200000, method: 'bank_transfer', verification: 'unverified' });
        expect(outstandingSatang('bill', read(`${B}/bills/bill1`) as unknown as PaidItem)).toBe(150000);

        const last = await pay(150000, 'ref2');
        expect(last).toMatchObject({ outstanding_satang: 0, fully_paid: true });
        expect(read(`${B}/bills/bill1`)).toMatchObject({ payment_status: 'paid', paid_amount: 3500, bank_account: 'KBANK', verification_status: 'unverified' });
    });

    it('never deducts the same slip twice', async () => {
        await pay(100000, 'ref1');
        const again = await pay(100000, 'ref1');
        expect(again.duplicate).toBe(true);
        expect(read(`${B}/bills/bill1`)).toMatchObject({ allocated_satang: 100000 });
    });

    it('refuses more than is owed, and a bill already paid the old way', async () => {
        await expect(pay(400000, 'ref1')).rejects.toBeInstanceOf(SlipPaymentError);
        seed(`${B}/bills/bill1`, { ...read(`${B}/bills/bill1`)!, payment_status: 'paid' });
        await expect(pay(100000, 'ref2')).rejects.toThrow('already_paid');
    });
});

describe('applySlipSplit', () => {
    const split = (slipRef: string, roomId = 'r1') => applySlipSplit({ ownerUid: 'o1', buildingId: 'b1', kind: 'bill', itemId: 'bill1', roomId, slipRef });

    it('records the offered slip amount once, keeps its image, and reports what is left', async () => {
        seed(`${B}/bills/bill1`, { ...read(`${B}/bills/bill1`)!, slip_ref: 'ref1', slip_split_amount: 2000, slip_account_id: 'acc1' });
        seed(`${B}/slip_images/bill1`, { data_url: 'data:image/jpeg;base64,AAAA' });
        const r = await split('ref1');
        expect(r).toMatchObject({ status: 'ok', paid: 2000, total: 3500, outstanding: 1500 });
        expect(read(`${B}/bills/bill1`)?.slip_split_amount).toBeUndefined();
        expect(read(`${B}/slip_images/payment-slip-ref1`)).toMatchObject({ payment_id: 'slip-ref1' });
        expect(await split('ref1')).toMatchObject({ status: 'ok', paid: 2000, outstanding: 1500 }); // pressed twice
    });

    it('refuses a newer slip, another room, or a slip that was not offered', async () => {
        seed(`${B}/bills/bill1`, { ...read(`${B}/bills/bill1`)!, slip_ref: 'ref2', slip_split_amount: 2000, slip_account_id: 'acc1' });
        expect(await split('ref1')).toEqual({ status: 'stale' });
        expect(await split('ref2', 'r9')).toEqual({ status: 'not_found' });
        seed(`${B}/bills/bill1`, { ...read(`${B}/bills/bill1`)!, slip_split_amount: undefined });
        expect(await split('ref2')).toEqual({ status: 'stale' });
    });
});
