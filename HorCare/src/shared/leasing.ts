// Leasing module rules: leads → reservations → leases. Pure, shared by the API (the only writer) and the UI.
// Money is integer satang; dates are Thai calendar days ("YYYY-MM-DD").
import { addDays, daysBetween, digitsOnly, isValidDate, todayTh } from './market.js';
import { toSatang } from './accounting.js';

// ── Leads ───────────────────────────────────────────────────────────────────

export const LEAD_STATUSES = ['new', 'contacted', 'viewing', 'reserved', 'won', 'lost'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const LEAD_STATUS_LABELS_TH: Record<LeadStatus, string> = {
  new: 'ใหม่', contacted: 'ติดต่อแล้ว', viewing: 'นัดดูห้อง', reserved: 'จองแล้ว', won: 'ทำสัญญาแล้ว', lost: 'ไม่สำเร็จ',
};
export const LEAD_SOURCES = ['walk_in', 'phone', 'line', 'online', 'referral', 'other'] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];
export const LEAD_SOURCE_LABELS_TH: Record<LeadSource, string> = {
  walk_in: 'เดินเข้ามา', phone: 'โทรศัพท์', line: 'LINE', online: 'ออนไลน์', referral: 'คนแนะนำ', other: 'อื่นๆ',
};

/** Statuses a person may move a lead to by hand. "reserved" and "won" are set only by reserving / signing. */
const MANUAL_MOVES: Record<LeadStatus, LeadStatus[]> = {
  new: ['contacted', 'viewing', 'lost'],
  contacted: ['new', 'viewing', 'lost'],
  viewing: ['contacted', 'lost'],
  reserved: [],        // cancel the reservation first
  won: [],             // terminal
  lost: ['new'],       // a lost lead can be reopened
};
export const canMoveLead = (from: LeadStatus, to: LeadStatus) => MANUAL_MOVES[from]?.includes(to) ?? false;

export interface Lead {
  id: string; owner_uid: string; building_id: string; name: string; phone: string | null; line_id: string | null;
  source: LeadSource; interested_room_id: string | null; budget_satang: number | null; target_move_in: string | null;
  status: LeadStatus; lost_reason: string | null; note: string | null; created_by: string; created_at: string; updated_at: string;
}

export interface LeadInput {
  name: string; phone: string | null; line_id: string | null; source: LeadSource;
  interested_room_id: string | null; budget_satang: number | null; target_move_in: string | null; note: string | null;
}

const text = (v: unknown, max: number, min = 0): string | null | undefined => {
  if (v === undefined || v === null || v === '') return min > 0 ? undefined : null;
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t.length >= min && t.length <= max ? (t || (min > 0 ? undefined : null)) : undefined;
};

/** A Thai mobile/landline number, digits only, or null when empty; undefined when malformed. */
export function cleanPhone(v: unknown): string | null | undefined {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') return undefined;
  const d = digitsOnly(v);
  return /^0\d{8,9}$/.test(d) ? d : undefined;
}

/** Money typed in baht → satang; null when empty; undefined when invalid. */
export function cleanBaht(v: unknown, max = 100_000_000): number | null | undefined {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max) return undefined;
  return toSatang(v);
}

export function cleanLeadInput(raw: Record<string, unknown>, now: Date = new Date()): LeadInput | null {
  const name = text(raw.name, 100, 2);
  const phone = cleanPhone(raw.phone);
  const line_id = text(raw.line_id, 100);
  const room = text(raw.interested_room_id, 128);
  const note = text(raw.note, 1000);
  const budget = cleanBaht(raw.budget);
  if (!name || phone === undefined || line_id === undefined || room === undefined || note === undefined || budget === undefined) return null;
  const source = raw.source === undefined ? 'walk_in' : raw.source;
  if (typeof source !== 'string' || !(LEAD_SOURCES as readonly string[]).includes(source)) return null;
  let target: string | null = null;
  const wanted = raw.target_move_in;
  if (wanted !== undefined && wanted !== null && wanted !== '') {
    if (!isValidDate(wanted) || wanted < addDays(todayTh(now), -1) || wanted > addDays(todayTh(now), 730)) return null;
    target = wanted;
  }
  if (!phone && !line_id) return null; // a lead nobody can reach is not a lead
  return { name, phone, line_id, source: source as LeadSource, interested_room_id: room, budget_satang: budget, target_move_in: target, note };
}

// ── Reservations ────────────────────────────────────────────────────────────

export const RESERVATION_STATUSES = ['active', 'converted', 'cancelled', 'expired'] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];
export const RESERVATION_STATUS_LABELS_TH: Record<ReservationStatus, string> = {
  active: 'กำลังจอง', converted: 'ทำสัญญาแล้ว', cancelled: 'ยกเลิก', expired: 'หมดเวลาจอง',
};
export const MAX_RESERVATION_DAYS = 60;

export interface Reservation {
  id: string; owner_uid: string; building_id: string; lead_id: string; room_id: string; room_number: string;
  deposit_satang: number; reserved_until: string; status: ReservationStatus; cancel_reason: string | null;
  created_by: string; created_at: string; updated_at: string;
}

export interface ReservationInput { lead_id: string; room_id: string; deposit_satang: number; reserved_until: string }

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function cleanReservationInput(raw: Record<string, unknown>, now: Date = new Date()): ReservationInput | null {
  if (typeof raw.lead_id !== 'string' || !UUID_RE.test(raw.lead_id)) return null;
  const room = text(raw.room_id, 128, 1);
  const deposit = cleanBaht(raw.deposit ?? 0, 10_000_000);
  if (!room || deposit === undefined || deposit === null) return null;
  const today = todayTh(now);
  const until = raw.reserved_until;
  if (!isValidDate(until) || until < today || until > addDays(today, MAX_RESERVATION_DAYS)) return null;
  return { lead_id: raw.lead_id, room_id: room, deposit_satang: deposit, reserved_until: until };
}

/** A reservation past its date that nobody converted. */
export const isReservationLapsed = (r: Pick<Reservation, 'status' | 'reserved_until'>, today: string) => r.status === 'active' && r.reserved_until < today;

// ── Leases ──────────────────────────────────────────────────────────────────

export const LEASE_STATUSES = ['scheduled', 'active', 'ended', 'terminated'] as const;
export type LeaseStatus = (typeof LEASE_STATUSES)[number];
export const LEASE_STATUS_LABELS_TH: Record<LeaseStatus, string> = {
  scheduled: 'รอเริ่มสัญญา', active: 'กำลังเช่า', ended: 'สิ้นสุดตามสัญญา', terminated: 'เลิกสัญญาก่อนกำหนด',
};
export const MAX_LEASE_DAYS = 365 * 5;
export const EXPIRING_SOON_DAYS = 60;

export interface Lease {
  id: string; owner_uid: string; building_id: string; room_id: string; room_number: string; tenant_name: string; tenant_phone: string | null;
  lead_id: string | null; reservation_id: string | null; renewal_of: string | null; start_date: string; end_date: string;
  rent_satang: number; deposit_satang: number; status: LeaseStatus; ended_on: string | null; end_reason: string | null; note: string | null;
  created_by: string; created_at: string; updated_at: string;
}

export interface LeaseTerms { tenant_name: string; tenant_phone: string | null; start_date: string; end_date: string; rent_satang: number; deposit_satang: number }

export function cleanLeaseTerms(raw: Record<string, unknown>): LeaseTerms | null {
  const name = text(raw.tenant_name, 100, 2);
  const phone = cleanPhone(raw.tenant_phone);
  const rent = cleanBaht(raw.rent, 10_000_000);
  const deposit = cleanBaht(raw.deposit ?? 0, 10_000_000);
  if (!name || phone === undefined || rent === undefined || rent === null || deposit === undefined || deposit === null) return null;
  const start = raw.start_date;
  const end = raw.end_date;
  if (!isValidDate(start) || !isValidDate(end) || end <= start) return null;
  if (daysBetween(start, end) > MAX_LEASE_DAYS) return null;
  return { tenant_name: name, tenant_phone: phone, start_date: start, end_date: end, rent_satang: rent, deposit_satang: deposit };
}

/** Terms for renewing a lease: starts the day after it ends, runs as long as the old one, same rent. */
export function renewalDefaults(l: Pick<Lease, 'start_date' | 'end_date' | 'rent_satang' | 'deposit_satang' | 'tenant_name' | 'tenant_phone'>): LeaseTerms {
  const length = daysBetween(l.start_date, l.end_date);
  const start = addDays(l.end_date, 1);
  return { tenant_name: l.tenant_name, tenant_phone: l.tenant_phone, start_date: start, end_date: addDays(start, length), rent_satang: l.rent_satang, deposit_satang: 0 };
}

export type LeaseAlert = 'expired' | 'expiring' | null;

/** Active leases past their end date, or ending within `days`. */
export function leaseAlert(l: Pick<Lease, 'status' | 'end_date'>, today: string, days = EXPIRING_SOON_DAYS): LeaseAlert {
  if (l.status !== 'active') return null;
  if (l.end_date < today) return 'expired';
  return daysBetween(today, l.end_date) <= days ? 'expiring' : null;
}

export function expiringLeases<T extends Pick<Lease, 'status' | 'end_date'>>(list: T[], today: string, days = EXPIRING_SOON_DAYS): T[] {
  return list.filter(l => leaseAlert(l, today, days) !== null).sort((a, b) => a.end_date.localeCompare(b.end_date));
}

/** Deposits currently held under active leases. */
export const depositsHeld = (list: Pick<Lease, 'status' | 'deposit_satang'>[]) =>
  list.filter(l => l.status === 'active' || l.status === 'scheduled').reduce((s, l) => s + l.deposit_satang, 0);

export interface EndInput { ended_on: string; reason: string | null; terminated: boolean }

export function cleanEndInput(raw: Record<string, unknown>, lease: Pick<Lease, 'start_date'>, now: Date = new Date()): EndInput | null {
  const endedOn = raw.ended_on;
  if (!isValidDate(endedOn) || endedOn < lease.start_date || endedOn > addDays(todayTh(now), 31)) return null;
  const terminated = raw.terminated === true;
  const reason = text(raw.reason, 300, terminated ? 3 : 0);
  if (reason === undefined) return null; // an early termination must say why
  return { ended_on: endedOn, reason, terminated };
}
