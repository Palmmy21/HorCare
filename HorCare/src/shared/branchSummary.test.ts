import { describe, expect, it } from 'vitest';
import {
  branchInitials, branchKind, branchTotals, greeting, headline, isOverdueBill, lastAccessLabel, monthRevenue,
  roomsBookedTonight, sortBranches, thaiLongDate, type BranchSummary,
} from './branchSummary';

describe('branchKind', () => {
  it('maps every building type onto four looks', () => {
    expect(branchKind('dormitory')).toBe('dorm');
    expect(branchKind('apartment')).toBe('dorm');
    expect(branchKind(undefined)).toBe('dorm');
    expect(branchKind('condo')).toBe('condo');
    expect(branchKind('market')).toBe('market');
    expect(branchKind('hotel')).toBe('resort');
    expect(branchKind('resort')).toBe('resort');
  });
});

describe('isOverdueBill', () => {
  const bill = { month: '2026-11', is_saved: true, payment_status: 'unpaid', total_bill: 3500 };
  it('is overdue only after the due day plus grace', () => {
    expect(isOverdueBill(bill, 5, 0, '2026-11-05')).toBe(false);
    expect(isOverdueBill(bill, 5, 0, '2026-11-06')).toBe(true);
    expect(isOverdueBill(bill, 5, 3, '2026-11-08')).toBe(false);
    expect(isOverdueBill(bill, 5, 3, '2026-11-09')).toBe(true);
  });
  it('ignores paid, slip-pending and unsaved bills', () => {
    expect(isOverdueBill({ ...bill, payment_status: 'paid' }, 5, 0, '2026-12-01')).toBe(false);
    expect(isOverdueBill({ ...bill, payment_status: 'pending' }, 5, 0, '2026-12-01')).toBe(false);
    expect(isOverdueBill({ ...bill, is_saved: false }, 5, 0, '2026-12-01')).toBe(false);
  });
  it('treats a legacy bill without a status as unpaid', () => {
    expect(isOverdueBill({ month: '2026-10', is_saved: true }, 5, 0, '2026-11-13')).toBe(true);
  });
});

describe('monthRevenue', () => {
  it('sums saved bills of the month only', () => {
    const r = monthRevenue([
      { month: '2026-11', is_saved: true, payment_status: 'paid', total_bill: 1000 },
      { month: '2026-11', is_saved: true, payment_status: 'pending', total_bill: 500 },
      { month: '2026-11', is_saved: false, payment_status: 'paid', total_bill: 999 },
      { month: '2026-10', is_saved: true, payment_status: 'paid', total_bill: 700 },
    ], '2026-11');
    expect(r).toEqual({ collected: 1000, expected: 1500 });
  });
});

describe('roomsBookedTonight', () => {
  it('counts distinct rooms whose stay covers tonight', () => {
    expect(roomsBookedTonight([
      { room_id: 'a', status: 'checked_in', check_in: '2026-11-12', check_out: '2026-11-14' },
      { room_id: 'a', status: 'reserved', check_in: '2026-11-13', check_out: '2026-11-14' },
      { room_id: 'b', status: 'reserved', check_in: '2026-11-13', check_out: '2026-11-15' },
      { room_id: 'c', status: 'checked_out', check_in: '2026-11-10', check_out: '2026-11-13' },
      { room_id: 'd', status: 'cancelled', check_in: '2026-11-13', check_out: '2026-11-14' },
    ], '2026-11-13')).toBe(2);
  });
});

describe('branchTotals', () => {
  const b = (o: Partial<BranchSummary>): BranchSummary => ({
    id: 'x', unitsTotal: 0, unitsOccupied: 0, overdueInvoices: 0, openRepairs: 0, revenueCollected: 0, revenueExpected: 0, lastAccessedAt: null, ...o,
  });
  it('weights occupancy by units and adds up pending work', () => {
    const t = branchTotals([
      b({ unitsTotal: 40, unitsOccupied: 34, overdueInvoices: 3, openRepairs: 1, revenueCollected: 1000, revenueExpected: 2000 }),
      b({ unitsTotal: 10, unitsOccupied: 1, openRepairs: 2, revenueCollected: 500, revenueExpected: 500 }),
    ], true);
    expect(t).toEqual({ revenueCollected: 1500, revenueExpected: 2500, occupancyPct: 70, pending: 6 });
  });
  it('hides money without finance access and has no rate without units', () => {
    const t = branchTotals([b({})], false);
    expect(t.revenueCollected).toBeNull();
    expect(t.occupancyPct).toBeNull();
  });
});

describe('sortBranches', () => {
  it('puts the latest opened first and never-opened by name', () => {
    const list = [{ id: '1', name: 'You\'re' }, { id: '2', name: 'Market' }, { id: '3', name: 'HorCare' }, { id: '4', name: 'ONE9 LIFE' }];
    const out = sortBranches(list, { '2': '2026-11-12T10:00:00Z', '4': '2026-11-13T01:00:00Z' });
    expect(out.map(x => x.id)).toEqual(['4', '2', '3', '1']);
  });
});

describe('branchInitials', () => {
  it('gives 1–2 telling letters', () => {
    expect(branchInitials('ONE9 LIFE')).toBe('OL');
    expect(branchInitials('ONE9')).toBe('O9');
    expect(branchInitials("You're")).toBe('Y');
    expect(branchInitials('เรือนไทย')).toBe('ร');
    expect(branchInitials('   ')).toBe('?');
  });
});

describe('wording', () => {
  it('greets by the hour', () => {
    expect(greeting(5)).toBe('สวัสดีตอนเช้า');
    expect(greeting(11)).toBe('สวัสดีตอนเช้า');
    expect(greeting(12)).toBe('สวัสดีตอนบ่าย');
    expect(greeting(17)).toBe('สวัสดีตอนบ่าย');
    expect(greeting(18)).toBe('สวัสดีตอนเย็น');
    expect(greeting(4)).toBe('สวัสดีตอนเย็น');
  });
  it('writes the Thai long date in the Buddhist year', () => {
    expect(thaiLongDate('2026-11-13')).toBe('ศุกร์ที่ 13 พฤศจิกายน 2569');
  });
  it('says how long ago', () => {
    const now = new Date('2026-11-13T10:00:00Z');
    expect(lastAccessLabel(null, now)).toBe('ยังไม่เคยเข้า');
    expect(lastAccessLabel('2026-11-13T08:00:00Z', now)).toBe('เข้าล่าสุด 2 ชม.ที่แล้ว');
    expect(lastAccessLabel('2026-11-13T09:45:00Z', now)).toBe('เข้าล่าสุด 15 นาทีที่แล้ว');
    expect(lastAccessLabel('2026-11-10T10:00:00Z', now)).toBe('เข้าล่าสุด 3 วันที่แล้ว');
  });
  it('words the headline per kind', () => {
    expect(headline('dorm', 34, 40)).toEqual({ label: 'เข้าพัก', value: '34/40 ห้อง', showPct: true });
    expect(headline('market', 52, 60).value).toBe('52/60 แผง');
    expect(headline('resort', 18, 24)).toEqual({ label: 'คืนนี้', value: '18/24 ห้อง', showPct: false });
  });
});
