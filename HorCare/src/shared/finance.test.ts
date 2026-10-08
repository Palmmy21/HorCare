import { describe, expect, it } from 'vitest';
import {
  aging, billedLines, changePct, collectedLines, compare, monthlyRows, monthsBack, openItems, shiftMonth, toCsv, topDebtors,
  type BillLike, type ChargeLike, type FinanceInput, type FineLike,
} from './finance';

const bill = (over: Partial<BillLike> = {}): BillLike => ({ id: 'b1', room_number: '101', month: '2026-09', is_saved: true, room_rent: 3000, elec_bill: 400, water_bill: 100, common_fee: 0, total_bill: 3500, ...over });
const fine = (over: Partial<FineLike> = {}): FineLike => ({ id: 'f1', room_number: '101', amount: 200, date: '2026-09-15', created_at: '2026-09-15T03:00:00Z', ...over });
const charge = (over: Partial<ChargeLike> = {}): ChargeLike => ({ id: 'c1', kind: 'stay', room_number: 'R1', party_name: 'สมชาย', period_start: '2026-09-10', period_end: '2026-09-11', amount_satang: 300000, paid_satang: 0, status: 'open', ...over });
const input = (over: Partial<FinanceInput> = {}): FinanceInput => ({ bills: [], fines: [], payments: [], charges: [], chargePayments: [], ...over });

describe('months', () => {
  it('counts back across years and shifts both ways', () => {
    expect(monthsBack('2026-02', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-09', -12)).toBe('2025-09');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });
});

describe('billed', () => {
  it('splits a bill by category in satang, skips drafts and zero lines, adds fines and live charges, ignores voided charges', () => {
    const lines = billedLines(input({
      bills: [bill(), bill({ id: 'b2', is_saved: false })],
      fines: [fine()], charges: [charge(), charge({ id: 'c2', status: 'void' }), charge({ id: 'c3', kind: 'stall_day', amount_satang: 10000 })],
    }));
    expect(lines.filter(l => l.month === '2026-09' && l.category === 'rent')).toEqual([{ month: '2026-09', category: 'rent', satang: 300000 }]);
    expect(lines.some(l => l.category === 'common_fee')).toBe(false);
    expect(lines.find(l => l.category === 'fine')!.satang).toBe(20000);
    expect(lines.filter(l => l.category === 'stay')).toHaveLength(1);
    expect(lines.find(l => l.category === 'stall')!.satang).toBe(10000);
    expect(lines.reduce((s, l) => s + l.satang, 0)).toBe(350000 + 20000 + 300000 + 10000);
  });
});

describe('collected', () => {
  it('counts old-style paid documents once, recorded payments, and charge payments with refunds coming off', () => {
    const lines = collectedLines(input({
      bills: [bill({ payment_status: 'paid', paid_at: '2026-09-05T05:00:00Z', payment_method: 'cash' }), bill({ id: 'b2', payment_status: 'paid', payments_recorded: true, paid_at: '2026-09-06T05:00:00Z' })],
      fines: [fine({ status: 'paid', paid_at: '2026-09-20T05:00:00Z', slip_image: true })],
      payments: [{ paid_at: '2026-09-07T05:00:00Z', gross_satang: 100000, method: 'bank_transfer', status: 'active' }, { paid_at: '2026-09-07T05:00:00Z', gross_satang: 5, method: 'cash', status: 'void' }],
      chargePayments: [{ amount_satang: 50000, method: 'cash', received_at: '2026-09-11T05:00:00Z' }, { amount_satang: -50000, method: 'cash', received_at: '2026-09-12T05:00:00Z' }],
    }));
    expect(lines).toHaveLength(5);
    expect(lines.find(l => l.satang === 350000)!.method).toBe('cash');
    expect(lines.find(l => l.satang === 20000)!.method).toBe('transfer');
    expect(lines.reduce((s, l) => s + l.satang, 0)).toBe(350000 + 20000 + 100000);
  });

  it('puts a transfer made just after midnight Thai time in the Thai month', () => {
    // 2026-09-30T18:00Z is 01:00 on 1 October in Thailand
    const [l] = collectedLines(input({ payments: [{ paid_at: '2026-09-30T18:00:00Z', gross_satang: 100, method: 'cash', status: 'active' }] }));
    expect(l.month).toBe('2026-10');
  });
});

describe('monthly rows and comparison', () => {
  const data = input({
    bills: [bill({ month: '2025-09', total_bill: 3000, room_rent: 3000, elec_bill: 0, water_bill: 0 }), bill({ id: 'b2', month: '2026-08', total_bill: 3500 }), bill({ id: 'b3', month: '2026-09', room_rent: 4200, elec_bill: 0, water_bill: 0, total_bill: 4200 })],
    payments: [{ paid_at: '2026-09-05T05:00:00Z', gross_satang: 210000, method: 'cash', status: 'active' }],
  });

  it('rate is collected over billed, null when nothing was billed', () => {
    const [r, empty] = monthlyRows(data, ['2026-09', '2026-01']);
    expect(r.collection_rate).toBeCloseTo(0.5);
    expect(empty.collection_rate).toBeNull();
    expect(r.by_category.rent).toBe(420000);
  });

  it('compares with last month and the same month last year', () => {
    const c = compare(data, '2026-09');
    expect(c.now.billed_satang).toBe(420000);
    expect(c.billed_vs_prev).toBeCloseTo(20); // 3500 → 4200
    expect(c.billed_vs_last_year).toBeCloseTo(40); // 3000 → 4200
    expect(c.collected_vs_prev).toBeNull(); // nothing collected last month: no meaningless infinity
    expect(changePct(5, 0)).toBeNull();
    expect(changePct(50, 100)).toBe(-50);
  });
});

describe('what is still owed', () => {
  const data = input({
    bills: [bill({ month: '2026-06', total_bill: 3500 }), bill({ id: 'b2', month: '2026-09', total_bill: 3500, allocated_satang: 100000 }), bill({ id: 'paid', payment_status: 'paid' }), bill({ id: 'b4', room_number: '102', month: '2026-06', total_bill: 1000 })],
    fines: [fine({ status: 'paid' })],
    charges: [charge({ period_end: '2026-10-20', amount_satang: 100000, paid_satang: 40000 }), charge({ id: 'c2', status: 'paid', paid_satang: 300000 })],
  });
  const items = openItems(data);

  it('counts only unpaid money, net of what was already allocated', () => {
    expect(items.map(i => i.outstanding_satang).sort((a, b) => a - b)).toEqual([60000, 100000, 250000, 350000]);
  });

  it('puts each item in its age bucket relative to today', () => {
    const a = aging(items, '2026-10-08');
    expect(a.buckets.map(b => b.count)).toEqual([1, 1, 0, 0, 2]); // charge not due; Sept bill due 30 Sep (8 days); June bills due 30 Jun (100 days → >90)
    expect(a.total_satang).toBe(60000 + 100000 + 250000 + 350000);
  });

  it('lists the biggest past-due debtors first and leaves out what is not due yet', () => {
    const top = topDebtors(items, '2026-10-08');
    expect(top[0]).toMatchObject({ label: 'ห้อง 101' });
    expect(top.some(t => t.label.includes('สมชาย'))).toBe(false);
    expect(topDebtors(items, '2026-10-08', 1)).toHaveLength(1);
  });
});

describe('dataset export', () => {
  it('writes one row per month in baht with a Thai header and quotes anything awkward', () => {
    const rows = monthlyRows(input({ bills: [bill()] }), ['2026-09']);
    const csv = toCsv(rows);
    const [head, line] = csv.split('\r\n');
    expect(head.split(',')[0]).toBe('เดือน');
    expect(line.startsWith('2026-09,3500.00,0.00,0.0,')).toBe(true);
    expect(head.split(',').length).toBe(line.split(',').length);
  });
});
