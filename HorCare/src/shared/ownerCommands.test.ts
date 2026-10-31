import { describe, expect, it } from 'vitest';
import { formatSummary, formatUnpaid, formatVacant, isOwnerLinkCode, monthFigures, parseOwnerCommand, thaiDay } from './ownerCommands';

describe('owner commands', () => {
  it('parses # commands and leaves other text alone', () => {
    expect(parseOwnerCommand('#ยอด')).toBe('summary');
    expect(parseOwnerCommand('  # ค้าง  ')).toBe('unpaid');
    expect(parseOwnerCommand('#ห้องว่าง')).toBe('vacant');
    expect(parseOwnerCommand('#ยกเลิก')).toBe('unlink');
    expect(parseOwnerCommand('#อะไรนะ')).toBe('help');
    expect(parseOwnerCommand('สวัสดี')).toBeNull();
  });

  it('recognises owner link codes only', () => {
    expect(isOwnerLinkCode('hco-abcdefgh')).toBe(true);
    expect(isOwnerLinkCode('HCS-ABCDEFGH')).toBe(false);
    expect(isOwnerLinkCode('HCO-ABCDEFG1')).toBe(false); // 1 is not in the alphabet
  });

  it('converts timestamps to Thai days', () => {
    expect(thaiDay('2026-10-30T18:30:00.000Z')).toBe('2026-10-31');
    expect(thaiDay('nonsense')).toBe('');
  });

  const bills = [
    { room_number: '101', total_bill: 4000, payment_status: 'paid', paid_amount: 4000, paid_at: '2026-10-31T03:00:00Z' },
    { room_number: '102', total_bill: 3500, payment_status: 'paid', paid_at: '2026-10-29T03:00:00Z' },
    { room_number: '103', total_bill: 3600, payment_status: 'pending' },
    { room_number: '110', total_bill: 3700 },
    { room_number: '104', total_bill: 9999, is_saved: false },
  ];

  it("adds up the month's bills, and what came in today", () => {
    expect(monthFigures(bills, '2026-10-31')).toEqual({ billed: 14800, collected: 7500, collectedToday: 4000, bills: 4, paid: 2, pending: 1, unpaid: 1 });
  });

  it('formats replies', () => {
    expect(formatSummary('หอสุขใจ', 'ต.ค. 69', monthFigures(bills, '2026-10-31'))).toContain('เก็บแล้ว ฿7,500 จาก ฿14,800 (51%)');
    const unpaid = formatUnpaid('หอสุขใจ', bills);
    expect(unpaid).toContain('ค้าง 2 ห้อง รวม ฿7,300');
    expect(unpaid.indexOf('103')).toBeLessThan(unpaid.indexOf('110'));
    expect(unpaid).not.toContain('104');
    expect(formatUnpaid('หอ', [bills[0]])).toContain('จ่ายครบทุกห้องแล้ว');
    expect(formatVacant('หอ', [{ number: '201' }, { number: '305' }])).toBe('🏢 หอ · ว่าง 2 ห้อง\n201, 305');
  });
});
