import { describe, expect, it } from 'vitest';
import { bahtText, cashAccounts, voucherKind } from './voucher';
import { defaultChart, emptyLedger, type EntryLine, type JournalEntry } from './ledger';

describe('bahtText', () => {
  it('reads amounts the way Thai documents write them', () => {
    expect(bahtText(0)).toBe('ศูนย์บาทถ้วน');
    expect(bahtText(100)).toBe('หนึ่งบาทถ้วน');
    expect(bahtText(1100)).toBe('สิบเอ็ดบาทถ้วน');
    expect(bahtText(2100)).toBe('ยี่สิบเอ็ดบาทถ้วน');
    expect(bahtText(10100)).toBe('หนึ่งร้อยเอ็ดบาทถ้วน');
    expect(bahtText(125050)).toBe('หนึ่งพันสองร้อยห้าสิบบาทห้าสิบสตางค์');
    expect(bahtText(25)).toBe('ยี่สิบห้าสตางค์');
    expect(bahtText(100000000)).toBe('หนึ่งล้านบาทถ้วน');
    expect(bahtText(1100000000)).toBe('สิบเอ็ดล้านบาทถ้วน');
    expect(bahtText(350000)).toBe('สามพันห้าร้อยบาทถ้วน');
    expect(bahtText(-500)).toBe('ลบห้าบาทถ้วน');
  });
});

describe('voucherKind', () => {
  const ledger = { ...emptyLedger('L'), accounts: defaultChart() };
  const cash = cashAccounts(ledger);
  const line = (account: string, dr: number, cr: number): EntryLine => ({ account, dr_satang: dr, cr_satang: cr, description: '', party_id: null });
  const e = (lines: EntryLine[]) => ({ lines } as JournalEntry);
  it('money in is a receipt voucher, money out a payment voucher, the rest general', () => {
    expect(cash.has('1101') && cash.has('1102') && cash.has('1103')).toBe(true);
    expect(voucherKind(e([line('1102', 100, 0), line('1140', 0, 100)]), cash)).toBe('receipt');
    expect(voucherKind(e([line('5101', 100, 0), line('1101', 0, 100)]), cash)).toBe('payment');
    expect(voucherKind(e([line('1140', 100, 0), line('4101', 0, 100)]), cash)).toBe('general');
    expect(voucherKind(e([line('1102', 100, 0), line('1101', 0, 100)]), cash)).toBe('general'); // transfer between own accounts
  });
});
