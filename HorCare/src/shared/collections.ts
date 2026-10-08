// Daily / weekly collection for resorts, hotels and markets.
// Pure rules shared by the API (the only writer) and the screens. Money is integer satang; dates are Thai
// calendar days ("YYYY-MM-DD"); a stay's check-out day is exclusive (a guest leaving on the 12th does not pay for the 12th).
import { addDays, daysBetween, digitsOnly, isValidDate, todayTh } from './market.js';
import { cleanBaht, cleanPhone, UUID_RE } from './leasing.js';
import { thDate } from './accounting.js';

// ── Rates ───────────────────────────────────────────────────────────────────

export const RATE_PURPOSES = ['stay', 'stall', 'walk_in'] as const;
export type RatePurpose = (typeof RATE_PURPOSES)[number];
export const RATE_PURPOSE_LABELS_TH: Record<RatePurpose, string> = { stay: 'ค่าห้องพัก', stall: 'ค่าแผงประจำ', walk_in: 'ค่าที่ขาจร' };
export const RATE_UNITS = ['night', 'day', 'week'] as const;
export type RateUnit = (typeof RATE_UNITS)[number];
export const RATE_UNIT_LABELS_TH: Record<RateUnit, string> = { night: 'ต่อคืน', day: 'ต่อวัน', week: 'ต่อสัปดาห์' };
export const RATE_SCOPES = ['all', 'zone', 'room'] as const;
export type RateScope = (typeof RATE_SCOPES)[number];

export interface Rate {
  id: string; name: string; purpose: RatePurpose; unit: RateUnit; amount_satang: number;
  scope: RateScope; zone: string | null; room_id: string | null;
  /** Inclusive validity window (e.g. a holiday season); null = always. */
  valid_from: string | null; valid_to: string | null;
  priority: number; active: boolean;
}

export interface RateQuery { purpose: RatePurpose; unit: RateUnit; roomId?: string | null; zone?: string | null; date: string }

const SCOPE_RANK: Record<RateScope, number> = { all: 1, zone: 2, room: 3 };

/**
 * The rate that applies on a date: a rate for the room beats one for its zone beats one for everything; among equals a
 * dated (seasonal) rate beats an always-on one, then the higher priority wins. Null when nothing applies.
 */
export function resolveRate(rates: Rate[], q: RateQuery): Rate | null {
  const fits = rates.filter(r => {
    if (!r.active || r.purpose !== q.purpose || r.unit !== q.unit) return false;
    if (r.valid_from && q.date < r.valid_from) return false;
    if (r.valid_to && q.date > r.valid_to) return false;
    if (r.scope === 'room') return !!q.roomId && r.room_id === q.roomId;
    if (r.scope === 'zone') return !!q.zone && r.zone === q.zone;
    return true;
  });
  fits.sort((a, b) =>
    SCOPE_RANK[b.scope] - SCOPE_RANK[a.scope]
    || Number(!!(b.valid_from || b.valid_to)) - Number(!!(a.valid_from || a.valid_to))
    || b.priority - a.priority
    || a.id.localeCompare(b.id));
  return fits[0] ?? null;
}

export interface RateInput {
  name: string; purpose: RatePurpose; unit: RateUnit; amount_satang: number; scope: RateScope;
  zone: string | null; room_id: string | null; valid_from: string | null; valid_to: string | null; priority: number; active: boolean;
}

const txt = (v: unknown, max: number, min = 0): string | null | undefined => {
  if (v === undefined || v === null || v === '') return min > 0 ? undefined : null;
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t.length >= min && t.length <= max ? (t || (min > 0 ? undefined : null)) : undefined;
};

const optDate = (v: unknown): string | null | undefined => (v === undefined || v === null || v === '' ? null : isValidDate(v) ? v : undefined);

export function cleanRateInput(raw: Record<string, unknown>): RateInput | null {
  const name = txt(raw.name, 80, 2);
  const amount = cleanBaht(raw.amount, 10_000_000);
  const from = optDate(raw.valid_from), to = optDate(raw.valid_to);
  if (!name || amount === undefined || amount === null || from === undefined || to === undefined) return null;
  if (!(RATE_PURPOSES as readonly string[]).includes(raw.purpose as string) || !(RATE_UNITS as readonly string[]).includes(raw.unit as string)) return null;
  const scope = raw.scope === undefined ? 'all' : raw.scope;
  if (!(RATE_SCOPES as readonly string[]).includes(scope as string)) return null;
  const zone = txt(raw.zone, 60), room = txt(raw.room_id, 128);
  if (zone === undefined || room === undefined) return null;
  if ((scope === 'zone' && !zone) || (scope === 'room' && !room)) return null;
  if (from && to && to < from) return null;
  const priority = raw.priority === undefined ? 0 : raw.priority;
  if (typeof priority !== 'number' || !Number.isInteger(priority) || priority < -100 || priority > 100) return null;
  if (raw.active !== undefined && typeof raw.active !== 'boolean') return null;
  // a "stay" is always per night; stalls/walk-ins are per day or week
  if ((raw.purpose === 'stay') !== (raw.unit === 'night')) return null;
  return {
    name, purpose: raw.purpose as RatePurpose, unit: raw.unit as RateUnit, amount_satang: amount, scope: scope as RateScope,
    zone: scope === 'zone' ? zone : null, room_id: scope === 'room' ? room : null, valid_from: from, valid_to: to, priority, active: raw.active !== false,
  };
}

// ── Stays (hotel / resort) ──────────────────────────────────────────────────

export const MAX_STAY_NIGHTS = 60;

/** The nights of a stay: check-in day up to the day before check-out. */
export function stayNights(checkIn: string, checkOut: string): string[] {
  const n = daysBetween(checkIn, checkOut);
  return n > 0 ? Array.from({ length: n }, (_, i) => addDays(checkIn, i)) : [];
}

export interface StayQuote { nights: { date: string; rate_id: string; amount_satang: number }[]; total_satang: number; missing: string[] }

/** Price a stay night by night (seasonal rates apply per night). Nights with no rate are listed in `missing`. */
export function quoteStay(rates: Rate[], q: { roomId: string; zone?: string | null; checkIn: string; checkOut: string }): StayQuote {
  const nights: StayQuote['nights'] = [];
  const missing: string[] = [];
  for (const date of stayNights(q.checkIn, q.checkOut)) {
    const r = resolveRate(rates, { purpose: 'stay', unit: 'night', roomId: q.roomId, zone: q.zone, date });
    if (r) nights.push({ date, rate_id: r.id, amount_satang: r.amount_satang }); else missing.push(date);
  }
  return { nights, total_satang: nights.reduce((s, n) => s + n.amount_satang, 0), missing };
}

export const BOOKING_STATUSES = ['reserved', 'checked_in', 'checked_out', 'cancelled', 'no_show'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
export const BOOKING_STATUS_LABELS_TH: Record<BookingStatus, string> = {
  reserved: 'จองแล้ว', checked_in: 'เข้าพักอยู่', checked_out: 'เช็กเอาต์แล้ว', cancelled: 'ยกเลิก', no_show: 'ไม่มาเข้าพัก',
};
/** Statuses that hold the room (and are protected against double booking). */
export const HOLDING_STATUSES: BookingStatus[] = ['reserved', 'checked_in'];

export interface Booking {
  id: string; room_id: string; room_number: string; guest_name: string; guest_phone: string | null; adults: number;
  check_in: string; check_out: string; status: BookingStatus; charge_id: string | null; source: string; notes: string | null;
  created_by: string; created_at: string; updated_at: string;
}

export interface BookingInput {
  room_id: string; guest_name: string; guest_phone: string | null; adults: number; check_in: string; check_out: string;
  notes: string | null; deposit_satang: number;
}

export function cleanBookingInput(raw: Record<string, unknown>, now: Date = new Date()): BookingInput | null {
  const room = txt(raw.room_id, 128, 1);
  const guest = txt(raw.guest_name, 100, 2);
  const phone = cleanPhone(raw.guest_phone);
  const notes = txt(raw.notes, 500);
  const deposit = cleanBaht(raw.deposit ?? 0, 10_000_000);
  const adults = raw.adults === undefined ? 1 : raw.adults;
  if (!room || !guest || phone === undefined || notes === undefined || deposit === undefined || deposit === null) return null;
  if (typeof adults !== 'number' || !Number.isInteger(adults) || adults < 1 || adults > 20) return null;
  const inDate = raw.check_in, outDate = raw.check_out;
  if (!isValidDate(inDate) || !isValidDate(outDate) || inDate < todayTh(now) || outDate <= inDate) return null;
  if (daysBetween(inDate, outDate) > MAX_STAY_NIGHTS) return null;
  return { room_id: room, guest_name: guest, guest_phone: phone, adults, check_in: inDate, check_out: outDate, notes, deposit_satang: deposit };
}

/** Do two stays on the same room collide? (check-out day is free for the next guest.) */
export const staysOverlap = (a: { check_in: string; check_out: string }, b: { check_in: string; check_out: string }) => a.check_in < b.check_out && b.check_in < a.check_out;

/** Share of rooms sleeping a guest on a night. */
export function occupancyOn(bookings: Pick<Booking, 'status' | 'check_in' | 'check_out'>[], roomCount: number, date: string): number {
  if (roomCount <= 0) return 0;
  const n = bookings.filter(b => b.status !== 'cancelled' && b.status !== 'no_show' && b.check_in <= date && date < b.check_out).length;
  return Math.min(1, n / roomCount);
}

export type BookingAction = 'check_in' | 'check_out' | 'cancel';

/** Why an action is not allowed on a booking right now (null = allowed). */
export function bookingActionBlock(b: Pick<Booking, 'status' | 'check_in' | 'check_out'>, action: BookingAction, today: string, outstanding_satang: number): string | null {
  if (action === 'check_in') {
    if (b.status !== 'reserved') return 'not_reserved';
    if (today < b.check_in) return 'too_early';
    if (today >= b.check_out) return 'stay_already_over';
    return null;
  }
  if (action === 'check_out') {
    if (b.status !== 'checked_in') return 'not_checked_in';
    return outstanding_satang > 0 ? 'unpaid_balance' : null;
  }
  return b.status === 'reserved' || b.status === 'checked_in' ? null : 'cannot_cancel';
}

// ── Markets: stall plans, weeks and rounds ──────────────────────────────────

export const COLLECTION_MODES = ['weekly_advance', 'daily_actual'] as const;
export type CollectionMode = (typeof COLLECTION_MODES)[number];
export const COLLECTION_MODE_LABELS_TH: Record<CollectionMode, string> = { weekly_advance: 'ล่วงหน้ารายสัปดาห์', daily_actual: 'รายวันตามจริง (เมื่อร้านมา)' };

export interface StallPlan {
  id: string; room_id: string; room_number: string; mode: CollectionMode;
  /** Per open day or per week. Null = use the market's resolved rate for the stall. */
  unit: 'day' | 'week'; rate_satang: number | null;
  /** Days of the week the market is open, 0 = Sunday … 6 = Saturday. */
  open_days: number[]; starts_on: string; ends_on: string | null; status: 'active' | 'ended';
}

export interface PlanInput { room_id: string; mode: CollectionMode; unit: 'day' | 'week'; rate_satang: number | null; open_days: number[]; starts_on: string; ends_on: string | null }

export function cleanPlanInput(raw: Record<string, unknown>): PlanInput | null {
  const room = txt(raw.room_id, 128, 1);
  const rate = cleanBaht(raw.rate, 1_000_000);
  const ends = optDate(raw.ends_on);
  if (!room || rate === undefined || ends === undefined) return null;
  if (!(COLLECTION_MODES as readonly string[]).includes(raw.mode as string)) return null;
  if (raw.unit !== 'day' && raw.unit !== 'week') return null;
  if (raw.mode === 'daily_actual' && raw.unit !== 'day') return null; // paying per visit only makes sense per day
  if (!isValidDate(raw.starts_on) || (ends && ends < raw.starts_on)) return null;
  const days = raw.open_days;
  if (!Array.isArray(days) || days.length === 0 || days.length > 7 || days.some(d => !Number.isInteger(d) || d < 0 || d > 6)) return null;
  return { room_id: room, mode: raw.mode as CollectionMode, unit: raw.unit, rate_satang: rate, open_days: [...new Set(days as number[])].sort(), starts_on: raw.starts_on, ends_on: ends };
}

export const dayOfWeek = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
/** Monday of the week containing a date (market weeks run Monday–Sunday). */
export function weekStart(date: string): string { const d = dayOfWeek(date); return addDays(date, d === 0 ? -6 : 1 - d); }
export const weekDates = (start: string) => Array.from({ length: 7 }, (_, i) => addDays(start, i));

/** Is the stall due to trade on this date under its plan (in range, an open day)? Closures are checked separately. */
export function planOpenOn(p: Pick<StallPlan, 'open_days' | 'starts_on' | 'ends_on' | 'status'>, date: string): boolean {
  return p.status === 'active' && date >= p.starts_on && (!p.ends_on || date <= p.ends_on) && p.open_days.includes(dayOfWeek(date));
}

export interface WeekCharge { dates: string[]; days: number; amount_satang: number }

/** What a weekly-advance stall owes for one week: its open days not covered by a shop closure. */
export function stallWeekCharge(plan: StallPlan, weekStartDate: string, closedDates: Set<string>, fallbackDayRate: number | null, fallbackWeekRate: number | null): WeekCharge {
  const dates = weekDates(weekStartDate).filter(d => planOpenOn(plan, d) && !closedDates.has(d));
  const dayRate = plan.unit === 'day' ? (plan.rate_satang ?? fallbackDayRate) : null;
  const weekRate = plan.unit === 'week' ? (plan.rate_satang ?? fallbackWeekRate) : null;
  const amount = dates.length === 0 ? 0 : plan.unit === 'day' ? (dayRate ?? 0) * dates.length : (weekRate ?? 0);
  return { dates, days: dates.length, amount_satang: amount };
}

// ── Charges and payments ────────────────────────────────────────────────────

export const CHARGE_KINDS = ['stay', 'stall_week', 'stall_day', 'walk_in', 'extra'] as const;
export type ChargeKind = (typeof CHARGE_KINDS)[number];
export const CHARGE_KIND_LABELS_TH: Record<ChargeKind, string> = { stay: 'ค่าห้องพัก', stall_week: 'ค่าแผงรายสัปดาห์', stall_day: 'ค่าแผงรายวัน', walk_in: 'ค่าที่ขาจร', extra: 'ค่าบริการเพิ่มเติม' };

export interface Charge {
  id: string; kind: ChargeKind; room_id: string | null; room_number: string | null; party_name: string; party_phone: string | null;
  booking_id: string | null; period_start: string; period_end: string; description: string; amount_satang: number; paid_satang: number;
  status: 'open' | 'paid' | 'void'; dedupe_key: string; created_by: string; created_at: string;
}

export const outstanding = (c: Pick<Charge, 'amount_satang' | 'paid_satang' | 'status'>) => (c.status === 'void' ? 0 : Math.max(0, c.amount_satang - c.paid_satang));
export const chargeStatusFor = (amount: number, paid: number): 'open' | 'paid' => (paid >= amount && amount > 0 ? 'paid' : 'open');

export const PAYMENT_METHODS = ['cash', 'transfer'] as const;
export type CollectMethod = (typeof PAYMENT_METHODS)[number];
export const COLLECT_METHOD_LABELS_TH: Record<CollectMethod, string> = { cash: 'เงินสด', transfer: 'โอน' };

export interface ChargePayment {
  id: string; charge_id: string; amount_satang: number; method: CollectMethod; kind: 'payment' | 'deposit' | 'refund';
  bank_account_id: string | null; note: string | null; received_by: string; received_by_name: string; received_at: string;
}

export interface PaymentInput { amount_satang: number; method: CollectMethod; bank_account_id: string | null; note: string | null }

export function cleanPaymentInput(raw: Record<string, unknown>): PaymentInput | null {
  const amount = cleanBaht(raw.amount, 10_000_000);
  const note = txt(raw.note, 200);
  const bank = txt(raw.bank_account_id, 128);
  if (amount === undefined || amount === null || amount <= 0 || note === undefined || bank === undefined) return null;
  if (!(PAYMENT_METHODS as readonly string[]).includes(raw.method as string)) return null;
  if (raw.method === 'transfer' && !bank) return null; // a transfer must say which account received it
  return { amount_satang: amount, method: raw.method as CollectMethod, bank_account_id: raw.method === 'transfer' ? bank : null, note };
}

// ── The collector's round ───────────────────────────────────────────────────

export type RoundStatus = 'due' | 'partial' | 'paid' | 'closed' | 'absent' | 'not_trading';

export interface RoundRow {
  room_id: string; room_number: string; mode: CollectionMode | null;
  /** What this visit would collect (outstanding of the live charge, or today's day rate). */
  expected_satang: number; paid_satang: number; status: RoundStatus; charge: Charge | null;
}

/**
 * One line per stall for a given day. A weekly-advance stall shows its week's charge (paid for the whole week after one
 * payment); a daily-actual stall shows today's day rate until the collector marks it. Stalls closed today by their own
 * notice, or not open that weekday, are not asked for money.
 */
export function buildRound(input: {
  date: string;
  plans: StallPlan[];
  charges: Charge[];
  closedToday: Set<string>;
  /** Stalls the collector marked as not having turned up today (daily-actual stalls pay only when they trade). */
  absentToday?: Set<string>;
  rooms: { id: string; room_number: string }[];
  dayRateOf: (roomId: string) => number | null;
  weekRateOf: (roomId: string) => number | null;
}): RoundRow[] {
  const { date } = input;
  const wk = weekStart(date);
  const rows: RoundRow[] = [];
  for (const room of input.rooms) {
    const plan = input.plans.find(p => p.room_id === room.id && p.status === 'active');
    const base = { room_id: room.id, room_number: room.room_number, mode: plan?.mode ?? null };
    if (!plan || !planOpenOn(plan, date)) { rows.push({ ...base, expected_satang: 0, paid_satang: 0, status: 'not_trading', charge: null }); continue; }
    if (input.closedToday.has(room.id)) { rows.push({ ...base, expected_satang: 0, paid_satang: 0, status: 'closed', charge: null }); continue; }

    const absent = input.absentToday ?? new Set<string>();
    const key = plan.mode === 'weekly_advance' ? `stall-week:${room.id}:${wk}` : `stall-day:${room.id}:${date}`;
    const charge = input.charges.find(c => c.dedupe_key === key && c.status !== 'void') ?? null;
    if (charge) {
      const out = outstanding(charge);
      rows.push({ ...base, expected_satang: out, paid_satang: charge.paid_satang, status: out === 0 ? 'paid' : charge.paid_satang > 0 ? 'partial' : 'due', charge });
    } else if (plan.mode === 'daily_actual' && absent.has(room.id)) {
      rows.push({ ...base, expected_satang: 0, paid_satang: 0, status: 'absent', charge: null });
    } else {
      // not generated yet: weekly plans get their charge from the weekly run, daily plans when the stall is marked
      const amount = plan.mode === 'daily_actual' ? (plan.rate_satang ?? input.dayRateOf(room.id) ?? 0) : stallWeekCharge(plan, wk, new Set(), input.dayRateOf(room.id), input.weekRateOf(room.id)).amount_satang;
      rows.push({ ...base, expected_satang: amount, paid_satang: 0, status: 'due', charge: null });
    }
  }
  return rows.sort((a, b) => a.room_number.localeCompare(b.room_number, 'th', { numeric: true }));
}

export function roundTotals(rows: RoundRow[]) {
  const live = rows.filter(r => r.status === 'due' || r.status === 'partial' || r.status === 'paid');
  return {
    stalls: live.length,
    to_collect_satang: rows.reduce((s, r) => s + (r.status === 'due' || r.status === 'partial' ? r.expected_satang : 0), 0),
    collected_satang: rows.reduce((s, r) => s + r.paid_satang, 0),
    unpaid: rows.filter(r => r.status === 'due' || r.status === 'partial').length,
  };
}

// ── End of day ──────────────────────────────────────────────────────────────

export interface DayTotals { cash_satang: number; transfer_satang: number; count: number }

/** Money received on a Thai calendar day (refunds count negatively). */
export function dayTotals(payments: Pick<ChargePayment, 'amount_satang' | 'method' | 'received_at'>[], date: string): DayTotals {
  const t: DayTotals = { cash_satang: 0, transfer_satang: 0, count: 0 };
  for (const p of payments) {
    if (thDate(p.received_at) !== date) continue;
    if (p.method === 'cash') t.cash_satang += p.amount_satang; else t.transfer_satang += p.amount_satang;
    t.count++;
  }
  return t;
}

export interface DayCloseInput { date: string; counted_cash_satang: number; note: string | null }

export function cleanDayCloseInput(raw: Record<string, unknown>, now: Date = new Date()): DayCloseInput | null {
  const counted = cleanBaht(raw.counted_cash, 100_000_000);
  const note = txt(raw.note, 300);
  if (counted === undefined || counted === null || note === undefined || !isValidDate(raw.date) || raw.date > todayTh(now)) return null;
  return { date: raw.date, counted_cash_satang: counted, note };
}

export { UUID_RE, digitsOnly };
