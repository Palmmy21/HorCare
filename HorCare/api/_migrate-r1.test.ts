import { describe, expect, it } from 'vitest';
import { bahtToSatang, bangkokDate, mapLegacyBill } from './_migrate-r1.js';
import type { MonthlyBill } from '../src/types/index.js';

const ctx = { ownerUid: 'o1', buildingId: 'b1', by: 'migration' };

function bill(over: Partial<MonthlyBill> & Record<string, unknown> = {}): MonthlyBill {
    return {
        id: 'bill_r1_2026-09', room_id: 'r1', room_number: '101', month: '2026-09',
        prev_elec: 100, curr_elec: 150, elec_units: 50, elec_bill: 400, prev_water: 10, curr_water: 15, water_units: 5, water_bill: 125.5,
        water_flat_amount: 0, water_excess_units: 0, water_excess_amount: 0,
        common_fee: 0, room_rent: 3500, total_bill: 4025.5,
        is_saved: true, is_locked: true, is_notified: true, created_at: '2026-09-30T18:30:00Z', updated_at: '2026-09-30T18:30:00Z',
        ...over,
    } as MonthlyBill;
}

describe('money and dates', () => {
    it('baht → satang rounds half away from zero and rejects non-numbers', () => {
        expect(bahtToSatang(4025.5)).toBe(402550);
        expect(bahtToSatang(0.285)).toBe(29);
        expect(bahtToSatang(-1.005)).toBe(-101);
        expect(bahtToSatang('10')).toBeNull();
        expect(bahtToSatang(Number.NaN)).toBeNull();
    });

    it('business days are Bangkok days', () => {
        expect(bangkokDate('2026-09-30T18:30:00Z')).toBe('2026-10-01');
        expect(bangkokDate('2026-09-30T16:59:00Z')).toBe('2026-09-30');
        expect(bangkokDate('nope')).toBeNull();
    });
});

describe('mapLegacyBill', () => {
    it('a saved bill becomes an issued invoice with itemised lines that add up to what the tenant saw', () => {
        const m = mapLegacyBill(bill(), ctx);
        expect(m.issues).toEqual([]);
        expect(m.invoice).toMatchObject({ status: 'issued', period: '2026-09', dedupe_key: 'regular:r1:2026-09', issue_date: '2026-10-01' });
        expect(m.lines.map(l => [l.kind, l.amount_satang])).toEqual([['rent', 350000], ['electricity', 40000], ['water', 12550]]);
        expect(m.lines.reduce((s, l) => s + l.amount_satang, 0)).toBe(402550);
        expect(m.payment).toBeNull();
    });

    it('itemises common fees and keeps the issued total with a visible adjustment when the parts disagree', () => {
        const m = mapLegacyBill(bill({ applied_common_fees: [{ id: 'f', name: 'ขยะ', amount: 50 }], common_fee: 50, total_bill: 4080 }), ctx);
        expect(m.lines.find(l => l.kind === 'common_fee')).toMatchObject({ description: 'ขยะ', amount_satang: 5000 });
        expect(m.lines.at(-1)).toMatchObject({ kind: 'adjustment', amount_satang: 408000 - 407550 });
        expect(m.issues.map(i => i.problem)).toEqual(['total_mismatch']);
    });

    it('a paid bill brings its payment, confirmed and allocated up to the total; overpayment stays as credit', () => {
        const m = mapLegacyBill(bill({ payment_status: 'paid', payment_method: 'cash', paid_amount: 5000, paid_at: '2026-10-03T03:00:00Z', received_by: 'แม่บ้าน' }), ctx);
        expect(m.payment).toMatchObject({ method: 'cash', amount_satang: 500000, allocate_satang: 402550, status: 'confirmed', received_on: '2026-10-03' });
        expect(m.issues.map(i => i.problem)).toEqual(['paid_more_than_total']);
    });

    it('a slip still waiting for the owner stays unverified and unallocated', () => {
        const m = mapLegacyBill(bill({ payment_status: 'pending', slip_image: true, slip_ref: 'abc', slip_amount: 4025.5, bank_account_id: 'acc1', slip_submitted_at: '2026-10-02T01:00:00Z' }), ctx);
        expect(m.payment).toMatchObject({ method: 'transfer', status: 'pending_verification', allocate_satang: 0, reference: 'abc', bank_account_id: 'acc1' });
    });

    it('flags gaps instead of guessing', () => {
        expect(mapLegacyBill(bill({ month: 'sept' }), ctx).issues[0].problem).toBe('missing_room_or_period');
        expect(mapLegacyBill(bill({ total_bill: Number.NaN }), ctx).invoice).toBeNull();
        const t = mapLegacyBill(bill({ payment_status: 'paid', payment_method: 'bank_transfer', paid_amount: 4025.5, paid_at: '2026-10-02T01:00:00Z' }), ctx);
        expect(t.payment?.method).toBe('other');
        expect(t.issues.map(i => i.problem)).toContain('transfer_without_account');
        const d = mapLegacyBill(bill({ is_saved: false, payment_status: 'paid', paid_amount: 1 }), ctx);
        expect(d.invoice?.status).toBe('draft');
        expect(d.issues.map(i => i.problem)).toContain('payment_on_unsaved_bill');
    });

    it('bills whose payments were recorded with allocations are left to the payments collection', () => {
        expect(mapLegacyBill(bill({ payment_status: 'paid', payments_recorded: true }), ctx).payment).toBeNull();
    });
});
