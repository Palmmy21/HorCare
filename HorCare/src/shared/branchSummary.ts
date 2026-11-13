// หน้าเลือกสาขา (Branch Selector v2): the figures each branch card shows, and the rules behind them.
// Pure and dependency-free, so the API (api/_branch-summary.ts) and the page share one definition.
// Dates are Thai calendar days ("YYYY-MM-DD"), months "YYYY-MM".

import { dueDateOf, chargeableLateDays } from './lateFee.js';

/** The four looks a branch card can take; every building_type maps onto one. */
export type BranchKind = 'dorm' | 'condo' | 'market' | 'resort';

export function branchKind(buildingType: string | null | undefined): BranchKind {
  switch (buildingType) {
    case 'condo': return 'condo';
    case 'market': return 'market';
    case 'resort':
    case 'hotel': return 'resort';
    default: return 'dorm'; // dormitory, apartment, house, commercial, office, other
  }
}

export interface BranchSummary {
  id: string;
  /** Units counted for the headline figure (rooms or stalls). */
  unitsTotal: number;
  /** Occupied / leased units — for a resort, rooms booked for tonight. */
  unitsOccupied: number;
  /** Saved bills past their due date (+ grace days) and still unpaid. */
  overdueInvoices: number;
  /** Repair requests still open or in progress. */
  openRepairs: number;
  /** This calendar month, baht. null when the caller may not see money. */
  revenueCollected: number | null;
  revenueExpected: number | null;
  /** When this user last opened the branch (ISO), or null if never. */
  lastAccessedAt: string | null;
}

export interface BranchSummaryResponse {
  branches: BranchSummary[];
  /** False when the caller lacks finance.read: revenue is null on every branch. */
  canSeeFinance: boolean;
  generatedAt: string;
}

// ── counting ─────────────────────────────────────────────────────────────────

export interface BillFacts {
  month?: string;
  is_saved?: boolean;
  payment_status?: string;
  total_bill?: number;
}

/**
 * A bill is overdue when it was issued (saved), is not paid and the tenant has not sent a slip for it (`pending` is
 * waiting on the owner, not the tenant), and today is past its due date plus the grace days of the late-fee setting.
 */
export function isOverdueBill(b: BillFacts, dueDay: number, graceDays: number, today: string): boolean {
  if (!b.is_saved || !b.month) return false;
  if ((b.payment_status ?? 'unpaid') !== 'unpaid') return false;
  return chargeableLateDays(dueDateOf(b.month, dueDay), today, Math.max(0, graceDays || 0)) > 0;
}

/** Collected vs expected for one month, the same sum the dashboard's money panel makes. */
export function monthRevenue(bills: BillFacts[], month: string): { collected: number; expected: number } {
  let collected = 0, expected = 0;
  for (const b of bills) {
    if (!b.is_saved || b.month !== month) continue;
    const amount = Number(b.total_bill) || 0;
    expected += amount;
    if (b.payment_status === 'paid') collected += amount;
  }
  return { collected, expected };
}

export const OPEN_REPAIR_STATUSES = ['open', 'in_progress'] as const;

export interface BookingFacts { room_id: string; status: string; check_in: string; check_out: string }

/** Distinct rooms with a live booking covering tonight. */
export function roomsBookedTonight(bookings: BookingFacts[], today: string): number {
  const rooms = new Set<string>();
  for (const b of bookings) {
    if (b.status === 'cancelled' || b.status === 'no_show') continue;
    if (b.check_in <= today && today < b.check_out) rooms.add(b.room_id);
  }
  return rooms.size;
}

// ── page totals ──────────────────────────────────────────────────────────────

export interface BranchTotals {
  revenueCollected: number | null;
  revenueExpected: number | null;
  /** Average occupancy weighted by units, 0–100, or null when no branch has units. */
  occupancyPct: number | null;
  pending: number;
}

export function branchTotals(list: BranchSummary[], canSeeFinance: boolean): BranchTotals {
  let collected = 0, expected = 0, units = 0, occupied = 0, pending = 0;
  for (const b of list) {
    collected += b.revenueCollected ?? 0;
    expected += b.revenueExpected ?? 0;
    units += b.unitsTotal;
    occupied += Math.min(b.unitsOccupied, b.unitsTotal);
    pending += b.overdueInvoices + b.openRepairs;
  }
  return {
    revenueCollected: canSeeFinance ? collected : null,
    revenueExpected: canSeeFinance ? expected : null,
    occupancyPct: units > 0 ? Math.round((occupied / units) * 100) : null,
    pending,
  };
}

export function occupancyPct(occupied: number, total: number): number {
  return total > 0 ? Math.round((Math.min(occupied, total) / total) * 100) : 0;
}

// ── ordering & identity ──────────────────────────────────────────────────────

/** FR-07: most recently opened first; never-opened branches after, by name. */
export function sortBranches<T extends { id: string; name: string }>(list: T[], lastAccess: Record<string, string | null | undefined>): T[] {
  return [...list].sort((a, b) => {
    const ta = lastAccess[a.id] ?? '', tb = lastAccess[b.id] ?? '';
    if (ta && tb) return tb.localeCompare(ta);
    if (ta) return -1;
    if (tb) return 1;
    return a.name.localeCompare(b.name, 'th', { numeric: true });
  });
}

/**
 * FR-04: 1–2 letters standing in for a missing logo. Two words → both initials ("ONE9 LIFE" → "OL");
 * one word with digits keeps its first letter and first digit ("ONE9" → "O9"); otherwise the first letter.
 * Thai leading vowels (เ แ โ ใ ไ) are skipped so "เรือนไทย" gives "ร".
 */
export function branchInitials(name: string): string {
  const firstChar = (w: string) => {
    const chars = [...w.replace(/^[เ-ไ]+/, '')];
    return chars.find(c => /[\p{L}\p{N}]/u.test(c)) ?? '';
  };
  const words = name.trim().split(/\s+/).filter(w => firstChar(w));
  if (words.length === 0) return '?';
  if (words.length === 1) {
    const w = words[0];
    const first = firstChar(w);
    const digit = w.slice(1).match(/\p{N}/u)?.[0];
    return (first + (digit ?? '')).toUpperCase();
  }
  return (firstChar(words[0]) + firstChar(words[1])).toUpperCase();
}

// ── wording ──────────────────────────────────────────────────────────────────

/** FR-06: greeting by the hour (Thai time). */
export function greeting(hour: number): string {
  if (hour >= 5 && hour < 12) return 'สวัสดีตอนเช้า';
  if (hour >= 12 && hour < 18) return 'สวัสดีตอนบ่าย';
  return 'สวัสดีตอนเย็น';
}

const TH_DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

/** "ศุกร์ที่ 13 พฤศจิกายน 2569" for a "YYYY-MM-DD" day. */
export function thaiLongDate(isoDay: string): string {
  const [y, m, d] = isoDay.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${TH_DAYS[dow]}ที่ ${d} ${TH_MONTHS[m - 1]} ${y + 543}`;
}

/** FR-03: "เข้าล่าสุด 2 ชม.ที่แล้ว" / "ยังไม่เคยเข้า". */
export function lastAccessLabel(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return 'ยังไม่เคยเข้า';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'ยังไม่เคยเข้า';
  const min = Math.max(0, Math.floor((now.getTime() - t) / 60_000));
  if (min < 1) return 'เข้าล่าสุดเมื่อสักครู่';
  if (min < 60) return `เข้าล่าสุด ${min} นาทีที่แล้ว`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `เข้าล่าสุด ${hr} ชม.ที่แล้ว`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `เข้าล่าสุด ${day} วันที่แล้ว`;
  const thDay = new Date(t + 7 * 3600_000).toISOString().slice(0, 10);
  const [y, m, d] = thDay.split('-').map(Number);
  return `เข้าล่าสุด ${d} ${TH_MONTHS[m - 1].slice(0, 3)}. ${String(y + 543).slice(2)}`;
}

/** FR-01 wording for the headline figure. */
export function headline(kind: BranchKind, occupied: number, total: number): { label: string; value: string; showPct: boolean } {
  const unit = kind === 'market' ? 'แผง' : 'ห้อง';
  const value = `${occupied.toLocaleString('th-TH')}/${total.toLocaleString('th-TH')} ${unit}`;
  switch (kind) {
    case 'condo': return { label: 'ใช้งาน', value, showPct: true };
    case 'market': return { label: 'เช่าแล้ว', value, showPct: true };
    case 'resort': return { label: 'คืนนี้', value, showPct: false };
    default: return { label: 'เข้าพัก', value, showPct: true };
  }
}
