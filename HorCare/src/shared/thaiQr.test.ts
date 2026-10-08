import { describe, expect, it } from 'vitest';
import generatePayload from 'promptpay-qr';
import {
  buildThaiQrPayload, cleanPromptPayId, crc16, isValidThaiQrPayload, maskPromptPayId, paymentQrPayload, receiverForAccount,
} from './thaiQr';

describe('crc16', () => {
  it('matches the CRC-16/CCITT-FALSE check value', () => {
    expect(crc16('123456789')).toBe('29B1');
  });
});

describe('PromptPay payloads match the reference library', () => {
  it('mobile number, with and without an amount', () => {
    expect(buildThaiQrPayload({ kind: 'mobile', id: '0812345678' }, 100)).toBe(generatePayload('0812345678', { amount: 100 }));
    expect(buildThaiQrPayload({ kind: 'mobile', id: '0812345678' })).toBe(generatePayload('0812345678', {}));
    expect(buildThaiQrPayload({ kind: 'mobile', id: '0899999999' }, 3500.5)).toBe(generatePayload('0899999999', { amount: 3500.5 }));
  });
  it('national / tax ID', () => {
    expect(buildThaiQrPayload({ kind: 'national_id', id: '1234567890123' }, 250)).toBe(generatePayload('1234567890123', { amount: 250 }));
    expect(buildThaiQrPayload({ kind: 'national_id', id: '1234567890123' })).toBe(generatePayload('1234567890123', {}));
  });
});

describe('bank account payload', () => {
  it('uses sub-tag 04 with the bank code in front of the account number, and a valid CRC', () => {
    const p = buildThaiQrPayload({ kind: 'bank_account', bankCode: '004', accountNumber: '6628873714' }, 100);
    expect(p).toContain('29' + String(('0016A000000677010111' + '04' + '13' + '0046628873714').length) + '0016A000000677010111' + '0413' + '0046628873714');
    expect(p).toContain('5303764');
    expect(p).toContain('5406100.00'); // tag 54, length 06, amount 100.00
    expect(isValidThaiQrPayload(p)).toBe(true);
    expect(p.startsWith('00020101021')).toBe(true);
  });
  it('rejects malformed receivers', () => {
    expect(() => buildThaiQrPayload({ kind: 'bank_account', bankCode: '04', accountNumber: '6628873714' })).toThrow();
    expect(() => buildThaiQrPayload({ kind: 'bank_account', bankCode: '004', accountNumber: '12' })).toThrow();
    expect(() => buildThaiQrPayload({ kind: 'mobile', id: '812345678' })).toThrow();
    expect(() => buildThaiQrPayload({ kind: 'national_id', id: '123' })).toThrow();
  });
});

describe('isValidThaiQrPayload', () => {
  const good = buildThaiQrPayload({ kind: 'mobile', id: '0812345678' }, 10);
  it('accepts ours and rejects tampering, other formats and oversize input', () => {
    expect(isValidThaiQrPayload(good)).toBe(true);
    expect(isValidThaiQrPayload(good.replace('10.00', '99.00'))).toBe(false); // CRC no longer matches
    expect(isValidThaiQrPayload('https://evil.example/?x=1')).toBe(false);
    expect(isValidThaiQrPayload('')).toBe(false);
    expect(isValidThaiQrPayload(good + 'A'.repeat(300))).toBe(false);
    expect(isValidThaiQrPayload(5 as never)).toBe(false);
  });
});

describe('PromptPay id helpers', () => {
  it('accepts 10-digit mobiles and 13-digit IDs, ignoring dashes and spaces', () => {
    expect(cleanPromptPayId('081-234-5678')).toBe('0812345678');
    expect(cleanPromptPayId('1-2345-67890-12-3')).toBe('1234567890123');
    for (const bad of ['', '12345', '1812345678', '08123456789', 5, null, 'abc']) expect(cleanPromptPayId(bad as never)).toBeNull();
  });
  it('masks the middle', () => {
    expect(maskPromptPayId('0812345678')).toBe('081-xxx-5678');
    expect(maskPromptPayId('1234567890123')).toBe('1-xxxx-xxxxx-12-3');
  });
});

describe('which receiver an account is paid through', () => {
  const acc = { bank_code: '004', account_number: '662-887-3714' };
  it('PromptPay wins when the account has one; otherwise the bank account is used', () => {
    expect(receiverForAccount({ ...acc, promptpay_id: '081-234-5678' })).toEqual({ kind: 'mobile', id: '0812345678' });
    expect(receiverForAccount({ ...acc, promptpay_id: '1234567890123' })).toEqual({ kind: 'national_id', id: '1234567890123' });
    expect(receiverForAccount(acc)).toEqual({ kind: 'bank_account', bankCode: '004', accountNumber: '6628873714' });
    expect(receiverForAccount({ ...acc, promptpay_id: 'garbage' })).toMatchObject({ kind: 'bank_account' });
  });
  it('builds the payload accordingly', () => {
    expect(paymentQrPayload({ ...acc, promptpay_id: '0812345678' }, 100)).toBe(generatePayload('0812345678', { amount: 100 }));
    expect(isValidThaiQrPayload(paymentQrPayload(acc, 100))).toBe(true);
  });
});