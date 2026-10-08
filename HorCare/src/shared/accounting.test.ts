import { describe, expect, it } from 'vitest';
import {
  buildVouchers, channelOf, emptyProfile, fromSatang, monthEnd, profileGaps, sumCr, sumDr, thDate, toSatang,
  type MangoProfile, type PaymentRec, type ReceivableDoc,
} from './accounting';

const profile = (over: Partial<MangoProfile> = {}): MangoProfile => {
  const p = emptyProfile('prof-1');
  return {
    ...p, legal_entity_name: 'บริษัททดสอบ', template_version: 'v-test', property_ids: ['b1'],
    codes: { ...p.codes, ar_account: 'AR-X', project: 'PRJ', job: 'JOB' },
    revenue_accounts: { rent: 'REV-RENT', electric: 'REV-ELEC', water: 'REV-WATER', common_fee: 'REV-COMMON', fine: 'REV-FINE' },
    channels: { cash: { account: 'CASH-X', option_code: null }, 'bank:acc1': { account: 'BANK-1', option_code: 'OPT-1' }, 'bank:acc2': { account: 'BANK-2', option_code: 'OPT-2' } },
    customers: { r1: { code: 'C-001' }, r2: { code: 'C-002' } },
    ...over,
  };
};
const bill = (over: Partial<ReceivableDoc> = {}): ReceivableDoc => ({
  kind: 'bill', id: 'b-r1-1010', room_id: 'r1', room_number: 'A01', period: '2026-10', issued_at: '2026-10-05T03:00:00Z', status: 'issued',
  lines: [{ category: 'rent', amount_satang: 300000 }, { category: 'water', amount_satang: 10000 }, { category: 'electric', amount_satang: 40000 }],
  total_satang: 350000, revision: 'rev1', ...over,
});
const pay = (over: Partial<PaymentRec> = {}): PaymentRec => ({
  id: 'pay00001-xxxx', room_id: 'r1', channel: 'cash', method: 'cash', paid_at: '2026-10-10T03:00:00Z', gross_satang: 350000,
  verification: 'n/a', status: 'active', allocations: [{ target_kind: 'bill', target_id: 'b-r1-1010', amount_satang: 350000 }], revision: 'p1', ...over,
});
const run = (kind: 'invoice' | 'receipt', o: { profile?: MangoProfile; docs?: ReceivableDoc[]; payments?: PaymentRec[]; exported?: [string, string][]; from?: string; to?: string } = {}) =>
  buildVouchers({
    profile: o.profile ?? profile(), kind, from: o.from ?? '2026-10-01', to: o.to ?? '2026-10-31',
    docs: o.docs ?? [bill()], payments: o.payments ?? [pay()], exported: new Map(o.exported ?? [['invoice:bill:b-r1-1010', 'rev1']]),
  });

describe('money and dates', () => {
  it('converts to integer satang without float drift', () => {
    expect(toSatang(0.1 + 0.2)).toBe(30);
    expect(toSatang(1234.565)).toBe(123457);
    expect(toSatang(-2.5)).toBe(-250);
    expect(Number.isNaN(toSatang(NaN))).toBe(true);
    expect(fromSatang(350000)).toBe(3500);
  });
  it('uses the Thai calendar day around midnight (AT-17)', () => {
    expect(thDate('2026-10-31T16:59:59Z')).toBe('2026-10-31');
    expect(thDate('2026-10-31T17:00:00Z')).toBe('2026-11-01');
    expect(monthEnd('2026-02')).toBe('2026-02-28');
    expect(monthEnd('2028-02')).toBe('2028-02-29');
  });
  it('channel keys', () => {
    expect(channelOf('cash')).toBe('cash');
    expect(channelOf('bank_transfer', 'acc1')).toBe('bank:acc1');
    expect(channelOf('bank_transfer')).toBe('bank:unknown');
  });
});

describe('profileGaps', () => {
  it('a fresh profile lists what is missing; a filled one has none', () => {
    const codes = profileGaps(emptyProfile('x')).map(g => g.code);
    expect(codes).toEqual(expect.arrayContaining(['entity', 'template', 'properties', 'ar_account', 'dimension']));
    expect(profileGaps(profile())).toEqual([]);
  });
  it('accepts Department instead of Project+Job, but not Project alone', () => {
    const base = profile();
    expect(profileGaps({ ...base, codes: { ...base.codes, job: null, department: 'D1' } })).toEqual([]);
    expect(profileGaps({ ...base, codes: { ...base.codes, job: null } }).map(g => g.code)).toContain('dimension');
  });
  it('validates the cut-off month', () => {
    const base = profile();
    expect(profileGaps({ ...base, options: { ...base.options, opening_cutoff_month: '2026-13' } }).map(g => g.code)).toContain('cutoff');
  });
});

describe('invoices (AT-01, AT-02)', () => {
  it('a bill becomes one balanced voucher: Dr receivable, Cr each revenue category', () => {
    const r = run('invoice', { exported: [] });
    expect(r.problems).toEqual([]);
    expect(r.vouchers).toHaveLength(1);
    const v = r.vouchers[0];
    expect(v).toMatchObject({ doc_ref: 'IV-A01-2026-10', voucher_date: '2026-10-05', customer_code: 'C-001', remark1: 'บันทึกตั้งลูกหนี้' });
    expect(v.lines.map(l => [l.account, l.dr_satang, l.cr_satang])).toEqual([
      ['AR-X', 350000, 0], ['REV-RENT', 0, 300000], ['REV-WATER', 0, 10000], ['REV-ELEC', 0, 40000],
    ]);
    expect(sumDr(r.vouchers)).toBe(sumCr(r.vouchers));
    expect(v.lines[0].customer_code).toBe('C-001');
    expect(v.lines[1].customer_code).toBeNull();
  });

  it('puts the customer code on every line when the profile says so', () => {
    const p = profile(); p.options.customer_code_all_lines = true;
    expect(run('invoice', { profile: p, exported: [] }).vouchers[0].lines.every(l => l.customer_code === 'C-001')).toBe(true);
  });

  it('a 100 baht bill is one voucher of 100, not a copy of the sample rows (AT-01)', () => {
    const r = run('invoice', { exported: [], docs: [bill({ lines: [{ category: 'rent', amount_satang: 10000 }], total_satang: 10000 })] });
    expect(r.vouchers).toHaveLength(1);
    expect(r.vouchers[0].total_dr_satang).toBe(10000);
  });

  it('uses the month-end date when the profile asks for it', () => {
    const p = profile(); p.options.invoice_date_basis = 'month_end';
    expect(run('invoice', { profile: p, exported: [] }).vouchers[0].voucher_date).toBe('2026-10-31');
  });

  it('respects the period: Thai dates, inclusive on both ends', () => {
    const edge = bill({ issued_at: '2026-10-31T16:59:00Z' });
    expect(run('invoice', { exported: [], docs: [edge], to: '2026-10-31' }).vouchers).toHaveLength(1);
    const next = bill({ issued_at: '2026-10-31T17:00:00Z' });
    expect(run('invoice', { exported: [], docs: [next], to: '2026-10-31' }).vouchers).toHaveLength(0);
    expect(run('invoice', { exported: [], docs: [next], from: '2026-11-01', to: '2026-11-30' }).vouchers).toHaveLength(1);
  });

  it('excludes drafts, cancelled, pre-cutoff and already-exported documents with a reason (AT-08)', () => {
    const p = profile(); p.options.opening_cutoff_month = '2026-10';
    const r = run('invoice', { exported: [['invoice:bill:done', 'x']], docs: [
      bill({ id: 'd', status: 'draft' }), bill({ id: 'c', status: 'cancelled' }), bill({ id: 'o', period: '2026-09', issued_at: '2026-10-02T00:00:00Z' }),
      bill({ id: 'done', revision: 'x' }),
    ], profile: p });
    expect(r.vouchers).toHaveLength(0);
    expect(r.excluded.map(e => e.reason).sort()).toEqual(['already_exported', 'before_cutoff', 'cancelled', 'draft']);
  });

  it('blocks a bill edited after export instead of silently re-posting it', () => {
    const r = run('invoice', { exported: [['invoice:bill:b-r1-1010', 'old']] });
    expect(r.vouchers).toHaveLength(0);
    expect(r.problems[0].code).toBe('revised_after_export');
  });

  it('blocks missing mappings and says which (AT-07)', () => {
    const p = profile({ customers: {}, revenue_accounts: { rent: 'REV-RENT' } });
    const codes = run('invoice', { profile: p, exported: [] }).problems.map(x => x.code);
    expect(codes).toEqual(expect.arrayContaining(['no_customer_code', 'no_revenue_account']));
  });

  it('blocks a bill whose parts do not add up to its total, and invalid amounts', () => {
    expect(run('invoice', { exported: [], docs: [bill({ total_satang: 350001 })] }).problems[0].code).toBe('total_mismatch');
    expect(run('invoice', { exported: [], docs: [bill({ lines: [{ category: 'rent', amount_satang: -100 }], total_satang: -100 })] }).problems[0].code).toBe('invalid_amount');
    expect(run('invoice', { exported: [], docs: [bill({ lines: [], total_satang: 0 })] }).excluded[0].reason).toBe('zero_amount');
  });

  it('a stable key per source + revision (idempotency)', () => {
    const a = run('invoice', { exported: [] }).vouchers[0].key;
    expect(a).toBe(run('invoice', { exported: [] }).vouchers[0].key);
    expect(a).not.toBe(run('invoice', { exported: [], docs: [bill({ revision: 'rev2' })] }).vouchers[0].key);
  });

  it('fines use their own document number and account', () => {
    const fine = bill({ kind: 'fine', id: 'abc123def', lines: [{ category: 'fine', amount_satang: 50000 }], total_satang: 50000 });
    const v = run('invoice', { exported: [], docs: [fine] }).vouchers[0];
    expect(v.doc_ref).toBe('IVF-A01-ABC123');
    expect(v.lines[1].account).toBe('REV-FINE');
  });
});

describe('receipts (AT-03, AT-04, AT-05)', () => {
  it('cash receipt: Dr cash, Cr receivable referencing the invoice', () => {
    const r = run('receipt');
    expect(r.problems).toEqual([]);
    const v = r.vouchers[0];
    expect(v.doc_ref).toBe('RC-PAY00001');
    expect(v.remark1).toBe('บันทึกตัดลูกหนี้');
    expect(v.lines.map(l => [l.account, l.dr_satang, l.cr_satang, l.ref_no])).toEqual([['CASH-X', 350000, 0, 'RC-PAY00001'], ['AR-X', 0, 350000, 'IV-A01-2026-10']]);
  });

  it('partial payment posts only what was received (AT-03)', () => {
    const r = run('receipt', { payments: [pay({ gross_satang: 150000, allocations: [{ target_kind: 'bill', target_id: 'b-r1-1010', amount_satang: 150000 }] })] });
    expect(r.vouchers[0].total_dr_satang).toBe(150000);
  });

  it('one payment settling two bills, and two payments on one bill (AT-04)', () => {
    const b2 = bill({ id: 'b2', period: '2026-09' });
    const two = run('receipt', {
      docs: [bill(), b2], exported: [['invoice:bill:b-r1-1010', 'rev1'], ['invoice:bill:b2', 'rev1']],
      payments: [pay({ gross_satang: 700000, allocations: [{ target_kind: 'bill', target_id: 'b-r1-1010', amount_satang: 350000 }, { target_kind: 'bill', target_id: 'b2', amount_satang: 350000 }] })],
    });
    expect(two.vouchers[0].lines.filter(l => l.cr_satang > 0).map(l => l.ref_no)).toEqual(['IV-A01-2026-10', 'IV-A01-2026-09']);
    const split = run('receipt', { payments: [
      pay({ id: 'p1aaaaaa', gross_satang: 100000, allocations: [{ target_kind: 'bill', target_id: 'b-r1-1010', amount_satang: 100000 }] }),
      pay({ id: 'p2bbbbbb', gross_satang: 250000, allocations: [{ target_kind: 'bill', target_id: 'b-r1-1010', amount_satang: 250000 }] }),
    ] });
    expect(split.vouchers).toHaveLength(2);
    expect(sumDr(split.vouchers)).toBe(350000);
  });

  it('each channel posts to its own account and option code (AT-05)', () => {
    const r = run('receipt', { payments: [
      pay({ id: 'p1aaaaaa', channel: 'bank:acc1', method: 'bank_transfer', verification: 'verified' }),
      pay({ id: 'p2bbbbbb', channel: 'bank:acc2', method: 'bank_transfer', verification: 'verified' }),
    ] });
    expect(r.vouchers.map(v => [v.lines[0].account, v.lines[0].option_code])).toEqual([['BANK-1', 'OPT-1'], ['BANK-2', 'OPT-2']]);
  });

  it('a slip read by AI but not confirmed against the bank is not money received (FR-07, AT-08)', () => {
    const slip = pay({ channel: 'bank:acc1', method: 'bank_transfer', verification: 'unverified' });
    expect(run('receipt', { payments: [slip] }).excluded[0].reason).toBe('unverified');
    const p = profile(); p.options.count_unverified_transfers = true;
    expect(run('receipt', { profile: p, payments: [slip] }).vouchers).toHaveLength(1);
    expect(run('receipt', { profile: p, payments: [{ ...slip, verification: 'rejected' }] }).excluded[0].reason).toBe('rejected');
    expect(run('receipt', { payments: [{ ...pay(), status: 'void' }] }).excluded[0].reason).toBe('void');
  });

  it('blocks money that is not fully allocated (advance/overpayment) or over-allocated', () => {
    expect(run('receipt', { payments: [pay({ gross_satang: 400000 })] }).problems[0].code).toBe('unallocated_remainder');
    expect(run('receipt', { payments: [pay({ gross_satang: 300000 })] }).problems[0].code).toBe('over_allocated');
  });

  it('blocks when the invoice was never sent to Mango, or allocation targets are missing/cancelled', () => {
    expect(run('receipt', { exported: [] }).problems[0].code).toBe('invoice_not_in_mango');
    expect(run('receipt', { docs: [] }).problems[0].code).toBe('allocation_target_missing');
    expect(run('receipt', { docs: [bill({ status: 'cancelled' })] }).problems[0].code).toBe('allocation_cancelled');
  });

  it('opening balances before the cut-off do not need an exported invoice', () => {
    const p = profile(); p.options.opening_cutoff_month = '2026-11';
    expect(run('receipt', { profile: p, exported: [] }).vouchers).toHaveLength(1);
  });

  it('blocks a channel without an account and a payment split across customers', () => {
    expect(run('receipt', { profile: profile({ channels: {} }) }).problems.map(x => x.code)).toContain('no_channel_account');
    const other = bill({ id: 'b9', room_id: 'r2', room_number: 'A02' });
    const r = run('receipt', {
      docs: [bill(), other], exported: [['invoice:bill:b-r1-1010', 'rev1'], ['invoice:bill:b9', 'rev1']],
      payments: [pay({ gross_satang: 700000, allocations: [{ target_kind: 'bill', target_id: 'b-r1-1010', amount_satang: 350000 }, { target_kind: 'bill', target_id: 'b9', amount_satang: 350000 }] })],
    });
    expect(r.problems[0].code).toBe('multi_customer_payment');
  });

  it('already exported or revised payments are not posted twice', () => {
    expect(run('receipt', { exported: [['invoice:bill:b-r1-1010', 'rev1'], ['receipt:payment:pay00001-xxxx', 'p1']] }).excluded[0].reason).toBe('already_exported');
    expect(run('receipt', { exported: [['invoice:bill:b-r1-1010', 'rev1'], ['receipt:payment:pay00001-xxxx', 'older']] }).problems[0].code).toBe('revised_after_export');
  });

  it('receipts honour the payment date window in Thai time', () => {
    expect(run('receipt', { payments: [pay({ paid_at: '2026-10-31T17:00:00Z' })], to: '2026-10-31' }).vouchers).toHaveLength(0);
  });
});