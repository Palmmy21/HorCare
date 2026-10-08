// Accounting export core: turns bills, fines and payments into balanced journal vouchers for a
// bookkeeping package (Mango). Pure functions only, so the rules can be tested without a database.
//
// Principles (from the requirements): never invent codes or amounts — a missing mapping or an
// unsupported case BLOCKS the document with a reason instead of being guessed; money is integer
// satang (no floats); a slip that was only read by AI is not money received.

// ── Money ───────────────────────────────────────────────────────────────────

/** Baht → integer satang. Rounds half away from zero at the satang. */
export function toSatang(baht: number): number {
  if (!Number.isFinite(baht)) return NaN;
  return Math.sign(baht) * Math.round(Math.abs(baht) * 100 + 1e-9);
}
export const fromSatang = (s: number): number => s / 100;

// ── Thai dates ──────────────────────────────────────────────────────────────

/** Calendar date (YYYY-MM-DD) in Thailand for an instant. */
export function thDate(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '' : new Date(t + 7 * 3600_000).toISOString().slice(0, 10);
}

export function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

// ── Source documents ────────────────────────────────────────────────────────

export const REVENUE_CATEGORIES = ['rent', 'electric', 'water', 'common_fee', 'fine', 'stay', 'stall', 'walk_in', 'other_income'] as const;
export type RevenueCategory = (typeof REVENUE_CATEGORIES)[number];
export const REVENUE_CATEGORY_LABELS_TH: Record<RevenueCategory, string> = {
  rent: 'ค่าเช่า', electric: 'ค่าไฟ', water: 'ค่าน้ำ', common_fee: 'ค่าส่วนกลาง/บริการ', fine: 'ค่าปรับ',
  stay: 'ค่าห้องพักรายคืน', stall: 'ค่าเช่าแผง (รายวัน/สัปดาห์)', walk_in: 'ค่าแผงขาจร', other_income: 'รายได้อื่น',
};

/** A bill, a fine or a daily/weekly collection charge (stay, stall week/day, walk-in), reduced to what accounting needs. */
export interface ReceivableDoc {
  kind: 'bill' | 'fine' | 'charge';
  id: string;
  room_id: string;
  room_number: string;
  /** 'YYYY-MM' (bills: billing month; fines: month of the fine). */
  period: string;
  /** ISO time the document was issued to the tenant (bills: when saved/created). */
  issued_at: string;
  status: 'draft' | 'issued' | 'cancelled';
  lines: { category: RevenueCategory; amount_satang: number }[];
  /** The total the system itself shows the tenant — must equal the sum of lines. */
  total_satang: number;
  /** Changes whenever the document changes (used to detect edits after export). */
  revision: string;
  /** Optional short code of the property, to keep document numbers unique across properties. */
  property_code?: string;
  /** Tenant name / phone for the optional customer block of the file. */
  customer_name?: string;
  customer_tel?: string;
}

export type ChannelKey = string; // 'cash' | 'bank:<bankAccountId>' | 'bank:unknown' | 'qr_gateway' | 'other'

export interface PaymentRec {
  id: string;
  room_id: string;
  channel: ChannelKey;
  method: 'cash' | 'bank_transfer' | 'qr_gateway' | 'other';
  paid_at: string;
  gross_satang: number;
  verification: 'unverified' | 'verified' | 'rejected' | 'n/a';
  status: 'active' | 'void';
  allocations: { target_kind: 'bill' | 'fine' | 'charge'; target_id: string; amount_satang: number }[];
  revision: string;
}

export const channelOf = (method: PaymentRec['method'], bankAccountId?: string | null): ChannelKey =>
  method === 'cash' ? 'cash' : method === 'bank_transfer' ? `bank:${bankAccountId || 'unknown'}` : method;

// ── Profile ─────────────────────────────────────────────────────────────────

export interface MangoProfile {
  id: string;
  name: string;
  legal_entity_name: string;
  /** Version of the Mango import template this profile was approved against. */
  template_version: string;
  /** Properties (buildings) whose documents this profile exports; one legal entity only. */
  property_ids: string[];
  /** Optional per-property short code used in document numbers. */
  property_codes: Record<string, string>;
  status: 'draft' | 'approved';
  options: {
    invoice_date_basis: 'issued_at' | 'month_end';
    /** Count bank transfers whose money has not been confirmed against the bank. Off by default. */
    count_unverified_transfers: boolean;
    /** Bills before this month ('YYYY-MM') are already in Mango as opening balances. */
    opening_cutoff_month: string | null;
    /** Put the customer code on every line, not only the receivable line. */
    customer_code_all_lines: boolean;
    /** Fill "Voucher no." with HorCare's document number (otherwise left for Mango). */
    voucher_no_from_horcare: boolean;
    /** Display format of date cells (they are real Excel dates). 'template' keeps the format of Mango's sample. */
    date_format: 'template' | 'dd/mm/yyyy' | 'yyyy-mm-dd';
    /** Fill Ref No./Ref Date (header) and Ref no./Ref Date (detail). Mango's sample leaves them empty, so off by default. */
    fill_reference_columns: boolean;
    /** Fill Customer Name (AM) and Tel No. (AQ) as the sample does. */
    fill_customer_block: boolean;
    /** Repeat the header fields (voucher no., date, remarks…) on every line of a voucher, or only on its first line. */
    header_on_every_line: boolean;
  };
  codes: {
    ar_account: string;
    project: string | null;
    job: string | null;
    department: string | null;
    cost_code: string | null;
    /** Header fields the template says Mango fills; blank unless the accountant tells us a value. */
    book: string | null;
    pu_cost_yn: string | null;
    ac_type: string | null;
    data_type: string | null;
  };
  remarks: { invoice: string; receipt: string };
  revenue_accounts: Partial<Record<RevenueCategory, string>>;
  channels: Record<ChannelKey, { account: string; option_code: string | null }>;
  /** room_id → Mango customer code. Never derived from room number or name. */
  customers: Record<string, { code: string }>;
}

export function emptyProfile(id: string): MangoProfile {
  return {
    id, name: '', legal_entity_name: '', template_version: '', property_ids: [], property_codes: {}, status: 'draft',
    options: { invoice_date_basis: 'issued_at', count_unverified_transfers: false, opening_cutoff_month: null, customer_code_all_lines: true, voucher_no_from_horcare: false, date_format: 'template', fill_reference_columns: false, fill_customer_block: false, header_on_every_line: true },
    codes: { ar_account: '', project: null, job: null, department: null, cost_code: null, book: null, pu_cost_yn: null, ac_type: null, data_type: null },
    remarks: { invoice: 'บันทึกตั้งลูกหนี้', receipt: 'บันทึกตัดลูกหนี้' },
    revenue_accounts: {}, channels: {}, customers: {},
  };
}

export interface Gap { code: string; message: string; field?: string }

/** Settings still missing before anything can be exported (independent of any document). */
export function profileGaps(p: MangoProfile): Gap[] {
  const g: Gap[] = [];
  if (!p.legal_entity_name.trim()) g.push({ code: 'entity', field: 'legal_entity_name', message: 'ยังไม่ได้ระบุชื่อนิติบุคคล' });
  if (!p.template_version.trim()) g.push({ code: 'template', field: 'template_version', message: 'ยังไม่ได้ระบุเวอร์ชัน template ของ Mango' });
  if (p.property_ids.length === 0) g.push({ code: 'properties', field: 'property_ids', message: 'ยังไม่ได้เลือกสถานที่' });
  if (!p.codes.ar_account.trim()) g.push({ code: 'ar_account', field: 'codes.ar_account', message: 'ยังไม่ได้ระบุบัญชีลูกหนี้' });
  const hasProjectJob = !!p.codes.project?.trim() && !!p.codes.job?.trim();
  if (!hasProjectJob && !p.codes.department?.trim()) {
    g.push({ code: 'dimension', field: 'codes.project', message: 'ต้องระบุ Project + Job หรือ Department อย่างใดอย่างหนึ่ง' });
  }
  if (!p.remarks.invoice.trim() || !p.remarks.receipt.trim()) g.push({ code: 'remarks', field: 'remarks', message: 'ยังไม่ได้ระบุ Remark 1 ของใบตั้งลูกหนี้/ตัดลูกหนี้' });
  if (p.options.opening_cutoff_month !== null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(p.options.opening_cutoff_month)) {
    g.push({ code: 'cutoff', field: 'options.opening_cutoff_month', message: 'เดือนยกยอดไม่ถูกต้อง (รูปแบบ YYYY-MM)' });
  }
  return g;
}

// ── Vouchers ────────────────────────────────────────────────────────────────

export type VoucherKind = 'invoice' | 'receipt';

export interface JournalLine {
  account: string;
  dr_satang: number;
  cr_satang: number;
  description: string;
  ref_no: string;
  ref_date: string;
  customer_code: string | null;
  option_code: string | null;
  /** Sub-ledger party (the stall/room the receivable belongs to); null on lines that are not receivables. */
  party_id?: string | null;
}

export interface Voucher {
  /** Stable key: same source + same revision → same key, so a retry can never create a second voucher. */
  key: string;
  kind: VoucherKind;
  doc_ref: string;
  voucher_date: string;
  remark1: string;
  customer_code: string;
  customer_name?: string;
  customer_tel?: string;
  room_number: string;
  lines: JournalLine[];
  total_dr_satang: number;
  total_cr_satang: number;
  sources: { kind: 'bill' | 'fine' | 'charge' | 'payment'; id: string; revision: string }[];
}

export interface Problem {
  code: string;
  message: string;
  source: { kind: 'bill' | 'fine' | 'charge' | 'payment'; id: string; label: string };
}
export interface Excluded { source: { kind: 'bill' | 'fine' | 'charge' | 'payment'; id: string; label: string }; reason: string }

export interface PostingResult { vouchers: Voucher[]; problems: Problem[]; excluded: Excluded[] }

export const EXCLUDE_REASON_LABELS_TH: Record<string, string> = {
  draft: 'ยังเป็นฉบับร่าง', cancelled: 'ยกเลิกแล้ว', before_cutoff: 'อยู่ก่อนเดือนยกยอด (มีใน Mango แล้ว)',
  already_exported: 'ส่งออกไปแล้ว', void: 'รายการรับชำระถูกยกเลิก', unverified: 'ยังไม่ยืนยันว่าเงินเข้าบัญชี',
  rejected: 'การชำระถูกปฏิเสธ', zero_amount: 'ยอดเป็นศูนย์',
};

export const PROBLEM_LABELS_TH: Record<string, string> = {
  no_customer_code: 'ยังไม่ได้กำหนด Customer Code ของแผง/ห้องนี้',
  no_revenue_account: 'ยังไม่ได้กำหนดบัญชีรายได้ของหมวดนี้',
  no_channel_account: 'ยังไม่ได้กำหนดบัญชีรับเงินของช่องทางนี้',
  total_mismatch: 'ยอดรวมบิลไม่เท่ากับผลรวมรายการย่อย',
  invalid_amount: 'ยอดรายการไม่ถูกต้อง (ติดลบ หรือไม่ใช่ตัวเลข)',
  unallocated_remainder: 'รับเงินมากกว่าที่จัดสรรให้บิล (เงินรับล่วงหน้า/เงินเกิน ยังไม่รองรับ)',
  over_allocated: 'จัดสรรเกินยอดที่รับ',
  allocation_target_missing: 'ไม่พบบิล/ค่าปรับที่จัดสรรไว้',
  allocation_cancelled: 'จัดสรรไปยังเอกสารที่ถูกยกเลิก',
  invoice_not_in_mango: 'บิลที่ชำระยังไม่เคยลงบัญชี/ส่งออกตั้งลูกหนี้ — ตั้งลูกหนี้ก่อน',
  revised_after_export: 'บิลถูกแก้หลังลงบัญชี/ส่งออกแล้ว — ต้องกลับรายการเดิมหรือให้ฝ่ายบัญชีตัดสินวิธีแก้ไข',
  multi_customer_payment: 'การรับเงินครั้งเดียวจัดสรรให้หลายลูกค้า (ยังไม่รองรับ)',
  voucher_unbalanced: 'เดบิตไม่เท่าเครดิต',
};

/** What the posting rules need from a profile — a Mango export profile or a ledger's posting settings. */
export type PostingProfile = Pick<MangoProfile, 'id' | 'options' | 'codes' | 'remarks' | 'revenue_accounts' | 'channels' | 'customers' | 'property_codes'>;

export interface PostingInput {
  profile: PostingProfile;
  /** An external system needs a customer code on every document; the internal ledger does not. Default true. */
  requireCustomerCode?: boolean;
  kind: VoucherKind;
  /** Inclusive Thai dates. Invoices are filtered by voucher date, receipts by payment date. */
  from: string;
  to: string;
  docs: ReceivableDoc[];
  payments: PaymentRec[];
  /** `${kind}:${docKind}:${docId}` → revision that was already exported (invoices) or `payment:${id}` (receipts). */
  exported: Map<string, string>;
}

const label = (d: ReceivableDoc) => `${d.kind === 'bill' ? 'บิล' : d.kind === 'charge' ? 'ค่าเก็บรายวัน/สัปดาห์' : 'ค่าปรับ'} ${d.room_number} ${d.period}`;

export function docRef(d: ReceivableDoc): string {
  const prefix = d.property_code ? `${d.property_code}-` : '';
  if (d.kind === 'charge') return `IVC-${prefix}${d.id.slice(0, 8).toUpperCase()}`;
  return d.kind === 'bill' ? `IV-${prefix}${d.room_number}-${d.period}` : `IVF-${prefix}${d.room_number}-${d.id.slice(0, 6).toUpperCase()}`;
}
export const receiptRef = (paymentId: string) => `RC-${paymentId.slice(0, 8).toUpperCase()}`;

export function invoiceDate(d: ReceivableDoc, basis: MangoProfile['options']['invoice_date_basis']): string {
  return basis === 'month_end' ? monthEnd(d.period) : thDate(d.issued_at);
}

const merge = (lines: JournalLine[]): JournalLine[] => {
  // lines of the same side, account and description collapse into one; sources stay traceable via the voucher
  const out: JournalLine[] = [];
  for (const l of lines) {
    const hit = out.find(o => o.account === l.account && o.description === l.description && o.ref_no === l.ref_no
      && (o.dr_satang > 0) === (l.dr_satang > 0) && o.option_code === l.option_code && o.customer_code === l.customer_code
      && (o.party_id ?? null) === (l.party_id ?? null));
    if (hit) { hit.dr_satang += l.dr_satang; hit.cr_satang += l.cr_satang; } else out.push({ ...l });
  }
  return out;
};

function finish(v: Omit<Voucher, 'total_dr_satang' | 'total_cr_satang'>, problems: Problem[], src: Problem['source']): Voucher | null {
  const dr = v.lines.reduce((s, l) => s + l.dr_satang, 0);
  const cr = v.lines.reduce((s, l) => s + l.cr_satang, 0);
  if (dr !== cr) { problems.push({ code: 'voucher_unbalanced', message: `${PROBLEM_LABELS_TH.voucher_unbalanced} (${fromSatang(dr)} ≠ ${fromSatang(cr)})`, source: src }); return null; }
  if (v.lines.some(l => l.dr_satang > 0 && l.cr_satang > 0)) { problems.push({ code: 'invalid_amount', message: PROBLEM_LABELS_TH.invalid_amount, source: src }); return null; }
  return { ...v, total_dr_satang: dr, total_cr_satang: cr };
}

/** Build the vouchers for one export run. Never throws; anything it cannot post becomes a problem or an exclusion. */
export function buildVouchers(input: PostingInput): PostingResult {
  const { profile, kind, from, to, docs, payments, exported } = input;
  const vouchers: Voucher[] = [];
  const problems: Problem[] = [];
  const excluded: Excluded[] = [];
  const entity = profile.id;
  const docById = new Map(docs.map(d => [`${d.kind}:${d.id}`, d]));
  const cutoff = profile.options.opening_cutoff_month;
  const customerOf = (roomId: string) => profile.customers[roomId]?.code?.trim() || '';
  const needCode = input.requireCustomerCode !== false;

  if (kind === 'invoice') {
    for (const d of docs) {
      const src = { kind: d.kind, id: d.id, label: label(d) };
      if (d.status !== 'issued') { excluded.push({ source: src, reason: d.status }); continue; }
      if (cutoff && d.period < cutoff) { excluded.push({ source: src, reason: 'before_cutoff' }); continue; }
      const date = invoiceDate(d, profile.options.invoice_date_basis);
      if (!date || date < from || date > to) continue; // outside the requested period: not an exclusion, just not part of this run
      if (d.total_satang === 0) { excluded.push({ source: src, reason: 'zero_amount' }); continue; }

      const before = exported.get(`invoice:${d.kind}:${d.id}`);
      if (before === d.revision) { excluded.push({ source: src, reason: 'already_exported' }); continue; }
      if (before !== undefined) { problems.push({ code: 'revised_after_export', message: PROBLEM_LABELS_TH.revised_after_export, source: src }); continue; }

      const own: Problem[] = [];
      if (!Number.isFinite(d.total_satang) || d.lines.some(l => !Number.isInteger(l.amount_satang) || l.amount_satang <= 0)) {
        own.push({ code: 'invalid_amount', message: PROBLEM_LABELS_TH.invalid_amount, source: src });
      } else if (d.lines.reduce((s, l) => s + l.amount_satang, 0) !== d.total_satang) {
        own.push({ code: 'total_mismatch', message: PROBLEM_LABELS_TH.total_mismatch, source: src });
      }
      const code = customerOf(d.room_id);
      if (!code && needCode) own.push({ code: 'no_customer_code', message: `${PROBLEM_LABELS_TH.no_customer_code} (${d.room_number})`, source: src });
      for (const cat of new Set(d.lines.map(l => l.category))) {
        if (!profile.revenue_accounts[cat]?.trim()) own.push({ code: 'no_revenue_account', message: `${PROBLEM_LABELS_TH.no_revenue_account}: ${REVENUE_CATEGORY_LABELS_TH[cat]}`, source: src });
      }
      if (own.length) { problems.push(...own); continue; }

      const ref = docRef(d);
      const common = { ref_no: ref, ref_date: date };
      const lines = merge([
        { account: profile.codes.ar_account, dr_satang: d.total_satang, cr_satang: 0, description: `REF : ${ref}`, customer_code: code || null, option_code: null, party_id: d.room_id, ...common },
        ...d.lines.map(l => ({
          account: profile.revenue_accounts[l.category]!, dr_satang: 0, cr_satang: l.amount_satang,
          description: `${REVENUE_CATEGORY_LABELS_TH[l.category]} ${d.room_number} ${d.period}`,
          customer_code: profile.options.customer_code_all_lines && code ? code : null, option_code: null, party_id: null, ...common,
        })),
      ]);
      const v = finish({
        key: `${entity}|invoice|${d.kind}:${d.id}|${d.revision}`, kind: 'invoice', doc_ref: ref, voucher_date: date,
        remark1: profile.remarks.invoice, customer_code: code, customer_name: d.customer_name, customer_tel: d.customer_tel, room_number: d.room_number, lines,
        sources: [{ kind: d.kind, id: d.id, revision: d.revision }],
      }, problems, src);
      if (v) vouchers.push(v);
    }
    return { vouchers, problems, excluded };
  }

  // ── receipts ──
  for (const p of payments) {
    const src = { kind: 'payment' as const, id: p.id, label: `รับเงิน ${receiptRef(p.id)}` };
    if (p.status === 'void') { excluded.push({ source: src, reason: 'void' }); continue; }
    if (p.verification === 'rejected') { excluded.push({ source: src, reason: 'rejected' }); continue; }
    const counts = p.method === 'cash' || p.verification === 'verified'
      || (profile.options.count_unverified_transfers && p.method === 'bank_transfer');
    if (!counts) { excluded.push({ source: src, reason: 'unverified' }); continue; }
    const date = thDate(p.paid_at);
    if (!date || date < from || date > to) continue;

    const before = exported.get(`receipt:payment:${p.id}`);
    if (before === p.revision) { excluded.push({ source: src, reason: 'already_exported' }); continue; }
    if (before !== undefined) { problems.push({ code: 'revised_after_export', message: PROBLEM_LABELS_TH.revised_after_export, source: src }); continue; }

    const own: Problem[] = [];
    const allocated = p.allocations.reduce((s, a) => s + a.amount_satang, 0);
    if (!Number.isInteger(p.gross_satang) || p.gross_satang <= 0 || p.allocations.some(a => !Number.isInteger(a.amount_satang) || a.amount_satang <= 0)) {
      own.push({ code: 'invalid_amount', message: PROBLEM_LABELS_TH.invalid_amount, source: src });
    } else if (allocated < p.gross_satang) own.push({ code: 'unallocated_remainder', message: PROBLEM_LABELS_TH.unallocated_remainder, source: src });
    else if (allocated > p.gross_satang) own.push({ code: 'over_allocated', message: PROBLEM_LABELS_TH.over_allocated, source: src });

    const channel = profile.channels[p.channel];
    if (!channel?.account?.trim()) own.push({ code: 'no_channel_account', message: `${PROBLEM_LABELS_TH.no_channel_account} (${p.channel})`, source: src });

    const targets: ReceivableDoc[] = [];
    for (const a of p.allocations) {
      const d = docById.get(`${a.target_kind}:${a.target_id}`);
      if (!d) { own.push({ code: 'allocation_target_missing', message: PROBLEM_LABELS_TH.allocation_target_missing, source: src }); continue; }
      if (d.status === 'cancelled') { own.push({ code: 'allocation_cancelled', message: `${PROBLEM_LABELS_TH.allocation_cancelled}: ${label(d)}`, source: src }); continue; }
      const inMango = exported.has(`invoice:${d.kind}:${d.id}`) || (cutoff !== null && d.period < cutoff);
      if (!inMango) own.push({ code: 'invoice_not_in_mango', message: `${PROBLEM_LABELS_TH.invoice_not_in_mango}: ${label(d)}`, source: src });
      targets.push(d);
    }
    const codes = new Set(targets.map(t => customerOf(t.room_id)));
    if (targets.length && codes.size > 1) own.push({ code: 'multi_customer_payment', message: PROBLEM_LABELS_TH.multi_customer_payment, source: src });
    else if (targets.length && needCode && ![...codes][0]) own.push({ code: 'no_customer_code', message: `${PROBLEM_LABELS_TH.no_customer_code} (${targets[0].room_number})`, source: src });
    if (own.length) { problems.push(...own); continue; }

    const code = [...codes][0];
    const ref = receiptRef(p.id);
    const lines = merge([
      { account: channel!.account, dr_satang: p.gross_satang, cr_satang: 0, description: `REF : ${ref}`, ref_no: ref, ref_date: date, customer_code: profile.options.customer_code_all_lines && code ? code : null, option_code: channel!.option_code, party_id: null },
      ...p.allocations.map((a, i) => {
        const d = targets[i];
        return { account: profile.codes.ar_account, dr_satang: 0, cr_satang: a.amount_satang, description: `REF : ${docRef(d)}`, ref_no: docRef(d), ref_date: invoiceDate(d, profile.options.invoice_date_basis), customer_code: code || null, option_code: null, party_id: d.room_id };
      }),
    ]);
    const v = finish({
      key: `${entity}|receipt|payment:${p.id}|${p.revision}`, kind: 'receipt', doc_ref: ref, voucher_date: date,
      remark1: profile.remarks.receipt, customer_code: code, customer_name: targets[0].customer_name, customer_tel: targets[0].customer_tel, room_number: targets[0].room_number, lines,
      sources: [{ kind: 'payment', id: p.id, revision: p.revision }],
    }, problems, src);
    if (v) vouchers.push(v);
  }
  return { vouchers, problems, excluded };
}

export const sumDr = (vs: Voucher[]) => vs.reduce((s, v) => s + v.total_dr_satang, 0);
export const sumCr = (vs: Voucher[]) => vs.reduce((s, v) => s + v.total_cr_satang, 0);

// ── Export batches (as stored by the API) ────────────────────────────────────

export interface ExportBatch {
  id: string;
  profile_id: string;
  kind: VoucherKind;
  from: string;
  to: string;
  template_version: string;
  file_name: string;
  status: 'ready';
  import_outcome: 'unknown' | 'confirmed' | 'failed' | 'partial';
  import_note: string | null;
  import_by?: string;
  import_at?: string;
  vouchers_count: number;
  lines_count: number;
  dr_satang: number;
  cr_satang: number;
  created_at: string;
  created_by_name: string;
}

export const IMPORT_OUTCOME_LABELS_TH: Record<ExportBatch['import_outcome'], string> = {
  unknown: 'ยังไม่ทราบผลนำเข้า', confirmed: 'นำเข้า Mango สำเร็จ', failed: 'นำเข้าล้มเหลว', partial: 'นำเข้าบางส่วน',
};
