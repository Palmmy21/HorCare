import { describe, expect, it } from 'vitest';
import {
  bookingActionBlock, buildRound, chargeStatusFor, cleanBookingInput, cleanDayCloseInput, cleanPaymentInput, cleanPlanInput, cleanRateInput,
  dayOfWeek, dayTotals, occupancyOn, outstanding, planOpenOn, quoteStay, resolveRate, roundTotals, staysOverlap, stallWeekCharge, stayNights, weekStart,
  type Charge, type Rate, type StallPlan,
} from './collections';

const NOW = new Date('2026-10-08T05:00:00Z'); // Thu 2026-10-08 in Thailand
const rate = (o: Partial<Rate> & { id: string }): Rate => ({
  name: o.id, purpose: 'stay', unit: 'night', amount_satang: 100000, scope: 'all', zone: null, room_id: null, valid_from: null, valid_to: null, priority: 0, active: true, ...o,
});

describe('resolveRate', () => {
  const q = { purpose: 'stay' as const, unit: 'night' as const, roomId: 'r1', zone: 'A', date: '2026-10-10' };
  it('room beats zone beats everything', () => {
    const rates = [rate({ id: 'all' }), rate({ id: 'zone', scope: 'zone', zone: 'A' }), rate({ id: 'room', scope: 'room', room_id: 'r1' })];
    expect(resolveRate(rates, q)?.id).toBe('room');
    expect(resolveRate(rates.slice(0, 2), q)?.id).toBe('zone');
    expect(resolveRate(rates.slice(0, 1), q)?.id).toBe('all');
    expect(resolveRate(rates, { ...q, roomId: 'other', zone: 'B' })?.id).toBe('all');
  });
  it('a seasonal rate beats the always-on one, and priority breaks ties', () => {
    const base = rate({ id: 'base', amount_satang: 100000 });
    const season = rate({ id: 'season', amount_satang: 150000, valid_from: '2026-10-01', valid_to: '2026-10-31' });
    expect(resolveRate([base, season], q)?.id).toBe('season');
    expect(resolveRate([base, season], { ...q, date: '2026-11-01' })?.id).toBe('base');
    expect(resolveRate([rate({ id: 'a', priority: 1 }), rate({ id: 'b', priority: 5 })], q)?.id).toBe('b');
  });
  it('ignores inactive rates, other purposes/units, and returns null when nothing fits', () => {
    expect(resolveRate([rate({ id: 'off', active: false })], q)).toBeNull();
    expect(resolveRate([rate({ id: 'stall', purpose: 'stall', unit: 'day' })], q)).toBeNull();
    expect(resolveRate([rate({ id: 'z', scope: 'zone', zone: 'B' })], q)).toBeNull();
    expect(resolveRate([], q)).toBeNull();
  });
});

describe('quoteStay', () => {
  it('prices each night with its own rate; the check-out day is free', () => {
    const rates = [rate({ id: 'base', amount_satang: 100000 }), rate({ id: 'hol', amount_satang: 200000, valid_from: '2026-10-11', valid_to: '2026-10-12' })];
    const q = quoteStay(rates, { roomId: 'r1', checkIn: '2026-10-10', checkOut: '2026-10-13' });
    expect(q.nights.map(n => [n.date, n.amount_satang])).toEqual([['2026-10-10', 100000], ['2026-10-11', 200000], ['2026-10-12', 200000]]);
    expect(q.total_satang).toBe(500000);
    expect(q.missing).toEqual([]);
  });
  it('lists nights that have no rate instead of guessing', () => {
    const q = quoteStay([rate({ id: 'x', valid_from: '2026-10-10', valid_to: '2026-10-10' })], { roomId: 'r1', checkIn: '2026-10-10', checkOut: '2026-10-12' });
    expect(q.missing).toEqual(['2026-10-11']);
    expect(q.total_satang).toBe(100000);
  });
  it('stayNights handles ranges and nonsense', () => {
    expect(stayNights('2026-10-31', '2026-11-02')).toEqual(['2026-10-31', '2026-11-01']);
    expect(stayNights('2026-10-10', '2026-10-10')).toEqual([]);
    expect(stayNights('2026-10-12', '2026-10-10')).toEqual([]);
  });
});

describe('cleanRateInput', () => {
  const ok = { name: 'ห้องมาตรฐาน', purpose: 'stay', unit: 'night', amount: 1200, scope: 'zone', zone: 'A' };
  it('accepts a valid rate in satang', () => {
    expect(cleanRateInput(ok)).toMatchObject({ amount_satang: 120000, scope: 'zone', zone: 'A', room_id: null, active: true, priority: 0 });
  });
  it('rejects bad scope targets, units, dates and amounts', () => {
    for (const bad of [
      { scope: 'zone', zone: '' }, { scope: 'room' }, { unit: 'week' }, { purpose: 'stall', unit: 'night' }, { amount: -1 }, { amount: '5' }, { name: 'x' },
      { valid_from: '2026-10-10', valid_to: '2026-10-01' }, { valid_from: 'soon' }, { priority: 500 }, { purpose: 'rent' },
    ]) expect(cleanRateInput({ ...ok, ...bad }), JSON.stringify(bad)).toBeNull();
  });
});

describe('cleanBookingInput', () => {
  const ok = { room_id: 'r1', guest_name: 'สมชาย ใจดี', guest_phone: '081-234-5678', adults: 2, check_in: '2026-10-10', check_out: '2026-10-12', deposit: 500 };
  it('accepts and normalises', () => {
    expect(cleanBookingInput(ok, NOW)).toMatchObject({ guest_phone: '0812345678', deposit_satang: 50000, adults: 2 });
  });
  it('rejects past check-in, reversed or over-long stays, bad guests', () => {
    for (const bad of [{ check_in: '2026-10-07' }, { check_out: '2026-10-10' }, { check_out: '2027-01-01' }, { guest_name: '' }, { adults: 0 }, { adults: 99 }, { guest_phone: '12' }, { deposit: -1 }, { room_id: '' }, { notes: 'x'.repeat(501) }])
      expect(cleanBookingInput({ ...ok, ...bad }, NOW), JSON.stringify(bad)).toBeNull();
  });
  it('today is allowed as a check-in day', () => {
    expect(cleanBookingInput({ ...ok, check_in: '2026-10-08', check_out: '2026-10-09' }, NOW)).not.toBeNull();
  });
});

describe('stays and calendar', () => {
  it('check-out day is free for the next guest', () => {
    expect(staysOverlap({ check_in: '2026-10-10', check_out: '2026-10-12' }, { check_in: '2026-10-12', check_out: '2026-10-14' })).toBe(false);
    expect(staysOverlap({ check_in: '2026-10-10', check_out: '2026-10-12' }, { check_in: '2026-10-11', check_out: '2026-10-13' })).toBe(true);
  });
  it('occupancy counts holding stays only', () => {
    const bs = [
      { status: 'checked_in' as const, check_in: '2026-10-08', check_out: '2026-10-10' },
      { status: 'cancelled' as const, check_in: '2026-10-08', check_out: '2026-10-10' },
      { status: 'reserved' as const, check_in: '2026-10-09', check_out: '2026-10-11' },
    ];
    expect(occupancyOn(bs, 4, '2026-10-09')).toBe(0.5);
    expect(occupancyOn(bs, 4, '2026-10-10')).toBe(0.25);
    expect(occupancyOn(bs, 0, '2026-10-09')).toBe(0);
  });
  it('actions: check-in from the arrival day, check-out only when paid up, cancel while holding', () => {
    const b = (status: 'reserved' | 'checked_in' | 'checked_out' | 'cancelled', ci = '2026-10-08', co = '2026-10-10') => ({ status, check_in: ci, check_out: co });
    expect(bookingActionBlock(b('reserved'), 'check_in', '2026-10-08', 0)).toBeNull();
    expect(bookingActionBlock(b('reserved', '2026-10-09'), 'check_in', '2026-10-08', 0)).toBe('too_early');
    expect(bookingActionBlock(b('reserved', '2026-10-01', '2026-10-03'), 'check_in', '2026-10-08', 0)).toBe('stay_already_over');
    expect(bookingActionBlock(b('checked_in'), 'check_in', '2026-10-08', 0)).toBe('not_reserved');
    expect(bookingActionBlock(b('checked_in'), 'check_out', '2026-10-10', 500)).toBe('unpaid_balance');
    expect(bookingActionBlock(b('checked_in'), 'check_out', '2026-10-10', 0)).toBeNull();
    expect(bookingActionBlock(b('reserved'), 'check_out', '2026-10-10', 0)).toBe('not_checked_in');
    expect(bookingActionBlock(b('reserved'), 'cancel', '2026-10-08', 0)).toBeNull();
    expect(bookingActionBlock(b('checked_out'), 'cancel', '2026-10-08', 0)).toBe('cannot_cancel');
  });
});

describe('weeks and stall plans', () => {
  const plan = (o: Partial<StallPlan> = {}): StallPlan => ({
    id: 'p', room_id: 's1', room_number: 'A01', mode: 'weekly_advance', unit: 'day', rate_satang: 10000, open_days: [5, 6, 0], starts_on: '2026-01-01', ends_on: null, status: 'active', ...o,
  });
  it('weeks run Monday to Sunday', () => {
    expect(dayOfWeek('2026-10-08')).toBe(4); // Thursday
    expect(weekStart('2026-10-08')).toBe('2026-10-05');
    expect(weekStart('2026-10-11')).toBe('2026-10-05'); // Sunday belongs to the week that started Monday
    expect(weekStart('2026-10-05')).toBe('2026-10-05');
  });
  it('a plan is open only on its days, within its dates', () => {
    expect(planOpenOn(plan(), '2026-10-09')).toBe(true);  // Friday
    expect(planOpenOn(plan(), '2026-10-08')).toBe(false); // Thursday
    expect(planOpenOn(plan({ ends_on: '2026-10-08' }), '2026-10-09')).toBe(false);
    expect(planOpenOn(plan({ starts_on: '2026-10-10' }), '2026-10-09')).toBe(false);
    expect(planOpenOn(plan({ status: 'ended' }), '2026-10-09')).toBe(false);
  });
  it('weekly charge = open days × day rate, skipping days the shop announced it is closed', () => {
    const w = stallWeekCharge(plan(), '2026-10-05', new Set(), null, null);
    expect(w).toMatchObject({ days: 3, amount_satang: 30000, dates: ['2026-10-09', '2026-10-10', '2026-10-11'] });
    expect(stallWeekCharge(plan(), '2026-10-05', new Set(['2026-10-10']), null, null).amount_satang).toBe(20000);
    expect(stallWeekCharge(plan(), '2026-10-05', new Set(['2026-10-09', '2026-10-10', '2026-10-11']), null, null).amount_satang).toBe(0);
  });
  it('a flat weekly rate does not change with the number of open days, but is zero when the stall never trades', () => {
    expect(stallWeekCharge(plan({ unit: 'week', rate_satang: 50000 }), '2026-10-05', new Set(), null, null).amount_satang).toBe(50000);
    expect(stallWeekCharge(plan({ unit: 'week', rate_satang: 50000 }), '2026-10-05', new Set(['2026-10-09', '2026-10-10', '2026-10-11']), null, null).amount_satang).toBe(0);
  });
  it('falls back to the market rate when the plan has none', () => {
    expect(stallWeekCharge(plan({ rate_satang: null }), '2026-10-05', new Set(), 8000, null).amount_satang).toBe(24000);
    expect(stallWeekCharge(plan({ rate_satang: null, unit: 'week' }), '2026-10-05', new Set(), null, 40000).amount_satang).toBe(40000);
    expect(stallWeekCharge(plan({ rate_satang: null }), '2026-10-05', new Set(), null, null).amount_satang).toBe(0);
  });
});

describe('cleanPlanInput', () => {
  const ok = { room_id: 's1', mode: 'weekly_advance', unit: 'day', rate: 100, open_days: [6, 0, 6], starts_on: '2026-10-01' };
  it('accepts and sorts/dedupes the open days', () => {
    expect(cleanPlanInput(ok)).toMatchObject({ rate_satang: 10000, open_days: [0, 6], ends_on: null });
    expect(cleanPlanInput({ ...ok, rate: undefined })?.rate_satang).toBeNull();
  });
  it('rejects bad input; daily-actual must be per day', () => {
    for (const bad of [{ mode: 'x' }, { unit: 'month' }, { open_days: [] }, { open_days: [7] }, { open_days: [1.5] }, { starts_on: 'x' }, { ends_on: '2026-09-01' }, { rate: -1 }, { room_id: '' }, { mode: 'daily_actual', unit: 'week' }])
      expect(cleanPlanInput({ ...ok, ...bad }), JSON.stringify(bad)).toBeNull();
  });
});

describe('payments', () => {
  it('cash needs no account; a transfer must name the receiving account', () => {
    expect(cleanPaymentInput({ amount: 100, method: 'cash' })).toEqual({ amount_satang: 10000, method: 'cash', bank_account_id: null, note: null });
    expect(cleanPaymentInput({ amount: 100, method: 'transfer', bank_account_id: 'acc1', note: ' ok ' })).toMatchObject({ bank_account_id: 'acc1', note: 'ok' });
    for (const bad of [{ amount: 100, method: 'transfer' }, { amount: 0, method: 'cash' }, { amount: -5, method: 'cash' }, { amount: '5', method: 'cash' }, { amount: 5, method: 'card' }, { amount: 5, method: 'cash', note: 'x'.repeat(201) }])
      expect(cleanPaymentInput(bad as never)).toBeNull();
  });
  it('outstanding and status', () => {
    expect(outstanding({ amount_satang: 1000, paid_satang: 400, status: 'open' })).toBe(600);
    expect(outstanding({ amount_satang: 1000, paid_satang: 1200, status: 'open' })).toBe(0);
    expect(outstanding({ amount_satang: 1000, paid_satang: 0, status: 'void' })).toBe(0);
    expect(chargeStatusFor(1000, 1000)).toBe('paid');
    expect(chargeStatusFor(1000, 999)).toBe('open');
    expect(chargeStatusFor(0, 0)).toBe('open');
  });
});

describe('the collector round', () => {
  const plans: StallPlan[] = [
    { id: 'p1', room_id: 's1', room_number: 'A1', mode: 'weekly_advance', unit: 'day', rate_satang: 10000, open_days: [4, 5], starts_on: '2026-01-01', ends_on: null, status: 'active' },
    { id: 'p2', room_id: 's2', room_number: 'A2', mode: 'daily_actual', unit: 'day', rate_satang: 5000, open_days: [4, 5], starts_on: '2026-01-01', ends_on: null, status: 'active' },
    { id: 'p3', room_id: 's3', room_number: 'A10', mode: 'daily_actual', unit: 'day', rate_satang: 5000, open_days: [6], starts_on: '2026-01-01', ends_on: null, status: 'active' },
  ];
  const rooms = [{ id: 's1', room_number: 'A1' }, { id: 's2', room_number: 'A2' }, { id: 's3', room_number: 'A10' }, { id: 's4', room_number: 'A3' }];
  const charge = (o: Partial<Charge>): Charge => ({
    id: 'c', kind: 'stall_week', room_id: 's1', room_number: 'A1', party_name: 'x', party_phone: null, booking_id: null, period_start: '', period_end: '', description: '',
    amount_satang: 20000, paid_satang: 0, status: 'open', dedupe_key: '', created_by: 'u', created_at: '', ...o,
  });
  const run = (charges: Charge[] = [], closed: string[] = []) => buildRound({
    date: '2026-10-08', plans, charges, closedToday: new Set(closed), rooms, dayRateOf: () => null, weekRateOf: () => null,
  });

  it('shows what each stall owes today; stalls with no plan or not open today are not asked', () => {
    const rows = run();
    expect(rows.map(r => [r.room_number, r.status, r.expected_satang])).toEqual([
      ['A1', 'due', 20000],          // weekly: Thu + Fri
      ['A2', 'due', 5000],
      ['A3', 'not_trading', 0],      // no plan
      ['A10', 'not_trading', 0],     // only trades Saturdays (listed in natural order: A2 before A10)
    ]);
  });
  it('a weekly stall that paid is done for the week; a part-payment stays due for the rest', () => {
    const wk = '2026-10-05';
    expect(run([charge({ dedupe_key: `stall-week:s1:${wk}`, paid_satang: 20000, status: 'paid' })])[0]).toMatchObject({ status: 'paid', expected_satang: 0 });
    expect(run([charge({ dedupe_key: `stall-week:s1:${wk}`, paid_satang: 5000 })])[0]).toMatchObject({ status: 'partial', expected_satang: 15000, paid_satang: 5000 });
  });
  it('a shop that announced it is closed today is skipped; voided charges are ignored', () => {
    expect(run([], ['s2']).find(r => r.room_id === 's2')).toMatchObject({ status: 'closed', expected_satang: 0 });
    expect(run([charge({ dedupe_key: 'stall-week:s1:2026-10-05', status: 'void' })])[0].status).toBe('due');
  });
  it('totals count only stalls that trade', () => {
    const t = roundTotals(run([charge({ dedupe_key: 'stall-week:s1:2026-10-05', paid_satang: 20000, status: 'paid' })]));
    expect(t).toEqual({ stalls: 2, to_collect_satang: 5000, collected_satang: 20000, unpaid: 1 });
  });
});

describe('end of day', () => {
  it('sums cash and transfers by Thai calendar day, refunds negatively', () => {
    const p = (amount: number, method: 'cash' | 'transfer', at: string) => ({ amount_satang: amount, method, received_at: at });
    const t = dayTotals([
      p(10000, 'cash', '2026-10-08T01:00:00Z'), p(5000, 'transfer', '2026-10-08T10:00:00Z'), p(-2000, 'cash', '2026-10-08T12:00:00Z'),
      p(999, 'cash', '2026-10-08T17:30:00Z'), // 00:30 on the 9th in Thailand
      p(777, 'cash', '2026-10-07T16:59:00Z'), // 23:59 on the 7th
    ], '2026-10-08');
    expect(t).toEqual({ cash_satang: 8000, transfer_satang: 5000, count: 3 });
  });
  it('day close input', () => {
    expect(cleanDayCloseInput({ date: '2026-10-08', counted_cash: 80 }, NOW)).toEqual({ date: '2026-10-08', counted_cash_satang: 8000, note: null });
    for (const bad of [{ date: '2026-10-09' }, { date: 'x' }, { counted_cash: -1 }, { counted_cash: undefined }, { note: 'x'.repeat(301) }])
      expect(cleanDayCloseInput({ date: '2026-10-08', counted_cash: 80, ...bad }, NOW)).toBeNull();
  });
});