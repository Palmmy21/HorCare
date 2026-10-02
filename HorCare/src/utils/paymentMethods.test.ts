import { describe, expect, it } from 'vitest';
import { PAYMENT_METHODS, compactFields, resolvePaymentMethod } from './paymentMethods';

describe('resolvePaymentMethod', () => {
    it('uses the recorded method when present', () => {
        expect(resolvePaymentMethod({ payment_method: 'cash', slip_image: true })).toBe('cash');
    });
    it('legacy slip-confirmed bills count as bank transfers', () => {
        expect(resolvePaymentMethod({ paid_method: 'auto' })).toBe('bank_transfer');
        expect(resolvePaymentMethod({ slip_image: true })).toBe('bank_transfer');
        expect(resolvePaymentMethod({ slip_ref: 'REF1' })).toBe('bank_transfer');
    });
    it('legacy manual payments without a slip are "other", never guessed as cash', () => {
        expect(resolvePaymentMethod({ paid_method: 'manual' })).toBe('other');
        expect(resolvePaymentMethod({})).toBe('other');
    });
    it('supports exactly cash / transfer / gateway / other', () => {
        expect([...PAYMENT_METHODS].sort()).toEqual(['bank_transfer', 'cash', 'other', 'qr_gateway']);
    });
});

describe('compactFields', () => {
    it('drops undefined and empty strings but keeps zeros and false', () => {
        expect(compactFields({ a: 1, b: '', c: undefined, d: 0, e: false, f: 'x' })).toEqual({ a: 1, d: 0, e: false, f: 'x' });
    });
});
