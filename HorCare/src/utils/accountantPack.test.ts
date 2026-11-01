import { describe, expect, it } from 'vitest';
import { defaultChart, emptyLedger, receivablesAging, type EntryLine, type JournalEntry } from '../shared/ledger';
import { accountantPack } from './accountantPack';
import { colName, crc32, sheetName, storedZip, workbookParts, xlsxBytes } from './xlsxWriter';

const line = (account: string, dr: number, cr: number, party: string | null = null): EntryLine => ({ account, dr_satang: dr, cr_satang: cr, description: 'x', party_id: party });
let n = 0;
const entry = (date: string, lines: EntryLine[], over: Partial<JournalEntry> = {}): JournalEntry => ({
  id: `e${++n}`, ledger_id: 'L', kind: 'manual', key: `k${n}`, doc_ref: `D${n}`, date, memo: 'm', lines,
  total_satang: lines.reduce((s, l) => s + l.dr_satang, 0), sources: [], posted_at: `${date}T00:00:0${n % 10}Z`, posted_by: 'u', posted_by_name: 'U', ...over,
});
const charge = (date: string, party: string, satang: number) => entry(date, [line('1140', satang, 0, party), line('4101', 0, satang)], { kind: 'invoice' });
const pay = (date: string, party: string, satang: number) => entry(date, [line('1101', satang, 0), line('1140', 0, satang, party)], { kind: 'receipt' });

describe('receivablesAging', () => {
  it('payments settle the oldest charges first; what is left is banded by age', () => {
    const rows = receivablesAging([
      charge('2026-06-01', 'r1', 300_00), charge('2026-08-15', 'r1', 300_00), charge('2026-10-01', 'r1', 300_00),
      pay('2026-10-05', 'r1', 400_00), // clears June, 100 off mid-August (77 days old)
    ], '1140', '2026-10-31');
    expect(rows).toHaveLength(1);
    expect(rows[0].buckets).toEqual({ '0-30': 300_00, '31-60': 0, '61-90': 200_00, '90+': 0 });
    expect(rows[0].total_satang).toBe(500_00);
  });

  it('a fully paid party drops out; an overpayment shows as a credit; entries after the date are ignored', () => {
    const rows = receivablesAging([
      charge('2026-10-01', 'paid', 100_00), pay('2026-10-02', 'paid', 100_00),
      charge('2026-10-01', 'over', 100_00), pay('2026-10-02', 'over', 150_00),
      charge('2026-11-05', 'later', 999_00),
    ], '1140', '2026-10-31');
    expect(rows.map(r => r.party_id)).toEqual(['over']);
    expect(rows[0].buckets['0-30']).toBe(-50_00);
  });

  it('puts charges older than 90 days in 90+', () => {
    expect(receivablesAging([charge('2026-01-01', 'r', 10_00)], '1140', '2026-10-31')[0].buckets['90+']).toBe(10_00);
  });
});

describe('xlsx writer', () => {
  it('crc32 and column names match the standards', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xCBF43926);
    expect([colName(0), colName(25), colName(26), colName(701)]).toEqual(['A', 'Z', 'AA', 'ZZ']);
  });

  it('cleans and de-duplicates sheet names', () => {
    const taken = new Set<string>();
    expect(sheetName('a/b:c', taken)).toBe('a b c');
    expect(sheetName('A B C', taken)).toBe('A B C 2');
    expect(sheetName('x'.repeat(40), taken)).toHaveLength(31);
  });

  it('writes a zip whose central directory lists every part', () => {
    const zip = storedZip({ 'a.txt': 'hi', 'ไทย.xml': '<x/>' });
    const dv = new DataView(zip.buffer);
    expect(dv.getUint32(0, true)).toBe(0x04034b50);
    const end = zip.length - 22;
    expect(dv.getUint32(end, true)).toBe(0x06054b50);
    expect(dv.getUint16(end + 10, true)).toBe(2);
  });

  it('escapes text, keeps numbers numeric and styles money with two decimals', () => {
    const parts = workbookParts([{ name: 'S', rows: [['<b>&"', 1.5, 2, null]], boldRows: [] }]);
    const xml = parts['xl/worksheets/sheet1.xml'];
    expect(xml).toContain('&lt;b&gt;&amp;&quot;');
    expect(xml).toContain('<c r="B1" s="1"><v>1.5</v></c>');
    expect(xml).toContain('<c r="C1" s="0"><v>2</v></c>');
    expect(xml).not.toContain('D1');
    expect(parts['xl/workbook.xml']).toContain('name="S"');
  });
});

describe('accountantPack', () => {
  const ledger = { ...emptyLedger('L'), name: 'หอทดสอบ', legal_entity_name: 'นาย ก', accounts: defaultChart() };
  const entries = [
    charge('2026-09-01', 'r1', 3000_00), pay('2026-09-03', 'r1', 3000_00),
    charge('2026-10-01', 'r1', 3000_00), charge('2026-10-01', 'r2', 2500_00), pay('2026-10-05', 'r2', 1000_00),
  ];
  const sheets = accountantPack(ledger, entries, { from: '2026-10-01', to: '2026-10-31', partyName: new Map([['r1', '101'], ['r2', '102']]) });
  const byName = Object.fromEntries(sheets.map(s => [s.name, s.rows]));

  it('has every sheet an accountant expects', () => {
    expect(sheets.map(s => s.name)).toEqual(['สรุป', 'สมุดรายวัน', 'บัญชีแยกประเภท', 'งบทดลอง', 'งบกำไรขาดทุน', 'งบดุล', 'ลูกหนี้ตามอายุ']);
  });

  it('the journal covers only the period and balances', () => {
    const j = byName['สมุดรายวัน'];
    expect(j.length).toBe(1 + 6 + 1); // header, 3 entries × 2 lines, total
    expect(j.at(-1)!.slice(-2)).toEqual([6500, 6500]);
  });

  it('the ledger carries September into the opening balance', () => {
    const gl = byName['บัญชีแยกประเภท'];
    const cashHead = gl.findIndex(r => String(r[0]).startsWith('1101 '));
    expect(gl[cashHead + 1]).toEqual(['', '', 'ยอดยกมา', '', null, null, 3000]);
  });

  it('profit, balance sheet and aging agree with the entries', () => {
    expect(byName['งบกำไรขาดทุน'].find(r => r[0] === 'กำไรสุทธิ')?.[1]).toBe(5500);
    expect(byName['งบดุล'].find(r => r[0] === 'รวมสินทรัพย์')?.[1]).toBe(4000 + 4500); // cash received + still owed
    const ag = byName['ลูกหนี้ตามอายุ'];
    expect(ag.slice(1, -1).map(r => [r[0], r.at(-1)])).toEqual([['101', 3000], ['102', 1500]]);
    expect(byName['สรุป'].find(r => r[0] === 'งบทดลอง ณ สิ้นงวด')?.[1]).toBe('สมดุล');
  });

  it('turns into an xlsx file', () => {
    const bytes = xlsxBytes(sheets);
    expect(bytes[0]).toBe(0x50);
    expect(bytes.length).toBeGreaterThan(1000);
  });
});
