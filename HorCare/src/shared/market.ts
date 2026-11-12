// Market features: stalls reporting days they will be closed, and walk-in (ขาจร) vendors announcing
// the day they want to sell. Dates are Thai calendar days ("YYYY-MM-DD", Asia/Bangkok), never timestamps,
// so "closed on the 14th" means the 14th in Thailand wherever the server runs.

export const CLOSURE_REASONS = ['personal', 'sick', 'holiday', 'restock', 'other'] as const;
export type ClosureReason = (typeof CLOSURE_REASONS)[number];
export const CLOSURE_REASON_LABELS_TH: Record<ClosureReason, string> = {
  personal: 'ธุระส่วนตัว', sick: 'ป่วย', holiday: 'หยุดพักผ่อน', restock: 'ไปรับของ/สต็อกสินค้า', other: 'อื่นๆ',
};

export const MAX_CLOSURE_DAYS = 60;
export const WALKIN_MAX_DAYS_AHEAD = 14;
export const WALKIN_MAX_PER_DAY = 200;
/** A stall may have at most this many upcoming active closures (stops a form being used to flood the list). */
export const MAX_ACTIVE_CLOSURES_PER_ROOM = 10;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date in Thailand. */
export function todayTh(now: Date = new Date()): string {
  return new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}

export function isValidDate(s: unknown): s is string {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function addDays(date: string, n: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

// ── Closures ────────────────────────────────────────────────────────────────

export interface ShopClosure {
  id: string;
  room_id: string;
  room_number: string;
  from_date: string;
  to_date: string;
  reason: ClosureReason;
  note: string | null;
  status: 'active' | 'cancelled';
  created_at: string;
  /** Market staff saw it. */
  ack_at?: string;
  ack_by?: string;
}

export interface ClosureInput { from_date: string; to_date: string; reason: ClosureReason; note: string | null }

export function cleanClosureInput(raw: { from_date?: unknown; to_date?: unknown; reason?: unknown; note?: unknown }, now: Date = new Date()): ClosureInput | null {
  if (!isValidDate(raw.from_date) || !isValidDate(raw.to_date)) return null;
  if (typeof raw.reason !== 'string' || !(CLOSURE_REASONS as readonly string[]).includes(raw.reason)) return null;
  if (raw.from_date < todayTh(now) || raw.to_date < raw.from_date) return null;
  if (daysBetween(raw.from_date, raw.to_date) + 1 > MAX_CLOSURE_DAYS) return null;
  let note: string | null = null;
  if (raw.note !== undefined && raw.note !== null && raw.note !== '') {
    if (typeof raw.note !== 'string' || raw.note.trim().length > 200) return null;
    note = raw.note.trim() || null;
  }
  return { from_date: raw.from_date, to_date: raw.to_date, reason: raw.reason as ClosureReason, note };
}

export function closureCovers(c: Pick<ShopClosure, 'from_date' | 'to_date' | 'status'>, date: string): boolean {
  return c.status === 'active' && c.from_date <= date && date <= c.to_date;
}

export function closuresOn(list: ShopClosure[], date: string): ShopClosure[] {
  return list.filter(c => closureCovers(c, date)).sort((a, b) => a.room_number.localeCompare(b.room_number, 'th', { numeric: true }));
}

/** Active closures that have not ended yet, soonest first. */
export function upcomingClosures(list: ShopClosure[], today: string): ShopClosure[] {
  return list.filter(c => c.status === 'active' && c.to_date >= today).sort((a, b) => a.from_date.localeCompare(b.from_date) || a.room_number.localeCompare(b.room_number, 'th', { numeric: true }));
}

// ── The market itself closes (power cut, flood, an event) ───────────────────

export const MARKET_CLOSURE_REASONS = ['power', 'water', 'flood', 'storm', 'event', 'maintenance', 'other'] as const;
export type MarketClosureReason = (typeof MARKET_CLOSURE_REASONS)[number];
export const MARKET_CLOSURE_REASON_LABELS_TH: Record<MarketClosureReason, string> = {
  power: 'ไฟดับ', water: 'น้ำไม่ไหล', flood: 'น้ำท่วม', storm: 'พายุ / ฝนตกหนัก', event: 'มีงาน / กิจกรรมพิเศษ', maintenance: 'ปรับปรุงพื้นที่', other: 'อื่นๆ',
};
/** A closure can be recorded after the fact (the power cut was yesterday), up to this many days back. */
export const MARKET_CLOSURE_MAX_DAYS_BACK = 120;

export interface MarketClosure {
  id: string;
  from_date: string;
  to_date: string;
  /** null = the whole market. */
  zones: string[] | null;
  reason: MarketClosureReason;
  note: string | null;
  /** Monthly-rent stalls get the days off their rent (pro rata). Daily / weekly stalls never pay for days the market was shut. */
  waive_rent: boolean;
  status: 'active' | 'cancelled';
  created_at: string;
  created_by: string;
}

export interface MarketClosureInput { from_date: string; to_date: string; zones: string[] | null; reason: MarketClosureReason; note: string | null; waive_rent: boolean }

export function cleanMarketClosureInput(raw: Record<string, unknown>, now: Date = new Date()): MarketClosureInput | null {
  if (!isValidDate(raw.from_date) || !isValidDate(raw.to_date)) return null;
  if (raw.to_date < raw.from_date || daysBetween(raw.from_date, raw.to_date) + 1 > MAX_CLOSURE_DAYS) return null;
  if (raw.from_date < addDays(todayTh(now), -MARKET_CLOSURE_MAX_DAYS_BACK)) return null;
  if (typeof raw.reason !== 'string' || !(MARKET_CLOSURE_REASONS as readonly string[]).includes(raw.reason)) return null;
  let zones: string[] | null = null;
  if (raw.zones !== undefined && raw.zones !== null) {
    if (!Array.isArray(raw.zones) || raw.zones.length > 50) return null;
    const z = [...new Set(raw.zones.map(v => (typeof v === 'string' ? v.trim() : '')).filter(Boolean))];
    if (z.length !== raw.zones.length || z.some(v => v.length > 60)) return null;
    zones = z.length > 0 ? z : null;
  }
  let note: string | null = null;
  if (raw.note !== undefined && raw.note !== null && raw.note !== '') {
    if (typeof raw.note !== 'string' || raw.note.trim().length > 300) return null;
    note = raw.note.trim() || null;
  }
  if (raw.waive_rent !== undefined && typeof raw.waive_rent !== 'boolean') return null;
  return { from_date: raw.from_date, to_date: raw.to_date, zones, reason: raw.reason as MarketClosureReason, note, waive_rent: raw.waive_rent === true };
}

// ── Walk-in vendors ─────────────────────────────────────────────────────────

export type WalkInStatus = 'pending' | 'approved' | 'rejected';
export const WALKIN_STATUS_LABELS_TH: Record<WalkInStatus, string> = { pending: 'รอพิจารณา', approved: 'อนุมัติ', rejected: 'ไม่อนุมัติ' };

/** A stall (ล็อก) as a walk-in sees it: its number and zone, nothing about who rents it. */
export interface WalkInLot { room_id: string; room_number: string; zone?: string | null }

export interface WalkIn {
  id: string;
  date: string;
  name: string;
  phone: string;
  goods: string;
  status: WalkInStatus;
  source: 'public' | 'staff';
  created_at: string;
  decided_at?: string;
  decided_by?: string;
  /** The lot the vendor asked for — a wish, not a booking (WALKIN_LOT_NOTE). */
  preferred_lot?: WalkInLot | null;
  /** The lot the market gave when approving (may differ from the wish). */
  lot?: WalkInLot | null;
  /** The one-off code that links this request to the vendor's LINE (HCW-XXXXXXXX). */
  line_code?: string;
  line_user_id?: string;
  /** The OA the vendor linked through (LineChannel), so the decision goes out through the same chat. */
  line_channel?: string;
  /** The decision was sent to the vendor on LINE. */
  line_notified_at?: string;
}

export interface WalkInInput { date: string; name: string; phone: string; goods: string; preferred_room_id: string | null }

export const digitsOnly = (s: string) => s.replace(/\D/g, '');

const ROOM_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export function cleanWalkInInput(raw: { date?: unknown; name?: unknown; phone?: unknown; goods?: unknown; preferred_room_id?: unknown }, now: Date = new Date()): WalkInInput | null {
  if (!isValidDate(raw.date)) return null;
  const today = todayTh(now);
  if (raw.date < today || raw.date > addDays(today, WALKIN_MAX_DAYS_AHEAD)) return null;
  if (typeof raw.name !== 'string' || typeof raw.phone !== 'string' || typeof raw.goods !== 'string') return null;
  const name = raw.name.trim();
  const goods = raw.goods.trim();
  const phone = digitsOnly(raw.phone);
  if (name.length < 2 || name.length > 60 || goods.length < 2 || goods.length > 100) return null;
  if (!/^0\d{8,9}$/.test(phone)) return null;
  let preferred: string | null = null;
  if (raw.preferred_room_id !== undefined && raw.preferred_room_id !== null && raw.preferred_room_id !== '') {
    if (typeof raw.preferred_room_id !== 'string' || !ROOM_ID_RE.test(raw.preferred_room_id)) return null;
    preferred = raw.preferred_room_id;
  }
  return { date: raw.date, name, phone, goods, preferred_room_id: preferred };
}

/**
 * Said wherever a walk-in picks a lot — the form, the LINE confirmation, the decision: the lot is a wish. Others may
 * ask for the same lot the same day, and a regular stall may be in use, so the market assigns the lot in the end.
 */
export const WALKIN_LOT_NOTE =
  'ล็อกที่เลือกเป็นเพียงล็อกที่ต้องการ ยังไม่ใช่การจองยืนยัน อาจไม่ได้ล็อกตามที่เลือก เพราะอาจมีผู้แจ้งล็อกเดียวกันในวันเดียวกัน ' +
  'หรือล็อกนั้นมีผู้ค้าประจำใช้อยู่ ตลาดจะเป็นผู้จัดล็อกให้และแจ้งผลอีกครั้งค่ะ';

/** The one-off code a walk-in sends to the market's LINE to link the request: HCW- and 8 letters / digits. */
export const WALKIN_CODE_RE = /^HCW-[A-Z0-9]{8}$/;
export const isWalkInCode = (text: string): boolean => WALKIN_CODE_RE.test(text.trim().toUpperCase());

/** How many live requests (not rejected) want each lot on a day — two or more is a clash the market must settle. */
export function lotRequests(list: Pick<WalkIn, 'date' | 'status' | 'preferred_lot' | 'lot'>[], date: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const w of list) {
    if (w.date !== date || w.status === 'rejected') continue;
    const id = (w.lot ?? w.preferred_lot)?.room_id;
    if (id) out.set(id, (out.get(id) ?? 0) + 1);
  }
  return out;
}

export const lotLabel = (l: WalkInLot | null | undefined): string =>
  !l ? 'ให้ตลาดจัดให้' : `ล็อก ${l.room_number}${l.zone ? ` (${l.zone})` : ''}`;
