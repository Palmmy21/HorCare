import { describe, expect, it } from 'vitest';
import { cleanMapping, guessMapping, maskCell, parseAmount, parsePhone, parseSheetDate, toImportRecords } from './importMapping';
import { parseCsv } from '../utils/sheetReader';

describe('import mapping', () => {
  it('guesses columns from Thai and English headers, most specific first', () => {
    expect(guessMapping(['เลขห้อง', 'ชั้น', 'ค่าเช่า/เดือน', 'มัดจำ', 'ชื่อผู้เช่า', 'เบอร์โทร', 'วันที่เข้าอยู่', 'วันสิ้นสุดสัญญา', 'มิเตอร์ไฟ', 'มิเตอร์น้ำ', 'หมายเหตุ']))
      .toEqual(['room_number', 'floor', 'rent_amount', 'deposit_amount', 'tenant_name', 'phone', 'move_in_date', 'contract_end_date', 'current_meter_elec', 'current_meter_water', null]);
    expect(guessMapping(['Room', 'Rent', 'Tenant Name', 'Mobile'])).toEqual(['room_number', 'rent_amount', 'tenant_name', 'phone']);
  });

  it('hides sample content but keeps its shape', () => {
    expect(maskCell('สมชาย ใจดี')).toBe('กกกกก กกกก');
    expect(maskCell('081-234-5678')).toBe('999-999-9999');
    expect(maskCell('Somchai 12')).toBe('aaaaaaa 99');
  });

  it("accepts the AI's mapping only for known fields, once each", () => {
    expect(cleanMapping({ mapping: ['room_number', 'rent_amount', 'hack', 'rent_amount', null] }, 5))
      .toEqual(['room_number', 'rent_amount', null, null, null]);
    expect(cleanMapping('nope', 3)).toBeNull();
  });

  it('reads amounts, phones and dates the way Thai sheets write them', () => {
    expect(parseAmount('฿3,500.00')).toBe(3500);
    expect(parseAmount('3 500 บาท')).toBe(3500);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('สามพัน')).toBeUndefined();
    expect(parsePhone('081-234-5678')).toBe('0812345678');
    expect(parsePhone('812345678')).toBe('0812345678'); // Excel dropped the 0
    expect(parsePhone('+66812345678')).toBe('0812345678');
    expect(parsePhone('12')).toBeUndefined();
    expect(parseSheetDate('2026-10-05')).toBe('2026-10-05');
    expect(parseSheetDate('5/10/2569')).toBe('2026-10-05'); // Buddhist year
    expect(parseSheetDate('05-10-26')).toBe('2026-10-05');
    expect(parseSheetDate('45000')).toBe('2023-03-15'); // Excel day number
    expect(parseSheetDate('31/02/2026')).toBeUndefined();
    expect(parseSheetDate('พรุ่งนี้')).toBeUndefined();
  });

  it('turns rows into records and reports the rows that need fixing', () => {
    const rows = [
      ['ห้อง', 'ค่าเช่า', 'ชื่อ', 'โทร', 'เข้าอยู่'],
      ['101', '3,500', 'สมชาย', '0812345678', '1/6/2568'],
      ['102', '3500', '', '', ''],
      ['', '', '', '', ''],
      ['103', 'แพง', '', '', ''],
      ['101', '3500', '', '', ''],
      ['104', '3500', 'มานี', '12', ''],
    ];
    const { records, problems } = toImportRecords(rows, ['room_number', 'rent_amount', 'tenant_name', 'phone', 'move_in_date']);
    expect(records).toEqual([
      { line: 2, room_number: '101', rent_amount: 3500, tenant: { full_name: 'สมชาย', phone: '0812345678', move_in_date: '2025-06-01' } },
      { line: 3, room_number: '102', rent_amount: 3500 },
    ]);
    expect(problems.map(p => p.line)).toEqual([5, 6, 7]);
    expect(problems[1].message).toContain('ซ้ำ');
    expect(toImportRecords(rows, [null, 'rent_amount']).problems[0].message).toContain('เลขห้อง');
  });
});

describe('parseCsv', () => {
  it('handles quotes, commas, newlines in cells, and tab-separated text', () => {
    expect(parseCsv('a,b\n"1,000","say ""hi"""\r\n"two\nlines",x')).toEqual([['a', 'b'], ['1,000', 'say "hi"'], ['two\nlines', 'x']]);
    expect(parseCsv('ห้อง\tค่าเช่า\n101\t3500')).toEqual([['ห้อง', 'ค่าเช่า'], ['101', '3500']]);
  });
});
