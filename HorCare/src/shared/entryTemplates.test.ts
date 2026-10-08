import { describe, expect, it } from 'vitest';
import { expenseLines, openingBalanceLines, payablePaymentLines, vatSplit, whtOf } from './entryTemplates';
import { balanceSheet, defaultChart, payablesByParty, profitAndLoss, validateEntryLines, type EntryLine, type JournalEntry } from './ledger';

const chart = defaultChart();
let n = 0;
const entry = (date: string, lines: EntryLine[]): JournalEntry => ({
  id: `e${++n}`, ledger_id: 'L', kind: 'manual', key: `k${n}`, doc_ref: `D${n}`, date, memo: 'x', lines,
  total_satang: lines.reduce((s, l) => s + l.dr_satang, 0), sources: [], posted_at: `${date}T00:00:00Z`, posted_by: 'u', posted_by_name: 'U',
});
const sumDr = (l: EntryLine[]) => l.reduce((s, x) => s + x.dr_satang, 0);
const sumCr = (l: EntryLine[]) => l.reduce((s, x) => s + x.cr_satang, 0);

describe('VAT and withholding tax arithmetic', () => {
  it('splits a price that already includes 7% VAT, and adds VAT on top of one that does not', () => {
    expect(vatSplit(107000, 'inclusive')).toEqual({ net_satang: 100000, vat_satang: 7000, gross_satang: 107000 });
    expect(vatSplit(100000, 'exclusive')).toEqual({ net_satang: 100000, vat_satang: 7000, gross_satang: 107000 });
    const odd = vatSplit(12345, 'inclusive'); // rounding never loses a satang
    expect(odd.net_satang + odd.vat_satang).toBe(12345);
  });
  it('withholds a percentage of the base, rounded to the satang', () => {
    expect(whtOf(100000, 3)).toBe(3000);
    expect(whtOf(33333, 3)).toBe(1000);
    expect(whtOf(0, 3)).toBe(0);
  });
});

describe('guided entries are always balanced and valid against the chart', () => {
  it('an expense paid now, with input VAT', () => {
    const l = expenseLines({ expenseAccount: '5101', counterAccount: '1101', amountSatang: 107000, description: 'ซ่อมแอร์', vat: { mode: 'inclusive', account: '1160' } });
    expect(l.map(x => [x.account, x.dr_satang, x.cr_satang])).toEqual([['5101', 100000, 0], ['1160', 7000, 0], ['1101', 0, 107000]]);
    expect(validateEntryLines(l, chart)).toEqual([]);
  });
  it('an expense owed to a supplier is tracked per supplier', () => {
    const l = expenseLines({ expenseAccount: '5101', counterAccount: '2110', amountSatang: 50000, description: 'ค่าซักผ้า', supplier: 'ร้านซักรีด' });
    expect(l).toHaveLength(2);
    expect(l[1].party_id).toBe('ร้านซักรีด');
    expect(validateEntryLines(l, chart)).toEqual([]);
  });
  it('paying a supplier with 3% withholding: they receive less, the tax is owed to the Revenue Department', () => {
    const l = payablePaymentLines({ payableAccount: '2110', payAccount: '1102', amountSatang: 100000, description: 'จ่ายค่าบริการ', supplier: 'ช่างเอ', wht: { ratePct: 3, baseSatang: 100000, account: '2210' } });
    expect(l.map(x => [x.account, x.dr_satang, x.cr_satang])).toEqual([['2110', 100000, 0], ['1102', 0, 97000], ['2210', 0, 3000]]);
    expect(sumDr(l)).toBe(sumCr(l));
    expect(validateEntryLines(l, chart)).toEqual([]);
  });
  it('withholding is on the price before VAT, not on the VAT', () => {
    const l = payablePaymentLines({ payableAccount: '2110', payAccount: '1102', amountSatang: 107000, description: 'x', wht: { ratePct: 3, baseSatang: 100000, account: '2210' } });
    expect(l[2].cr_satang).toBe(3000);
    expect(sumDr(l)).toBe(sumCr(l));
  });
  it('opening balances are completed with the owner\'s equity, whichever way they lean', () => {
    const up = openingBalanceLines([{ account: '1101', debitSatang: 500000, creditSatang: 0 }, { account: '2110', debitSatang: 0, creditSatang: 100000, party: 'ช่างเอ' }], '3101');
    expect(up.at(-1)).toMatchObject({ account: '3101', cr_satang: 400000 });
    expect(sumDr(up)).toBe(sumCr(up));
    const down = openingBalanceLines([{ account: '1101', debitSatang: 100000, creditSatang: 0 }, { account: '2102', debitSatang: 0, creditSatang: 300000 }], '3101');
    expect(down.at(-1)).toMatchObject({ account: '3101', dr_satang: 200000 });
    expect(openingBalanceLines([{ account: '1101', debitSatang: 0, creditSatang: 0 }], '3101')).toEqual([]);
    expect(validateEntryLines(up, chart)).toEqual([]);
  });
});

describe('profit and loss, balance sheet, payables', () => {
  const entries = [
    entry('2026-09-01', openingBalanceLines([{ account: '1102', debitSatang: 1000000, creditSatang: 0 }], '3101')),
    entry('2026-09-10', [{ account: '1101', dr_satang: 300000, cr_satang: 0, description: 'รับค่าเช่า', party_id: null }, { account: '4101', dr_satang: 0, cr_satang: 300000, description: 'ค่าเช่า', party_id: null }]),
    entry('2026-09-12', expenseLines({ expenseAccount: '5101', counterAccount: '2110', amountSatang: 80000, description: 'ซ่อม', supplier: 'ช่างเอ' })),
    entry('2026-10-02', expenseLines({ expenseAccount: '5101', counterAccount: '1101', amountSatang: 20000, description: 'น้ำดื่ม' })),
  ];

  it('P&L covers only the period asked for', () => {
    const sep = profitAndLoss(entries, chart, '2026-09-01', '2026-09-30');
    expect(sep.revenue_satang).toBe(300000);
    expect(sep.expense_satang).toBe(80000);
    expect(sep.net_satang).toBe(220000);
    expect(sep.revenue[0].account.code).toBe('4101');
    expect(profitAndLoss(entries, chart, '2026-10-01', '2026-10-31').net_satang).toBe(-20000);
    expect(profitAndLoss(entries, chart, '2027-01-01', '2027-01-31')).toMatchObject({ revenue: [], expenses: [], net_satang: 0 });
  });

  it('the balance sheet balances once current earnings are shown, at any date', () => {
    for (const asOf of ['2026-09-05', '2026-09-30', '2026-10-31']) {
      const bs = balanceSheet(entries, chart, asOf);
      expect(bs.balanced).toBe(true);
    }
    const bs = balanceSheet(entries, chart, '2026-09-30');
    expect(bs.assets_satang).toBe(1300000);
    expect(bs.liabilities_satang).toBe(80000);
    expect(bs.equity_satang).toBe(1000000);
    expect(bs.earnings_satang).toBe(220000);
  });

  it('shows what is owed to each supplier and drops it once paid', () => {
    expect([...payablesByParty(entries, '2110')]).toEqual([['ช่างเอ', 80000]]);
    const paid = [...entries, entry('2026-10-05', payablePaymentLines({ payableAccount: '2110', payAccount: '1101', amountSatang: 80000, description: 'จ่าย', supplier: 'ช่างเอ' }))];
    expect(payablesByParty(paid, '2110').size).toBe(0);
    expect([...payablesByParty(paid, '2110', '2026-10-01')]).toEqual([['ช่างเอ', 80000]]); // as of before the payment
  });
});
