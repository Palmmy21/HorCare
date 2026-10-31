import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import { upsertLateFee } from './_late-fees.js';
import { read, resetFake, seed } from './_fake-firestore.js';

const B = 'users/owner-1/buildings/bld-A';
const BILL = { id: 'bill_r101_2026-10', room_id: 'r101', room_number: '101', month: '2026-10' };
const PER_DAY = { enabled: true, mode: 'per_day' as const, amount: 50, grace_days: 2, max_amount: 300 };
const FINE = `${B}/fines/late_${BILL.id}`;

beforeEach(() => resetFake());

describe('upsertLateFee', () => {
    it('does nothing before the due date + grace days', async () => {
        expect(await upsertLateFee(B, BILL, PER_DAY, 5, '2026-10-07')).toBe(0);
        expect(read(FINE)).toBeUndefined();
    });

    it('creates one late-fee fine and grows it day by day up to the cap', async () => {
        expect(await upsertLateFee(B, BILL, PER_DAY, 5, '2026-10-08')).toBe(50);
        expect(read(FINE)).toMatchObject({ amount: 50, status: 'unpaid', source: 'late_fee', bill_id: BILL.id, room_id: 'r101' });

        expect(await upsertLateFee(B, BILL, PER_DAY, 5, '2026-10-11')).toBe(200);
        expect(read(FINE)).toMatchObject({ amount: 200 });

        expect(await upsertLateFee(B, BILL, PER_DAY, 5, '2026-11-30')).toBe(300);
        expect(read(FINE)).toMatchObject({ amount: 300 });
    });

    it('never changes a fine the tenant already paid or sent a slip for', async () => {
        seed(FINE, { amount: 100, status: 'pending', source: 'late_fee', bill_id: BILL.id });
        expect(await upsertLateFee(B, BILL, PER_DAY, 5, '2026-10-20')).toBe(100);
        expect(read(FINE)).toMatchObject({ amount: 100, status: 'pending' });
    });

    it('does nothing when late fees are off', async () => {
        expect(await upsertLateFee(B, BILL, { ...PER_DAY, enabled: false }, 5, '2026-12-01')).toBe(0);
        expect(await upsertLateFee(B, BILL, undefined, 5, '2026-12-01')).toBe(0);
        expect(read(FINE)).toBeUndefined();
    });
});
