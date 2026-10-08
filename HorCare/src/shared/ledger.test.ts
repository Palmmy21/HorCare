import { describe, expect, it } from 'vitest';
import {
  accountLedger, defaultChart, emptyLedger, isLocked, ledgerGaps, normalSide, postedSources, postingProfile, receivablesByParty,
  revenueByAccount, reversalLines, trialBalance, trialTotals, validateChart, validateEntryLines,
  type EntryLine, type JournalEntry,
} from './ledger';

const line = (account: string, dr: number, cr: number, party: string | null = null): EntryLine => ({ account, dr_satang: dr, cr_satang: cr, description: 'x', party_id: party });
let n = 0;
const entry = (date: string, lines: EntryLine[], over: Partial<JournalEntry> = {}): JournalEntry => ({
  id: `e${++n}`, ledger_id: 'L', kind: 'manual', key: `k${n}`, doc_ref: `D${n}`, date, memo: '', lines,
  total_satang: lines.reduce((s, l) => s + l.dr_satang, 0), sources: [], posted_at: `${date}T00:00:0${n % 10}Z`, posted_by: 'u', posted_by_name: 'U', ...over,
});
const chart = defaultChart();

describe('chart', () => {
  it('the default chart is valid and has the roles a rental needs', () => {
    expect(validateChart(chart)).toEqual([]);
    const types = new Set(chart.map(a => a.type));
    expect([...types].sort()).toEqual(['asset', 'equity', 'expense', 'liability', 'revenue']);
  });
  it('rejects duplicate (case-insensitive), malformed and unnamed accounts', () => {
    const bad = [...chart, { code: '1101', name: 'ซ้ำ', type: 'asset' as const, active: true }, { code: 'x y', name: 'a', type: 'asset' as const, active: true }, { code: '9999', name: ' ', type: 'asset' as const, active: true }];
    const msgs = validateChart(bad).map(i => i.message).join('|');
    expect(msgs).toContain('ซ้ำ');
    expect(msgs).toContain('"x y"');
    expect(msgs).toContain('9999');
    expect(validateChart([]).length).toBe(1);
  });
  it('assets and expenses are debit-normal', () => {
    expect([normalSide('asset'), normalSide('expense'), normalSide('liability'), normalSide('revenue'), normalSide('equity')]).toEqual(['debit', 'debit', 'credit', 'credit', 'credit']);
  });
});

describe('ledgerGaps / postingProfile', () => {
  const ready = () => ({ ...emptyLedger('L'), legal_entity_name: 'บจก.', property_ids: ['b1'] });
  it('a fresh ledger lists what is missing; a complete one has none', () => {
    expect(ledgerGaps(emptyLedger('L')).map(g => g.code)).toEqual(expect.arrayContaining(['entity', 'properties']));
    expect(ledgerGaps(ready())).toEqual([]);
  });
  it('flags posting roles that point at missing, closed or wrongly-typed accounts', () => {
    const l = ready();
    l.posting.ar_account = '4101'; // a revenue account used as receivable
    l.posting.revenue_accounts.rent = '9999';
    l.accounts = l.accounts.map(a => (a.code === '1101' ? { ...a, active: false } : a));
    const msgs = ledgerGaps(l).map(g => g.message).join('|');
    expect(msgs).toContain('ไม่ใช่ประเภท');
    expect(msgs).toContain('ยังไม่ได้กำหนดบัญชีสำหรับ รายได้ (rent)');
    expect(msgs).toContain('ถูกปิดใช้งาน');
  });
  it('builds the posting settings the engine reads; no customer codes needed', () => {
    const p = postingProfile(ready());
    expect(p.codes.ar_account).toBe('1140');
    expect(p.revenue_accounts.rent).toBe('4101');
    expect(p.channels.cash).toEqual({ account: '1101', option_code: null });
    expect(p.customers).toEqual({});
  });
});

describe('validateEntryLines', () => {
  it('accepts a balanced entry', () => {
    expect(validateEntryLines([line('1101', 10000, 0), line('4101', 0, 10000)], chart)).toEqual([]);
  });
  it('rejects unbalanced, one-line, both-sided, zero, unknown, inactive and fractional lines', () => {
    const msgs = (ls: EntryLine[], c = chart) => validateEntryLines(ls, c).map(i => i.message).join('|');
    expect(msgs([line('1101', 100, 0), line('4101', 0, 99)])).toContain('ไม่เท่า');
    expect(msgs([line('1101', 100, 0)])).toContain('อย่างน้อย 2');
    expect(msgs([line('1101', 100, 100), line('4101', 0, 0)])).toContain('ด้านใดด้านหนึ่ง');
    expect(msgs([line('1101', 0, 0), line('4101', 0, 0)])).toContain('ศูนย์');
    expect(msgs([line('9999', 100, 0), line('4101', 0, 100)])).toContain('ไม่พบบัญชี');
    expect(msgs([line('1101', 100, 0), line('4101', 0, 100)], chart.map(a => (a.code === '4101' ? { ...a, active: false } : a)))).toContain('ปิดใช้งาน');
    expect(msgs([line('1101', 10.5, 0), line('4101', 0, 10.5)])).toContain('ไม่ถูกต้อง');
    expect(msgs([line('1101', -5, 0), line('4101', 0, -5)])).toContain('ไม่ถูกต้อง');
  });
  it('limits the number of lines', () => {
    const many = Array.from({ length: 101 }, () => line('1101', 1, 0));
    expect(validateEntryLines(many, chart).map(i => i.message).join('|')).toContain('ไม่เกิน 100');
  });
});

describe('periods and reversal', () => {
  it('a day on or before the lock is closed', () => {
    expect(isLocked('2026-09-30', '2026-09-30')).toBe(true);
    expect(isLocked('2026-10-01', '2026-09-30')).toBe(false);
    expect(isLocked('2020-01-01', null)).toBe(false);
  });
  it('reversal swaps sides and keeps the entry balanced', () => {
    const orig = [line('1140', 10000, 0, 'r1'), line('4101', 0, 10000)];
    const rev = reversalLines(orig);
    expect(rev.map(l => [l.account, l.dr_satang, l.cr_satang])).toEqual([['1140', 0, 10000], ['4101', 10000, 0]]);
    expect(rev[0].party_id).toBe('r1');
    expect(validateEntryLines(rev, chart)).toEqual([]);
  });
});

describe('postedSources', () => {
  const sys = (kind: 'invoice' | 'receipt', src: JournalEntry['sources'], over: Partial<JournalEntry> = {}) => entry('2026-10-05', [line('1140', 1, 0), line('4101', 0, 1)], { kind, sources: src, ...over });
  it('maps posted documents to their revision and ignores reversed, reversal and manual entries', () => {
    const m = postedSources([
      sys('invoice', [{ kind: 'bill', id: 'b1', revision: 'r1' }]),
      sys('invoice', [{ kind: 'bill', id: 'b2', revision: 'r2' }], { reversed_by: 'x' }),
      sys('receipt', [{ kind: 'payment', id: 'p1', revision: 'pr' }]),
      entry('2026-10-05', [line('1140', 1, 0), line('4101', 0, 1)], { kind: 'reversal', sources: [{ kind: 'bill', id: 'b3', revision: 'r3' }] }),
    ]);
    expect([...m]).toEqual([['invoice:bill:b1', 'r1'], ['receipt:payment:p1', 'pr']]);
  });
});

describe('reports', () => {
  const es = [
    entry('2026-09-30', [line('1140', 350000, 0, 'r1'), line('4101', 0, 300000), line('4103', 0, 50000)]),
    entry('2026-10-10', [line('1101', 150000, 0), line('1140', 0, 150000, 'r1')]),
    entry('2026-10-20', [line('1140', 200000, 0, 'r2'), line('4101', 0, 200000)]),
  ];
  it('trial balance debits equal credits and balances sit on the normal side', () => {
    const rows = trialBalance(es, chart);
    const t = trialTotals(rows);
    expect(t.dr_satang).toBe(t.cr_satang);
    const ar = rows.find(r => r.account.code === '1140')!;
    expect([ar.dr_satang, ar.cr_satang, ar.balance_satang]).toEqual([550000, 150000, 400000]);
    expect(rows.find(r => r.account.code === '4101')!.balance_satang).toBe(500000);
  });
  it('as-of date excludes later entries', () => {
    expect(trialBalance(es, chart, '2026-09-30').find(r => r.account.code === '1140')!.balance_satang).toBe(350000);
  });
  it('lines on an account that left the chart still show up', () => {
    const rows = trialBalance([entry('2026-10-01', [line('7777', 100, 0), line('4101', 0, 100)])], chart);
    expect(rows.some(r => r.account.code === '7777' && r.dr_satang === 100)).toBe(true);
    expect(trialTotals(rows).dr_satang).toBe(trialTotals(rows).cr_satang);
  });
  it('account ledger carries the opening balance and a running balance', () => {
    const ar = chart.find(a => a.code === '1140')!;
    const l = accountLedger(es, ar, '2026-10-01', '2026-10-31');
    expect(l.opening_satang).toBe(350000);
    expect(l.rows.map(r => r.running_satang)).toEqual([200000, 400000]);
    expect(l.closing_satang).toBe(400000);
  });
  it('receivables by party drop settled parties', () => {
    const m = receivablesByParty(es, '1140');
    expect([...m]).toEqual([['r1', 200000], ['r2', 200000]]);
    const paid = [...es, entry('2026-10-25', [line('1101', 200000, 0), line('1140', 0, 200000, 'r2')])];
    expect(receivablesByParty(paid, '1140').has('r2')).toBe(false);
    expect([...receivablesByParty(es, '1140', '2026-09-30')]).toEqual([['r1', 350000]]);
  });
  it('revenue for a period', () => {
    const r = revenueByAccount(es, chart, '2026-10-01', '2026-10-31');
    expect(r.map(x => [x.account.code, x.amount_satang])).toEqual([['4101', 200000]]);
  });
});