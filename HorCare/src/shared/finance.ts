// Owner-facing money picture: what was billed, what was collected, what is still owed — by month, category and age.
// Pure functions over the documents the app already holds (bills, fines, recorded payments, daily/weekly charges), so
// the charts and the exported dataset always come from the same numbers. Money is integer satang, months are "YYYY-MM".
import { REVENUE_CATEGORIES, REVENUE_CATEGORY_LABELS_TH, monthEnd, thDate, toSatang, type RevenueCategory } from './accounting.js';

export interface BillLike {
  id: string; room_number: string; month: string; is_saved?: boolean;
  room_rent?: number; elec_bill?: number; water_bill?: number; common_fee?: number; total_bill: number;
  payment_status?: string; paid_amount?: number; paid_at?: string; slip_submitted_at?: string; updated_at?: string; created_at?: string;
  payment_method?: string; paid_method?: string; slip_image?: boolean;
  allocated_satang?: number; payments_recorded?: boolean;
}
export interface FineLike {
  id: string; room_number: string; amount: number; date?: string; created_at: string; status?: string;
  paid_amount?: number; paid_at?: string; slip_submitted_at?: string; updated_at?: string; payment_method?: string; paid_method?: string; slip_image?: boolean;
  allocated_satang?: number; payments_recorded?: boolean;
}
export interface PaymentLike {
  paid_at: string; gross_satang: number; method: 'cash' | 'bank_transfer' | 'qr_gateway' | 'other'; status: 'active' | 'void'; verification?: string;
}
export interface ChargeLike {
  id: string; kind: 'stay' | 'stall_week' | 'stall_day' | 'walk_in' | 'extra'; room_number: string | null; party_name: string;
  period_start: string; period_end: string; amount_satang: number; paid_satang: number; status: 'open' | 'paid' | 'void';
}
export interface ChargePaymentLike { amount_satang: number; method: 'cash' | 'transfer'; received_at: string }

export interface FinanceInput {
  bills: BillLike[]; fines: FineLike[]; payments: PaymentLike[]; charges: ChargeLike[]; chargePayments: ChargePaymentLike[];
}

export type Method = 'cash' | 'transfer' | 'other';

export interface BilledLine { month: string; category: RevenueCategory; satang: number }
export interface CollectedLine { month: string; satang: number; method: Method }
export interface OpenItem { id: string; label: string; due: string; outstanding_satang: number }

const CHARGE_CATEGORY: Record<ChargeLike['kind'], RevenueCategory> = { stay: 'stay', stall_week: 'stall', stall_day: 'stall', walk_in: 'walk_in', extra: 'other_income' };
const monthOf = (iso: string) => thDate(iso).slice(0, 7);
const isPaid = (s?: string) => s === 'paid';

/** Everything billed, by month and category. Drafts and voided charges are not income. */
export function billedLines(input: FinanceInput): BilledLine[] {
  const out: BilledLine[] = [];
  for (const b of input.bills) {
    if (b.is_saved === false) continue;
    const parts: [RevenueCategory, number | undefined][] = [['rent', b.room_rent], ['electric', b.elec_bill], ['water', b.water_bill], ['common_fee', b.common_fee]];
    for (const [category, baht] of parts) if (baht) out.push({ month: b.month, category, satang: toSatang(baht) });
  }
  for (const f of input.fines) if (f.amount > 0) out.push({ month: (f.date || f.created_at).slice(0, 7), category: 'fine', satang: toSatang(f.amount) });
  for (const c of input.charges) if (c.status !== 'void' && c.amount_satang > 0) out.push({ month: c.period_start.slice(0, 7), category: CHARGE_CATEGORY[c.kind], satang: c.amount_satang });
  return out;
}

const legacyMethod = (x: { payment_method?: string; paid_method?: string; slip_image?: boolean }): Method =>
  x.payment_method === 'cash' ? 'cash' : x.payment_method === 'bank_transfer' || x.paid_method === 'auto' || x.slip_image ? 'transfer' : 'other';

/** Money actually received, by the month it arrived. Refunds of charges come off. */
export function collectedLines(input: FinanceInput): CollectedLine[] {
  const out: CollectedLine[] = [];
  // paid the old way (marked paid on the document itself) and not also recorded as a payment
  for (const b of input.bills) {
    if (!isPaid(b.payment_status) || b.payments_recorded) continue;
    const at = b.paid_at ?? b.slip_submitted_at ?? b.updated_at ?? b.created_at;
    if (at) out.push({ month: monthOf(at), satang: toSatang(b.paid_amount ?? b.total_bill), method: legacyMethod(b) });
  }
  for (const f of input.fines) {
    if (!isPaid(f.status) || f.payments_recorded) continue;
    const at = f.paid_at ?? f.slip_submitted_at ?? f.updated_at ?? f.created_at;
    out.push({ month: monthOf(at), satang: toSatang(f.paid_amount ?? f.amount), method: legacyMethod(f) });
  }
  for (const p of input.payments) {
    if (p.status === 'void' || p.verification === 'rejected') continue;
    out.push({ month: monthOf(p.paid_at), satang: p.gross_satang, method: p.method === 'cash' ? 'cash' : p.method === 'bank_transfer' || p.method === 'qr_gateway' ? 'transfer' : 'other' });
  }
  for (const p of input.chargePayments) out.push({ month: monthOf(p.received_at), satang: p.amount_satang, method: p.method });
  return out;
}

/** Months ending at `end`, oldest first. */
export function monthsBack(end: string, count: number): string[] {
  const [y, m] = end.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const idx = y * 12 + (m - 1) - (count - 1 - i);
    return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
  });
}
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  const idx = y * 12 + (m - 1) + by;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

export interface MonthRow {
  month: string;
  billed_satang: number;
  collected_satang: number;
  cash_satang: number;
  transfer_satang: number;
  other_satang: number;
  by_category: Record<RevenueCategory, number>;
  /** Collected ÷ billed, null when nothing was billed. */
  collection_rate: number | null;
}

const emptyCategories = (): Record<RevenueCategory, number> => Object.fromEntries(REVENUE_CATEGORIES.map(c => [c, 0])) as Record<RevenueCategory, number>;

export function monthlyRows(input: FinanceInput, months: string[]): MonthRow[] {
  const rows = new Map<string, MonthRow>(months.map(month => [month, {
    month, billed_satang: 0, collected_satang: 0, cash_satang: 0, transfer_satang: 0, other_satang: 0, by_category: emptyCategories(), collection_rate: null,
  }]));
  for (const l of billedLines(input)) { const r = rows.get(l.month); if (r) { r.billed_satang += l.satang; r.by_category[l.category] += l.satang; } }
  for (const l of collectedLines(input)) {
    const r = rows.get(l.month);
    if (!r) continue;
    r.collected_satang += l.satang;
    if (l.method === 'cash') r.cash_satang += l.satang; else if (l.method === 'transfer') r.transfer_satang += l.satang; else r.other_satang += l.satang;
  }
  for (const r of rows.values()) r.collection_rate = r.billed_satang > 0 ? r.collected_satang / r.billed_satang : null;
  return months.map(m => rows.get(m)!);
}

/** Percent change from `base` to `now`; null when there is nothing to compare with. */
export const changePct = (now: number, base: number): number | null => (base > 0 ? ((now - base) / base) * 100 : null);

export interface Comparison {
  month: string;
  now: MonthRow; prev: MonthRow; lastYear: MonthRow;
  billed_vs_prev: number | null; billed_vs_last_year: number | null;
  collected_vs_prev: number | null; collected_vs_last_year: number | null;
}

/** The selected month against the month before and the same month a year ago. */
export function compare(input: FinanceInput, month: string): Comparison {
  const prevM = shiftMonth(month, -1), yearM = shiftMonth(month, -12);
  const [lastYear, prev, now] = monthlyRows(input, [yearM, prevM, month]);
  return {
    month, now, prev, lastYear,
    billed_vs_prev: changePct(now.billed_satang, prev.billed_satang), billed_vs_last_year: changePct(now.billed_satang, lastYear.billed_satang),
    collected_vs_prev: changePct(now.collected_satang, prev.collected_satang), collected_vs_last_year: changePct(now.collected_satang, lastYear.collected_satang),
  };
}

// ── What is still owed ──────────────────────────────────────────────────────

export function openItems(input: FinanceInput): OpenItem[] {
  const out: OpenItem[] = [];
  for (const b of input.bills) {
    if (b.is_saved === false || isPaid(b.payment_status)) continue;
    const left = toSatang(b.total_bill) - (b.allocated_satang ?? 0);
    if (left > 0) out.push({ id: `bill:${b.id}`, label: `ห้อง ${b.room_number}`, due: monthEnd(b.month), outstanding_satang: left });
  }
  for (const f of input.fines) {
    if (isPaid(f.status)) continue;
    const left = toSatang(f.amount) - (f.allocated_satang ?? 0);
    if (left > 0) out.push({ id: `fine:${f.id}`, label: `ห้อง ${f.room_number}`, due: (f.date || f.created_at).slice(0, 10), outstanding_satang: left });
  }
  for (const c of input.charges) {
    const left = c.amount_satang - c.paid_satang;
    if (c.status === 'open' && left > 0) out.push({ id: `charge:${c.id}`, label: c.room_number ? `${c.room_number} · ${c.party_name}` : c.party_name, due: c.period_end, outstanding_satang: left });
  }
  return out;
}

export const AGING_BUCKETS = ['ยังไม่ครบกำหนด', '1–30 วัน', '31–60 วัน', '61–90 วัน', 'เกิน 90 วัน'] as const;

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export interface Aging { buckets: { label: (typeof AGING_BUCKETS)[number]; satang: number; count: number }[]; total_satang: number }

export function aging(items: OpenItem[], today: string): Aging {
  const buckets = AGING_BUCKETS.map(label => ({ label, satang: 0, count: 0 }));
  for (const i of items) {
    const late = daysBetween(i.due, today);
    const b = buckets[late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4];
    b.satang += i.outstanding_satang; b.count++;
  }
  return { buckets, total_satang: buckets.reduce((s, b) => s + b.satang, 0) };
}

/** Who owes the most (past due only), largest first. */
export function topDebtors(items: OpenItem[], today: string, n = 5): { label: string; satang: number; oldest_days: number }[] {
  const by = new Map<string, { satang: number; oldest: number }>();
  for (const i of items) {
    const late = daysBetween(i.due, today);
    if (late <= 0) continue;
    const e = by.get(i.label) ?? { satang: 0, oldest: 0 };
    e.satang += i.outstanding_satang; e.oldest = Math.max(e.oldest, late);
    by.set(i.label, e);
  }
  return [...by.entries()].map(([label, e]) => ({ label, satang: e.satang, oldest_days: e.oldest })).sort((a, b) => b.satang - a.satang || a.label.localeCompare(b.label, 'th', { numeric: true })).slice(0, n);
}

// ── Dataset for analysis outside HorCare ───────────────────────────────────

const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** One row per month: billed, collected, rate, channel split and every revenue category, in baht. */
export function toCsv(rows: MonthRow[]): string {
  const baht = (s: number) => (s / 100).toFixed(2);
  const header = ['เดือน', 'ออกบิล/ตั้งยอด (บาท)', 'รับเงินจริง (บาท)', 'อัตราเก็บได้ (%)', 'เงินสด (บาท)', 'โอน (บาท)', 'อื่น ๆ (บาท)', ...REVENUE_CATEGORIES.map(c => `${REVENUE_CATEGORY_LABELS_TH[c]} (บาท)`)];
  const lines = rows.map(r => [
    r.month, baht(r.billed_satang), baht(r.collected_satang), r.collection_rate === null ? '' : (r.collection_rate * 100).toFixed(1),
    baht(r.cash_satang), baht(r.transfer_satang), baht(r.other_satang), ...REVENUE_CATEGORIES.map(c => baht(r.by_category[c])),
  ].map(x => q(String(x))).join(','));
  return [header.map(q).join(','), ...lines].join('\r\n');
}
