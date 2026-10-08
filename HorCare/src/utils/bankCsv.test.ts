import { describe, expect, it } from 'vitest';
import { parseMoney, parseStatementCsv, parseStatementDate } from './bankCsv';

describe('parseStatementDate', () => {
  it('reads dd/mm/yyyy with Buddhist years and a time', () => {
    expect(parseStatementDate('05/10/2569', '10:30')).toBe('2026-10-05T03:30:00.000Z');
    expect(parseStatementDate('05/10/2026 10:30:15')).toBe('2026-10-05T03:30:15.000Z');
    expect(parseStatementDate('2026-10-05', '00:00')).toBe('2026-10-04T17:00:00.000Z');
  });
  it('rejects impossible dates', () => {
    for (const bad of ['31/02/2026', '32/01/2026', '00/01/2026', 'hello', '05/13/2026', '05/10/1800']) expect(parseStatementDate(bad)).toBeNull();
    expect(parseStatementDate('05/10/2026', '25:00')).toBeNull();
  });
});

describe('parseMoney', () => {
  it('handles thousands separators and rejects junk', () => {
    expect(parseMoney('1,234.50')).toBe(1234.5);
    expect(parseMoney('-20')).toBe(-20);
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney(undefined)).toBeNull();
  });
});

describe('parseStatementCsv', () => {
  it('imports only money in, from separate credit/debit columns', () => {
    const csv = [
      'วันที่,เวลา,รายละเอียด,เงินออก,เงินเข้า,เลขอ้างอิง',
      '05/10/2569,10:01,โอนเงินเข้า,,"3,500.00",REF123456',
      '05/10/2569,11:00,ถอนเงิน,"1,000.00",,',
      '06/10/2569,09:00,โอนเงินเข้า,,4200,',
    ].join('\n');
    const r = parseStatementCsv(csv);
    expect(r.error).toBeNull();
    expect(r.skipped).toBe(1);
    expect(r.rows).toEqual([
      { occurred_at: '2026-10-05T03:01:00.000Z', amount: 3500, reference: 'REF123456', description: 'โอนเงินเข้า' },
      { occurred_at: '2026-10-06T02:00:00.000Z', amount: 4200, reference: null, description: 'โอนเงินเข้า' },
    ]);
  });

  it('works with a single signed amount column and semicolons, skipping negatives and bad lines', () => {
    const r = parseStatementCsv('Date;Amount;Description\n2026-10-05 10:00;100.00;in\n2026-10-05 11:00;-50;out\nnot a date;10;x');
    expect(r.rows).toHaveLength(1);
    expect(r.skipped).toBe(2);
  });

  it('reports files without usable headers', () => {
    expect(parseStatementCsv('').error).toBe('no_header');
    expect(parseStatementCsv('a,b\n1,2').error).toBe('no_columns');
  });
});