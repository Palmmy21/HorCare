import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import handler from './_branch-summary.js';
import { addAuthUser, admin, aggregateCalls, fakeReq, fakeRes, read, resetFake, seed } from './_fake-firestore.js';

const OWNER = 'owner-1';

async function call(body: Record<string, unknown>, uid = OWNER) {
    const res = fakeRes();
    await handler(fakeReq(body, uid), res as never);
    return res as { statusCode: number; body: any };
}

function seedBranch(id: string) {
    const B = `users/${OWNER}/buildings/${id}`;
    seed(B, { id, name: id, building_type: 'dormitory' });
    seed(`${B}/data/config`, { bill_customization: { due_day: 5 }, late_fee: { grace_days: 0 } });
    seed(`${B}/rooms/r1`, { room_number: '101', is_active: true });
    seed(`${B}/rooms/r2`, { room_number: '102', is_active: true });
    seed(`${B}/maintenance/m1`, { status: 'open' });
    seed(`${B}/maintenance/m2`, { status: 'done' });
    const bill = (k: string, d: object) => seed(`${B}/bills/${k}`, { room_id: 'r1', ...d });
    bill('b1', { month: '2026-11', is_saved: true, payment_status: 'unpaid', total_bill: 4000 }); // overdue, expected
    bill('b2', { month: '2026-11', is_saved: true, payment_status: 'paid', total_bill: 3000 });   // collected
    bill('b3', { month: '2026-10', is_saved: true, total_bill: 2000 });                           // no status = unpaid → overdue
    bill('b4', { month: '2026-10', is_saved: true, payment_status: 'pending', total_bill: 1000 }); // slip sent: not overdue
    bill('b5', { month: '2026-11', is_saved: false, total_bill: 999 });                           // draft: ignored
    bill('b6', { month: '2025-01', is_saved: true, payment_status: 'unpaid', total_bill: 500 });  // older than the lookback
}

beforeEach(() => {
    resetFake();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-13T05:00:00Z'));
    addAuthUser(OWNER, 'o@x.com', 'Owner');
    seed(`users/${OWNER}`, { uid: OWNER });
});
afterEach(() => { vi.useRealTimers(); });

describe('branch summary', () => {
    it('counts overdue bills and this month\'s revenue with aggregation queries, not by reading every bill', async () => {
        seedBranch('bld-agg');
        const res = await call({ action: 'summary', owner_uid: OWNER });
        expect(res.statusCode).toBe(200);
        const b = res.body.branches.find((x: { id: string }) => x.id === 'bld-agg');
        expect(b).toMatchObject({ unitsTotal: 2, overdueInvoices: 2, openRepairs: 1, revenueExpected: 7000, revenueCollected: 3000 });
        expect(aggregateCalls.length).toBeGreaterThanOrEqual(4);
    });

    it('keeps the figures for other server instances, so the next visit reads one document per branch', async () => {
        seedBranch('bld-keep');
        await call({ action: 'summary', owner_uid: OWNER });
        const kept = read(`branch_summaries/${OWNER}__bld-keep`) as { at: number; value: { overdueInvoices: number } };
        expect(kept.value.overdueInvoices).toBe(2);
        expect(typeof kept.at).toBe('number');
    });

    it('takes kept figures that are still fresh instead of counting again', async () => {
        seedBranch('bld-fresh');
        seed(`branch_summaries/${OWNER}__bld-fresh`, {
            at: Date.now() - 60_000,
            value: { id: 'bld-fresh', unitsTotal: 99, unitsOccupied: 0, overdueInvoices: 0, openRepairs: 0, revenueCollected: 0, revenueExpected: 0 },
        });
        const res = await call({ action: 'summary', owner_uid: OWNER });
        expect(res.body.branches.find((x: { id: string }) => x.id === 'bld-fresh').unitsTotal).toBe(99);
    });

    it('reads the bills as before when an aggregation is refused, with the same figures', async () => {
        seedBranch('bld-fallback');
        const agg = admin.firestore.AggregateField as { sum: (f: string) => unknown };
        const sum = agg.sum;
        agg.sum = () => { throw new Error('FAILED_PRECONDITION'); };
        try {
            const res = await call({ action: 'summary', owner_uid: OWNER });
            const b = res.body.branches.find((x: { id: string }) => x.id === 'bld-fallback');
            expect(b).toMatchObject({ overdueInvoices: 2, revenueExpected: 7000, revenueCollected: 3000 });
        } finally {
            agg.sum = sum;
        }
    });
});
