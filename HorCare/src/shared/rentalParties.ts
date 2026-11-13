// Who else stands behind a room besides the property and its tenant. Pure; shared by the API (the only writer) and the UI.
//
//   • Sublease (เช่าช่วง): the tenant on the lease (A) lets the room to someone else (B). The property still bills and
//     deals with A; B is recorded under A's lease so everyone knows who actually lives there, and B's term must sit
//     inside A's.
//   • Unit owner (ซื้อแล้วปล่อยเช่า): someone bought the room and has the property let it for them. The property bills
//     the tenant as usual, keeps a management fee, and pays the owner the rest of the rent it collected each month.
//
// Money: subleases and owners' fees are typed in baht and kept as satang (leasing's convention); a statement is worked
// from the property's bills, which are in baht.
import { daysBetween, digitsOnly, isValidDate } from './market.js';
import { toSatang } from './accounting.js';

const text = (v: unknown, max: number, min = 0): string | null | undefined => {
  if (v === undefined || v === null || v === '') return min > 0 ? undefined : null;
  if (typeof v !== 'string') return undefined;
  const t = v.trim().replace(/\s+/g, ' ');
  if (t.length < min || t.length > max) return undefined;
  return t || null;
};
const phoneOf = (v: unknown): string | null | undefined => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') return undefined;
  const d = digitsOnly(v);
  return /^0\d{8,9}$/.test(d) ? d : undefined;
};
const bahtOf = (v: unknown, max: number): number | null | undefined => {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > max) return undefined;
  return toSatang(n);
};

// ── Subleases ────────────────────────────────────────────────────────────────

export interface Sublease {
  id: string;
  lease_id: string;
  room_id: string;
  room_number: string;
  /** the lease holder who lets the room on */
  master_tenant: string;
  tenant_name: string;
  tenant_phone: string | null;
  start_date: string;
  end_date: string;
  /** what A charges B a month, as A told us; information only — the property keeps billing A */
  rent_satang: number | null;
  status: 'active' | 'ended';
  ended_on: string | null;
  note: string | null;
  created_at: string;
  created_by: string;
}

export interface SubleaseInput { tenant_name: string; tenant_phone: string | null; start_date: string; end_date: string; rent_satang: number | null; note: string | null }

export function cleanSubleaseInput(raw: Record<string, unknown>): SubleaseInput | null {
  const name = text(raw.tenant_name, 100, 2);
  const phone = phoneOf(raw.tenant_phone);
  const rent = bahtOf(raw.rent, 10_000_000);
  const note = text(raw.note, 500);
  const start = raw.start_date;
  const end = raw.end_date;
  if (!name || phone === undefined || rent === undefined || note === undefined) return null;
  if (!isValidDate(start) || !isValidDate(end) || end <= start) return null;
  return { tenant_name: name, tenant_phone: phone, start_date: start, end_date: end, rent_satang: rent, note };
}

/** Why a sublease cannot sit under this lease, or null when it can. */
export function subleaseProblem(
  lease: { status: string; start_date: string; end_date: string },
  input: Pick<SubleaseInput, 'start_date' | 'end_date'>,
  others: Pick<Sublease, 'status' | 'start_date' | 'end_date'>[],
): 'lease_not_active' | 'outside_lease' | 'overlaps_sublease' | null {
  if (lease.status !== 'active' && lease.status !== 'scheduled') return 'lease_not_active';
  if (input.start_date < lease.start_date || input.end_date > lease.end_date) return 'outside_lease';
  if (others.some(o => o.status === 'active' && o.start_date < input.end_date && input.start_date < o.end_date)) return 'overlaps_sublease';
  return null;
}

/** The sublease that has someone in the room today, if any. */
export const currentSublease = <T extends Pick<Sublease, 'status' | 'start_date' | 'end_date'>>(list: T[], today: string): T | undefined =>
  list.find(s => s.status === 'active' && s.start_date <= today && today < s.end_date);

// ── Unit owners ──────────────────────────────────────────────────────────────

export type FeeType = 'percent' | 'fixed';

export interface UnitOwner {
  id: string;
  name: string;
  phone: string | null;
  /** where the payout goes, as typed: bank and account or PromptPay */
  payout_to: string | null;
  fee_type: FeeType;
  /** percent: 0–100 (may have decimals); fixed: satang per room per month */
  fee_value: number;
  room_ids: string[];
  note: string | null;
  /** read-only summary link for the owner (hash kept server-side; this is only "is there one") */
  has_link?: boolean;
  created_at: string;
  updated_at: string;
}

export interface UnitOwnerInput { name: string; phone: string | null; payout_to: string | null; fee_type: FeeType; fee_value: number; note: string | null }

export function cleanUnitOwnerInput(raw: Record<string, unknown>): UnitOwnerInput | null {
  const name = text(raw.name, 100, 2);
  const phone = phoneOf(raw.phone);
  const payout = text(raw.payout_to, 200);
  const note = text(raw.note, 500);
  const type = raw.fee_type === 'percent' || raw.fee_type === 'fixed' ? raw.fee_type : null;
  if (!name || phone === undefined || payout === undefined || note === undefined || !type) return null;
  const v = typeof raw.fee_value === 'string' ? Number(raw.fee_value) : raw.fee_value;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null;
  let fee: number;
  if (type === 'percent') {
    if (v > 100) return null;
    fee = Math.round(v * 100) / 100;
  } else {
    if (v > 1_000_000) return null;
    fee = toSatang(v);
  }
  return { name, phone, payout_to: payout, fee_type: type, fee_value: fee, note };
}

export const feeLabel = (o: Pick<UnitOwner, 'fee_type' | 'fee_value'>): string =>
  o.fee_type === 'percent' ? `${o.fee_value}% ของค่าเช่าที่เก็บได้` : `${(o.fee_value / 100).toLocaleString('th-TH')} บาท/ห้อง/เดือน`;

export interface StatementBill { room_id: string; room_number?: string; month?: string; is_saved?: boolean; payment_status?: string; room_rent?: number }

export interface StatementLine {
  room_id: string;
  room_number: string;
  /** rent billed this month (baht) — 0 when the room had no bill */
  rent_billed: number;
  /** rent actually collected (paid bills only) */
  rent_collected: number;
  fee: number;
  payout: number;
}

export interface Statement {
  month: string;
  lines: StatementLine[];
  rent_billed: number;
  rent_collected: number;
  fee: number;
  payout: number;
  /** rent billed but not yet collected: paid to the owner once it comes in */
  outstanding: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * One month for one owner: only the rent part of each bill counts (utilities and fees stay with the property), only what
 * was collected is paid out, and the fee is never more than what was collected — the owner never pays out of pocket.
 */
export function ownerStatement(
  owner: Pick<UnitOwner, 'fee_type' | 'fee_value' | 'room_ids'>,
  rooms: { id: string; room_number: string }[],
  bills: StatementBill[],
  month: string,
): Statement {
  const lines: StatementLine[] = owner.room_ids.map(id => {
    const roomBills = bills.filter(b => b.room_id === id && b.month === month && b.is_saved);
    const billed = r2(roomBills.reduce((s, b) => s + (Number(b.room_rent) || 0), 0));
    const collected = r2(roomBills.filter(b => b.payment_status === 'paid').reduce((s, b) => s + (Number(b.room_rent) || 0), 0));
    const rawFee = owner.fee_type === 'percent' ? collected * owner.fee_value / 100 : (collected > 0 ? owner.fee_value / 100 : 0);
    const fee = r2(Math.min(collected, rawFee));
    const number = rooms.find(r => r.id === id)?.room_number ?? roomBills[0]?.room_number ?? id;
    return { room_id: id, room_number: number, rent_billed: billed, rent_collected: collected, fee, payout: r2(collected - fee) };
  }).sort((a, b) => a.room_number.localeCompare(b.room_number, 'th', { numeric: true }));
  const sum = (k: keyof Pick<StatementLine, 'rent_billed' | 'rent_collected' | 'fee' | 'payout'>) => r2(lines.reduce((s, l) => s + l[k], 0));
  const rent_billed = sum('rent_billed');
  const rent_collected = sum('rent_collected');
  return { month, lines, rent_billed, rent_collected, fee: sum('fee'), payout: sum('payout'), outstanding: r2(rent_billed - rent_collected) };
}

/** "YYYY-MM" months ending with `month`, newest first. */
export function recentMonths(month: string, count: number): string[] {
  const [y, m] = month.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    return d.toISOString().slice(0, 7);
  });
}

export const MAX_SUBLEASE_DAYS = 3 * 366;
export const subleaseTooLong = (s: Pick<SubleaseInput, 'start_date' | 'end_date'>) => daysBetween(s.start_date, s.end_date) > MAX_SUBLEASE_DAYS;
