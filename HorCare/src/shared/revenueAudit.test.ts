import { describe, expect, it } from 'vitest';
import { auditCsv, auditRevenue, monthDays, type AuditInput, type GapKey } from './revenueAudit';
import { sampleAuditInput } from './revenueAuditSample';

const B = (satang: number) => satang / 100;
const base = (over: Partial<AuditInput> = {}): AuditInput => ({
    month: '2026-10', today: '2026-11-11', zone: null, stalls: [], bills: [], plans: [], charges: [], payments: [], attendance: [],
    day_closes: [], vendor_closures: [], market_closures: [], walk_ins: [], collections_available: true, ...over,
});
const stall = (id: string, rent = 3000, occupied = true, zone = 'A') => ({ id, number: id, zone, rent_satang: rent * 100, occupied });
const bill = (room_id: string, o: Partial<import('./revenueAudit').AuditBill> = {}) => ({
    id: `b-${room_id}`, room_id, rent_satang: 300000, total_satang: 300000, discount_satang: 0, discount_labels: [], prorated: false,
    status: 'paid' as const, paid_satang: 300000, pending_slip_satang: 0, ...o,
});

/** Every report must balance: potential − excused = expected, and the gap buckets add up to expected − collected. */
function expectBalanced(r: ReturnType<typeof auditRevenue>) {
    const excused = Object.values(r.excused).reduce((a, b) => a + b, 0);
    expect(r.potential_satang - excused).toBe(r.expected_satang);
    const gaps = Object.values(r.gaps).reduce((a, b) => a + b, 0);
    expect(gaps).toBe(r.expected_satang - r.collected_satang);
    expect(r.gap_satang).toBe(r.expected_satang - r.collected_satang);
    for (const l of r.stalls) {
        expect(l.potential_satang - l.excused_satang).toBe(l.expected_satang);
        expect(Object.values(l.gaps).reduce((a, b) => a + (b ?? 0), 0)).toBe(l.gap_satang);
    }
    const zoneTotal = r.zones.reduce((a, z) => a + z.expected_satang, 0);
    expect(zoneTotal).toBe(r.expected_satang);
}

describe('the customer\'s case: zone A, 64 stalls × ฿3,000', () => {
    const r = auditRevenue({ ...sampleAuditInput(), zone: 'โซน A' });

    it('should bring ฿192,000; ฿140,000 came in; the ฿52,000 gap is fully explained', () => {
        expect(r.stalls_rented).toBe(64);
        expect(B(r.potential_satang)).toBe(192_000);
        // the half-month move-in is a legitimate ฿1,500 off
        expect(B(r.excused.prorate)).toBe(1_500);
        expect(B(r.expected_satang)).toBe(190_500);
        expect(B(r.collected_satang)).toBe(140_000);
        expectBalanced(r);
    });

    it('without the stray stall the numbers are exactly the customer\'s', () => {
        const input = sampleAuditInput();
        input.bills = input.bills.filter(b => b.room_id !== 'C080');
        const z = auditRevenue({ ...input, zone: 'โซน A' });
        expect(B(z.expected_satang + z.excused.prorate)).toBe(192_000);
        expect(B(z.collected_satang)).toBe(140_000);
        expect(B(z.gap_satang + z.excused.prorate)).toBe(52_000);
        const g = (k: GapKey) => B(z.gaps[k]);
        expect(g('not_billed')).toBe(12_000);
        expect(g('discount')).toBe(3_000);
        expect(g('billed_low')).toBe(2_000);
        expect(g('unpaid')).toBe(24_000);
        expect(g('partial')).toBe(3_500);
        expect(g('pending_slip')).toBe(6_000);
        expect(g('unexplained')).toBe(0);
        expectBalanced(z);
    });

    it('names the causes, biggest risk first, with the stalls to look at', () => {
        const ids = r.findings.map(f => f.id);
        expect(ids.slice(0, 2)).toEqual(['unpaid', 'not_billed']);
        const notBilled = r.findings.find(f => f.id === 'not_billed')!;
        expect(notBilled.severity).toBe('high');
        expect(notBilled.stalls).toEqual(['A001', 'A002', 'A003', 'A004']);
        expect(notBilled.actions.length).toBeGreaterThan(0);
        expect(r.findings.find(f => f.id === 'billed_low')!.stalls.sort()).toEqual(['A008', 'A009']);
        expect(auditRevenue(sampleAuditInput()).findings.find(f => f.id === 'vacant_with_bill')!.stalls).toEqual(['C080']);
    });
});

describe('daily stalls, closures and the people who collect', () => {
    const r = auditRevenue({ ...sampleAuditInput(), zone: 'โซน B' });

    it('a market shutdown and a vendor\'s own notice are excused; absent-without-notice and unrecorded days are not', () => {
        // 30 stalls × 31 days × ฿100
        expect(B(r.potential_satang)).toBe(93_000);
        expect(B(r.excused.market_closure)).toBe(30 * 2 * 100);
        expect(B(r.excused.vendor_closure)).toBe(5 * 100);
        expect(B(r.gaps.absent_unreported)).toBe(5 * 2 * 100);
        expect(B(r.gaps.not_recorded)).toBe(100);
        expectBalanced(r);
    });

    it('points at the collector who marks most of the unreported absences', () => {
        const f = r.findings.find(x => x.id === 'absent_unreported')!;
        expect(f.stalls.sort()).toEqual(['B002', 'B003', 'B004', 'B005', 'B006']);
        expect(r.collectors.find(c => c.name === 'สมชาย (คนเก็บ)')!.absent_unreported).toBe(10);
    });

    it('cash short at day close is reported market-wide', () => {
        const all = auditRevenue(sampleAuditInput());
        expect(B(all.cash_difference_satang)).toBe(-300);
        const f = all.findings.find(x => x.id === 'cash_short')!;
        expect(B(f.amount_satang)).toBe(300);
        expect(f.actions[0]).toContain('2026-10-21');
        expect(all.collectors.find(c => c.name === 'สมชาย (คนเก็บ)')!.short_satang).toBe(30000);
        expect(all.findings.some(x => x.id === 'walkin_uncharged')).toBe(true);
        expectBalanced(all);
    });

    it('vacancy is counted as not earned, never as lost', () => {
        const all = auditRevenue(sampleAuditInput());
        expect(all.vacancy_satang).toBeGreaterThan(0);
        expect(all.zones.find(z => z.zone === 'โซน C')).toMatchObject({ rented: 1, stalls: 80 });
    });
});

describe('edge cases', () => {
    it('a rent billed above the set rent is what is due — no false alarm', () => {
        const r = auditRevenue(base({ stalls: [stall('A1')], bills: [bill('A1', { rent_satang: 350000, total_satang: 350000, paid_satang: 350000 })] }));
        expect(r.gap_satang).toBe(0);
        expect(r.findings.filter(f => f.severity !== 'info')).toEqual([]);
        expectBalanced(r);
    });

    it('utilities on a monthly bill are due as billed', () => {
        const r = auditRevenue(base({ stalls: [stall('A1')], bills: [bill('A1', { total_satang: 345000, paid_satang: 300000, status: 'unpaid' })] }));
        expect(B(r.expected_satang)).toBe(3_450);
        expect(B(r.gaps.partial)).toBe(450);
        expectBalanced(r);
    });

    it('a market closure that waives rent reduces monthly rent pro rata, for its zones only', () => {
        const r = auditRevenue(base({
            stalls: [stall('A1'), stall('B1', 3100, true, 'B')],
            market_closures: [{ from_date: '2026-10-01', to_date: '2026-10-03', zones: ['A'], waive_rent: true, reason_label: 'ไฟดับ' }],
        }));
        expect(r.excused.market_closure).toBe(Math.round(300000 * 3 / 31));
        expect(r.stalls.find(l => l.room_id === 'B1')!.excused_satang).toBe(0);
        expectBalanced(r);
    });

    it('the current month counts daily stalls only up to today', () => {
        const r = auditRevenue(base({
            month: '2026-11', today: '2026-11-10', stalls: [stall('D1')],
            plans: [{ room_id: 'D1', mode: 'daily_actual', unit: 'day', rate_satang: 10000, open_days: [0, 1, 2, 3, 4, 5, 6], starts_on: '2026-01-01', ends_on: null }],
        }));
        expect(r.through).toBe('2026-11-10');
        expect(B(r.expected_satang)).toBe(1_000);
        expect(B(r.gaps.not_recorded)).toBe(1_000);
        expect(r.notes.some(n => n.includes('ยังไม่จบ'))).toBe(true);
        expectBalanced(r);
    });

    it('a weekly charge straddling two months counts only its days in this month', () => {
        const r = auditRevenue(base({
            stalls: [stall('W1')],
            plans: [{ room_id: 'W1', mode: 'weekly_advance', unit: 'day', rate_satang: 10000, open_days: [0, 1, 2, 3, 4, 5, 6], starts_on: '2026-10-29', ends_on: null }],
            charges: [{ id: 'c1', kind: 'stall_week', room_id: 'W1', period_start: '2026-10-26', period_end: '2026-11-01', amount_satang: 70000, paid_satang: 70000, status: 'paid' }],
        }));
        // 29–31 Oct are due (฿300); the charge's Oct share is 6 of 7 days (฿600): collected more than due, shown as such
        expect(B(r.expected_satang)).toBe(300);
        expect(B(r.collected_satang)).toBe(600);
        expectBalanced(r);
    });

    it('voided day charges are their own reason', () => {
        const r = auditRevenue(base({
            month: '2026-10', stalls: [stall('D1')],
            plans: [{ room_id: 'D1', mode: 'daily_actual', unit: 'day', rate_satang: 10000, open_days: [4], starts_on: '2026-10-01', ends_on: '2026-10-01' }],
            charges: [{ id: 'c1', kind: 'stall_day', room_id: 'D1', period_start: '2026-10-01', period_end: '2026-10-01', amount_satang: 10000, paid_satang: 0, status: 'void' }],
        }));
        expect(B(r.gaps.voided)).toBe(100);
        expectBalanced(r);
    });

    it('without round data, daily stalls fall back to monthly rules and the report says so', () => {
        const r = auditRevenue(base({ collections_available: false, stalls: [stall('A1')], bills: [bill('A1')] }));
        expect(r.notes.some(n => n.includes('รอบเก็บเงิน'))).toBe(true);
        expectBalanced(r);
    });

    it('monthDays knows month lengths', () => {
        expect(monthDays('2026-02')).toHaveLength(28);
        expect(monthDays('2028-02')).toHaveLength(29);
    });

    it('exports a CSV Excel reads in Thai', () => {
        const csv = auditCsv(auditRevenue({ ...sampleAuditInput(), zone: 'โซน A' }));
        expect(csv.startsWith('﻿แผง,')).toBe(true);
        expect(csv).toContain('A001');
        expect(csv).toContain('มีผู้ค้าแต่ไม่ได้ออกบิล 3000.00');
    });
});
