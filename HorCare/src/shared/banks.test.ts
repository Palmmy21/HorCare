import { describe, expect, it } from 'vitest';
import { BANKS, bankAccountLabel, bankByCode, bankByShort, bankLogoUrl, digitsOnly, isValidAccountNumber, maskAccountNumber } from './banks';

describe('bank list', () => {
    it('has unique 3-digit codes and unique short names', () => {
        expect(new Set(BANKS.map(b => b.code)).size).toBe(BANKS.length);
        expect(new Set(BANKS.map(b => b.short)).size).toBe(BANKS.length);
        for (const b of BANKS) {
            expect(b.code).toMatch(/^\d{3}$/);
            expect(b.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
            expect(b.name_th.length).toBeGreaterThan(2);
        }
    });
    it('looks banks up by code and short name', () => {
        expect(bankByCode('004')?.short).toBe('KBANK');
        expect(bankByCode('014')?.short).toBe('SCB');
        expect(bankByShort('BBL')?.code).toBe('002');
        expect(bankByCode('999')).toBeUndefined();
        expect(bankByCode(null)).toBeUndefined();
    });
    it('logo URLs are built from the short code and escaped', () => {
        expect(bankLogoUrl('KBANK')).toBe('https://cdn.jsdelivr.net/gh/casperstack/thai-banks-logo/icons/KBANK.png');
        expect(bankLogoUrl('../x')).not.toContain('../');
    });
});

describe('account numbers', () => {
    it('validates 10–15 digits with optional dashes/spaces', () => {
        for (const ok of ['1234567890', '123-4-56789-0', '123 456 7890', '123456789012345']) expect(isValidAccountNumber(ok)).toBe(true);
        for (const bad of ['123456789', '1234567890123456', 'abcdefghij', '12345-6789x0', '', '   ']) expect(isValidAccountNumber(bad)).toBe(false);
    });
    it('masks all but the last four digits', () => {
        expect(maskAccountNumber('1234567890')).toBe('••••••7890');
        expect(maskAccountNumber('123-4-56789-0')).toBe('••••••7890');
        expect(maskAccountNumber('123')).toBe('123');
        expect(digitsOnly('12-3 4')).toBe('1234');
    });
    it('builds a short label for payments', () => {
        expect(bankAccountLabel({ bank_short: 'KBANK', account_number: '1234567890' })).toBe('KBANK ••••7890');
    });
});
