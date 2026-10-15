// HorCare's own books: chart of accounts, immutable journal entries and the reports computed from them.
// Pure functions shared by the API (which is the only writer) and the UI. External systems such as Mango
// are export targets: they read these entries and translate account codes; they never own the data.
//
// Rules: an entry is balanced, has at least two lines and positive single-sided amounts; entries are never
// edited or deleted — a mistake is corrected by a reversal; a locked period accepts no new entries.

import type { ChannelKey, PostingProfile, RevenueCategory, Voucher } from './accounting.js';
import { thDate } from './accounting.js';

// ── Chart of accounts ───────────────────────────────────────────────────────

export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export const ACCOUNT_TYPE_LABELS_TH: Record<AccountType, string> = {
  asset: 'สินทรัพย์', liability: 'หนี้สิน', equity: 'ส่วนของเจ้าของ', revenue: 'รายได้', expense: 'ค่าใช้จ่าย',
};
/** Assets and expenses grow on the debit side; the rest on the credit side. */
export const normalSide = (t: AccountType): 'debit' | 'credit' => (t === 'asset' || t === 'expense' ? 'debit' : 'credit');

export interface Account {
  code: string;
  name: string;
  type: AccountType;
  active: boolean;
  /** Codes the same account has in other systems, keyed by target (e.g. { mango: '1140102' }). */
  external?: Record<string, string>;
}

export const MAX_ACCOUNTS = 300;
export const ACCOUNT_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,19}$/;

/** A sensible starting chart for a rental business. Codes are suggestions the owner/accountant can change. */
export function defaultChart(): Account[] {
  const a = (code: string, name: string, type: AccountType): Account => ({ code, name, type, active: true });
  return [
    a('1101', 'เงินสด', 'asset'),
    a('1102', 'เงินฝากธนาคาร', 'asset'),
    a('1140', 'ลูกหนี้ค่าเช่าและบริการ', 'asset'),
    a('2101', 'เงินรับล่วงหน้า', 'liability'),
    a('2102', 'เงินมัดจำรับ', 'liability'),
    a('1160', 'ภาษีซื้อ', 'asset'),
    a('2110', 'เจ้าหนี้การค้า', 'liability'),
    a('2201', 'ภาษีมูลค่าเพิ่มรอนำส่ง', 'liability'),
    a('2210', 'ภาษีหัก ณ ที่จ่ายรอนำส่ง', 'liability'),
    a('3101', 'ทุน / ส่วนของเจ้าของ', 'equity'),
    a('4101', 'รายได้ค่าเช่า', 'revenue'),
    a('4102', 'รายได้ค่าไฟฟ้า', 'revenue'),
    a('4103', 'รายได้ค่าน้ำ', 'revenue'),
    a('4104', 'รายได้ค่าส่วนกลางและบริการ', 'revenue'),
    a('4105', 'รายได้ค่าปรับ', 'revenue'),
    a('4106', 'รายได้ค่าห้องพักรายคืน', 'revenue'),
    a('4107', 'รายได้ค่าเช่าแผงรายวัน/สัปดาห์', 'revenue'),
    a('4108', 'รายได้ค่าแผงขาจร', 'revenue'),
    a('4901', 'รายได้อื่น', 'revenue'),
    a('5101', 'ค่าใช้จ่ายทั่วไป', 'expense'),
  ];
}

export interface AccountIssue { code: string; message: string }

/** Validate a chart. Codes are unique (case-insensitive) and well-formed; names are present. */
export function validateChart(accounts: Account[]): AccountIssue[] {
  const issues: AccountIssue[] = [];
  if (accounts.length === 0) issues.push({ code: '', message: 'ผังบัญชีว่าง' });
  if (accounts.length > MAX_ACCOUNTS) issues.push({ code: '', message: `มีบัญชีได้ไม่เกิน ${MAX_ACCOUNTS} บัญชี` });
  const seen = new Set<string>();
  for (const a of accounts) {
    if (!ACCOUNT_CODE_RE.test(a.code)) issues.push({ code: a.code, message: `รหัสบัญชี "${a.code}" ไม่ถูกต้อง (ตัวอักษร ตัวเลข . - ไม่เกิน 20 ตัว)` });
    if (seen.has(a.code.toLowerCase())) issues.push({ code: a.code, message: `รหัสบัญชี ${a.code} ซ้ำ` });
    seen.add(a.code.toLowerCase());
    if (!a.name.trim() || a.name.length > 100) issues.push({ code: a.code, message: `บัญชี ${a.code} ต้องมีชื่อ (ไม่เกิน 100 ตัวอักษร)` });
    if (!(ACCOUNT_TYPES as readonly string[]).includes(a.type)) issues.push({ code: a.code, message: `บัญชี ${a.code} ประเภทไม่ถูกต้อง` });
  }
  return issues;
}

// ── Ledger settings ─────────────────────────────────────────────────────────

export interface Ledger {
  id: string;
  name: string;
  legal_entity_name: string;
  /** Properties whose bills and payments post into this ledger (a property belongs to one ledger). */
  property_ids: string[];
  property_codes: Record<string, string>;
  accounts: Account[];
  /** Posting roles → account codes. */
  posting: {
    ar_account: string;
    revenue_accounts: Partial<Record<RevenueCategory, string>>;
    channels: Record<ChannelKey, string>;
  };
  options: {
    invoice_date_basis: 'issued_at' | 'month_end';
    count_unverified_transfers: boolean;
    /** Post invoices and receipts automatically as they happen (api/_ledger-auto.ts). Absent = on. */
    auto_post?: boolean;
    /** Bills before this month ('YYYY-MM') are opening balances, not posted again. */
    opening_cutoff_month: string | null;
  };
  /** Entries dated on or before this day are refused (the books for that period are closed). */
  locked_through: string | null;
  created_at: string;
  updated_at: string;
}

export function emptyLedger(id: string): Ledger {
  return {
    id, name: '', legal_entity_name: '', property_ids: [], property_codes: {}, accounts: defaultChart(),
    posting: { ar_account: '1140', revenue_accounts: { rent: '4101', electric: '4102', water: '4103', common_fee: '4104', fine: '4105', stay: '4106', stall: '4107', walk_in: '4108', other_income: '4901' }, channels: { cash: '1101' } },
    options: { invoice_date_basis: 'issued_at', count_unverified_transfers: false, opening_cutoff_month: null },
    locked_through: null, created_at: '', updated_at: '',
  };
}

export interface LedgerGap { code: string; message: string }

/** What is still missing before this ledger can post anything. */
export function ledgerGaps(l: Ledger): LedgerGap[] {
  const g: LedgerGap[] = [];
  if (!l.legal_entity_name.trim()) g.push({ code: 'entity', message: 'ยังไม่ได้ระบุชื่อนิติบุคคล' });
  if (l.property_ids.length === 0) g.push({ code: 'properties', message: 'ยังไม่ได้เลือกสถานที่' });
  for (const i of validateChart(l.accounts)) g.push({ code: 'chart', message: i.message });
  const byCode = new Map(l.accounts.map(a => [a.code, a]));
  const need = (role: string, code: string | undefined, type: AccountType[]) => {
    const acc = code ? byCode.get(code) : undefined;
    if (!acc) g.push({ code: 'posting', message: `ยังไม่ได้กำหนดบัญชีสำหรับ ${role}` });
    else if (!acc.active) g.push({ code: 'posting', message: `บัญชี ${acc.code} (${role}) ถูกปิดใช้งาน` });
    else if (!type.includes(acc.type)) g.push({ code: 'posting', message: `บัญชี ${acc.code} ไม่ใช่ประเภทที่ใช้กับ ${role}` });
  };
  need('ลูกหนี้', l.posting.ar_account, ['asset']);
  for (const [cat, code] of Object.entries(l.posting.revenue_accounts)) need(`รายได้ (${cat})`, code, ['revenue']);
  for (const [ch, code] of Object.entries(l.posting.channels)) need(`ช่องทางรับเงิน (${ch})`, code, ['asset']);
  if (l.options.opening_cutoff_month !== null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(l.options.opening_cutoff_month)) {
    g.push({ code: 'cutoff', message: 'เดือนยกยอดไม่ถูกต้อง (รูปแบบ YYYY-MM)' });
  }
  return g;
}

/** The settings the posting rules read, built from a ledger. Customer codes are not needed internally. */
export function postingProfile(l: Ledger): PostingProfile {
  return {
    id: l.id,
    property_codes: l.property_codes,
    options: {
      invoice_date_basis: l.options.invoice_date_basis, count_unverified_transfers: l.options.count_unverified_transfers,
      opening_cutoff_month: l.options.opening_cutoff_month, customer_code_all_lines: false, voucher_no_from_horcare: false,
      date_format: 'template', fill_reference_columns: false, fill_customer_block: false, header_on_every_line: true,
    },
    codes: { ar_account: l.posting.ar_account, project: null, job: null, department: null, cost_code: null, book: null, pu_cost_yn: null, ac_type: null, data_type: null },
    remarks: { invoice: 'ตั้งลูกหนี้', receipt: 'รับชำระ' },
    revenue_accounts: l.posting.revenue_accounts,
    channels: Object.fromEntries(Object.entries(l.posting.channels).map(([k, code]) => [k, { account: code, option_code: null }])),
    customers: {},
  };
}

// ── Journal entries ─────────────────────────────────────────────────────────

export type EntryKind = 'invoice' | 'receipt' | 'manual' | 'reversal';

export interface EntryLine {
  account: string;
  dr_satang: number;
  cr_satang: number;
  description: string;
  /** Sub-ledger party (room/stall id) for receivable lines. */
  party_id: string | null;
}

export interface JournalEntry {
  id: string;
  ledger_id: string;
  kind: EntryKind;
  /** Idempotency key (source + revision) for system entries; unique per ledger. */
  key: string;
  doc_ref: string;
  /** Thai calendar date the entry belongs to. */
  date: string;
  memo: string;
  lines: EntryLine[];
  total_satang: number;
  sources: { kind: 'bill' | 'fine' | 'charge' | 'payment'; id: string; revision: string }[];
  posted_at: string;
  posted_by: string;
  posted_by_name: string;
  /** Set on the original when a reversal has been posted for it. */
  reversed_by?: string;
  /** Set on a reversal entry: the entry it cancels. */
  reversal_of?: string;
  reason?: string;
}

export const MAX_ENTRY_LINES = 100;
export const MAX_MEMO = 300;

export interface EntryIssue { message: string }

/** Validate the lines of an entry against the chart. Returns [] when it may be posted. */
export function validateEntryLines(lines: EntryLine[], accounts: Account[]): EntryIssue[] {
  const issues: EntryIssue[] = [];
  if (lines.length < 2) issues.push({ message: 'ต้องมีอย่างน้อย 2 บรรทัด' });
  if (lines.length > MAX_ENTRY_LINES) issues.push({ message: `มีได้ไม่เกิน ${MAX_ENTRY_LINES} บรรทัด` });
  const byCode = new Map(accounts.map(a => [a.code, a]));
  let dr = 0; let cr = 0;
  for (const [i, l] of lines.entries()) {
    const n = i + 1;
    if (!Number.isInteger(l.dr_satang) || !Number.isInteger(l.cr_satang) || l.dr_satang < 0 || l.cr_satang < 0) issues.push({ message: `บรรทัด ${n}: ยอดไม่ถูกต้อง` });
    else if ((l.dr_satang > 0) === (l.cr_satang > 0)) issues.push({ message: `บรรทัด ${n}: ต้องมียอดเดบิตหรือเครดิตด้านใดด้านหนึ่งเท่านั้น` });
    const acc = byCode.get(l.account);
    if (!acc) issues.push({ message: `บรรทัด ${n}: ไม่พบบัญชี ${l.account}` });
    else if (!acc.active) issues.push({ message: `บรรทัด ${n}: บัญชี ${l.account} ถูกปิดใช้งาน` });
    dr += l.dr_satang; cr += l.cr_satang;
  }
  if (dr !== cr) issues.push({ message: `เดบิต ${dr / 100} ไม่เท่าเครดิต ${cr / 100}` });
  if (dr === 0) issues.push({ message: 'ยอดรวมเป็นศูนย์' });
  return issues;
}

/** True if a day falls inside a closed period. */
export const isLocked = (date: string, lockedThrough: string | null) => lockedThrough !== null && date <= lockedThrough;

/** The entry that cancels another: same lines, sides swapped. */
export function reversalLines(lines: EntryLine[]): EntryLine[] {
  return lines.map(l => ({ ...l, dr_satang: l.cr_satang, cr_satang: l.dr_satang, description: `กลับรายการ: ${l.description}` }));
}

/** A priced voucher from the posting engine, as entry lines. */
export function voucherToLines(v: Voucher): EntryLine[] {
  return v.lines.map(l => ({ account: l.account, dr_satang: l.dr_satang, cr_satang: l.cr_satang, description: l.description, party_id: l.party_id ?? null }));
}

/**
 * Which sources are already in the books: `${kind}:...` → revision, ignoring entries that were reversed
 * (a reversed document can be posted again, e.g. after the bill was corrected).
 */
export function postedSources(entries: JournalEntry[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of entries) {
    if (e.reversed_by || e.kind === 'reversal' || e.kind === 'manual') continue;
    for (const s of e.sources) out.set(s.kind === 'payment' ? `receipt:payment:${s.id}` : `invoice:${s.kind}:${s.id}`, s.revision);
  }
  return out;
}

// ── Reports ─────────────────────────────────────────────────────────────────

export interface TrialRow { account: Account; dr_satang: number; cr_satang: number; balance_satang: number }

/** Debit/credit totals per account up to and including `asOf`. `balance` is on the account's normal side. */
export function trialBalance(entries: JournalEntry[], accounts: Account[], asOf?: string): TrialRow[] {
  const sums = new Map<string, { dr: number; cr: number }>();
  for (const e of entries) {
    if (asOf && e.date > asOf) continue;
    for (const l of e.lines) {
      const s = sums.get(l.account) ?? { dr: 0, cr: 0 };
      s.dr += l.dr_satang; s.cr += l.cr_satang; sums.set(l.account, s);
    }
  }
  const known = new Set(accounts.map(a => a.code));
  const rows = accounts.filter(a => sums.has(a.code) || a.active).map(a => {
    const s = sums.get(a.code) ?? { dr: 0, cr: 0 };
    return { account: a, dr_satang: s.dr, cr_satang: s.cr, balance_satang: normalSide(a.type) === 'debit' ? s.dr - s.cr : s.cr - s.dr };
  });
  // lines on an account no longer in the chart still count (never lose money from a report)
  for (const [code, s] of sums) if (!known.has(code)) rows.push({ account: { code, name: '(บัญชีที่ไม่อยู่ในผังแล้ว)', type: 'asset', active: false }, dr_satang: s.dr, cr_satang: s.cr, balance_satang: s.dr - s.cr });
  return rows.sort((a, b) => a.account.code.localeCompare(b.account.code, 'th', { numeric: true }));
}

export const trialTotals = (rows: TrialRow[]) => ({ dr_satang: rows.reduce((s, r) => s + r.dr_satang, 0), cr_satang: rows.reduce((s, r) => s + r.cr_satang, 0) });

export interface LedgerRow { entry: JournalEntry; line: EntryLine; running_satang: number }

/** One account's movements between two dates, with the balance carried in from before `from`. */
export function accountLedger(entries: JournalEntry[], account: Account, from: string, to: string) {
  const side = normalSide(account.type);
  const signed = (l: EntryLine) => (side === 'debit' ? l.dr_satang - l.cr_satang : l.cr_satang - l.dr_satang);
  let opening = 0;
  const inRange: { entry: JournalEntry; line: EntryLine }[] = [];
  for (const e of [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.posted_at.localeCompare(b.posted_at))) {
    for (const line of e.lines) {
      if (line.account !== account.code) continue;
      if (e.date < from) opening += signed(line);
      else if (e.date <= to) inRange.push({ entry: e, line });
    }
  }
  let running = opening;
  const rows: LedgerRow[] = inRange.map(r => { running += signed(r.line); return { ...r, running_satang: running }; });
  return { opening_satang: opening, rows, closing_satang: running };
}

/** Outstanding receivable per party (room/stall): debits to the receivable account minus credits. */
export function receivablesByParty(entries: JournalEntry[], arAccount: string, asOf?: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of entries) {
    if (asOf && e.date > asOf) continue;
    for (const l of e.lines) {
      if (l.account !== arAccount) continue;
      const k = l.party_id ?? '(ไม่ระบุ)';
      out.set(k, (out.get(k) ?? 0) + l.dr_satang - l.cr_satang);
    }
  }
  return new Map([...out].filter(([, v]) => v !== 0));
}

/** Revenue per account for a period (credit minus debit on revenue accounts). */
export function revenueByAccount(entries: JournalEntry[], accounts: Account[], from: string, to: string) {
  const rev = new Map(accounts.filter(a => a.type === 'revenue').map(a => [a.code, a]));
  const sums = new Map<string, number>();
  for (const e of entries) {
    if (e.date < from || e.date > to) continue;
    for (const l of e.lines) if (rev.has(l.account)) sums.set(l.account, (sums.get(l.account) ?? 0) + l.cr_satang - l.dr_satang);
  }
  return [...sums].map(([code, v]) => ({ account: rev.get(code)!, amount_satang: v })).sort((a, b) => a.account.code.localeCompare(b.account.code, 'th', { numeric: true }));
}

// ── Profit and loss, balance sheet, payables ────────────────────────────────

export interface PnlRow { account: Account; amount_satang: number }

/** Income statement for a period: revenue less expenses, from the entries dated inside it. */
export function profitAndLoss(entries: JournalEntry[], accounts: Account[], from: string, to: string) {
  const byCode = new Map(accounts.map(a => [a.code, a]));
  const sums = new Map<string, { dr: number; cr: number }>();
  for (const e of entries) {
    if (e.date < from || e.date > to) continue;
    for (const l of e.lines) {
      const a = byCode.get(l.account);
      if (!a || (a.type !== 'revenue' && a.type !== 'expense')) continue;
      const s = sums.get(l.account) ?? { dr: 0, cr: 0 };
      s.dr += l.dr_satang; s.cr += l.cr_satang; sums.set(l.account, s);
    }
  }
  const rows = (type: AccountType): PnlRow[] => [...sums]
    .map(([code, s]) => ({ account: byCode.get(code)!, amount_satang: type === 'revenue' ? s.cr - s.dr : s.dr - s.cr }))
    .filter(r => r.account.type === type && r.amount_satang !== 0)
    .sort((x, y) => x.account.code.localeCompare(y.account.code, 'th', { numeric: true }));
  const revenue = rows('revenue'), expenses = rows('expense');
  const revenue_satang = revenue.reduce((s, r) => s + r.amount_satang, 0);
  const expense_satang = expenses.reduce((s, r) => s + r.amount_satang, 0);
  return { revenue, expenses, revenue_satang, expense_satang, net_satang: revenue_satang - expense_satang };
}

/**
 * Balance sheet at a date. Profit not yet closed to equity is shown as "current earnings" so the two sides agree:
 * assets = liabilities + equity + earnings. `balanced` is false only if the books themselves are out of balance.
 */
export function balanceSheet(entries: JournalEntry[], accounts: Account[], asOf: string) {
  const trial = trialBalance(entries, accounts, asOf).filter(r => r.balance_satang !== 0);
  const of = (type: AccountType) => trial.filter(r => r.account.type === type);
  const sum = (rows: TrialRow[]) => rows.reduce((s, r) => s + r.balance_satang, 0);
  const assets = of('asset'), liabilities = of('liability'), equity = of('equity');
  const earnings_satang = sum(of('revenue')) - sum(of('expense'));
  const assets_satang = sum(assets), liabilities_satang = sum(liabilities), equity_satang = sum(equity);
  return {
    assets, liabilities, equity, earnings_satang, assets_satang, liabilities_satang, equity_satang,
    balanced: assets_satang === liabilities_satang + equity_satang + earnings_satang,
  };
}

/** Outstanding payable per supplier: credits to the payable account minus debits. */
export function payablesByParty(entries: JournalEntry[], apAccount: string, asOf?: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of entries) {
    if (asOf && e.date > asOf) continue;
    for (const l of e.lines) {
      if (l.account !== apAccount) continue;
      const k = l.party_id ?? '(ไม่ระบุ)';
      out.set(k, (out.get(k) ?? 0) + l.cr_satang - l.dr_satang);
    }
  }
  return new Map([...out].filter(([, v]) => v !== 0));
}

/** Today in Thailand — the default date of a manual entry. */
export const todayThDate = () => thDate(new Date().toISOString());
