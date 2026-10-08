import { describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import qr from './_qr.js';
import { paymentQrMessages, pickPayAccount, qrImageUrl } from './_payment-qr.js';
import { fakeRes } from './_fake-firestore.js';
import { buildThaiQrPayload, isValidThaiQrPayload } from '../src/shared/thaiQr.js';
import type { BankAccount } from '../src/shared/banks.js';

const acc = (over: Partial<BankAccount> = {}): BankAccount => ({
    id: 'a1', bank_code: '004', bank_short: 'KBANK', account_name: 'สมชาย ใจดี', account_number: '6628873714', nickname: null,
    status: 'active', is_default: false, created_at: '2026-01-01T00:00:00Z', updated_at: '', ...over,
});
const payloadOf = (url: string) => decodeURIComponent(new URL(url).searchParams.get('p')!);

describe('pickPayAccount', () => {
    it('prefers the default active account, then the oldest active one, never an inactive one', () => {
        expect(pickPayAccount([acc({ id: 'x' }), acc({ id: 'd', is_default: true })])?.id).toBe('d');
        expect(pickPayAccount([acc({ id: 'new', created_at: '2026-05-01T00:00:00Z' }), acc({ id: 'old' })])?.id).toBe('old');
        expect(pickPayAccount([acc({ id: 'off', is_default: true, status: 'inactive' }), acc({ id: 'on' })])?.id).toBe('on');
        expect(pickPayAccount([acc({ status: 'inactive' })])).toBeNull();
        expect(pickPayAccount([])).toBeNull();
    });
});

describe('paymentQrMessages', () => {
    const base = 'https://app.example';
    it('sends nothing when there is no account or nothing to pay', () => {
        expect(paymentQrMessages(null, 3500, base)).toEqual([]);
        expect(paymentQrMessages(acc(), 0, base)).toEqual([]);
        expect(paymentQrMessages(acc(), -5, base)).toEqual([]);
    });

    it('sends the QR image and the account details, with the amount in the code', () => {
        const [img, text] = paymentQrMessages(acc(), 3500, base) as { type: string; originalContentUrl?: string; previewImageUrl?: string; text?: string }[];
        expect(img.type).toBe('image');
        expect(img.originalContentUrl).toBe(img.previewImageUrl);
        expect(img.originalContentUrl!.startsWith('https://app.example/api/qr?p=')).toBe(true);
        const payload = payloadOf(img.originalContentUrl!);
        expect(isValidThaiQrPayload(payload)).toBe(true);
        expect(payload).toContain('54073500.00'); // tag 54, length 07, value 3500.00
        expect(text.text).toContain('สมชาย ใจดี');
        expect(text.text).toContain('662-8-87371-4');
        expect(text.text).toContain('3,500.00');
    });

    it('a PromptPay id on the account makes it a standard PromptPay code; otherwise a bank-account code', () => {
        const pp = payloadOf((paymentQrMessages(acc({ promptpay_id: '0812345678' }), 100, base)[0] as { originalContentUrl: string }).originalContentUrl);
        expect(pp).toBe(buildThaiQrPayload({ kind: 'mobile', id: '0812345678' }, 100));
        const bank = payloadOf((paymentQrMessages(acc(), 100, base)[0] as { originalContentUrl: string }).originalContentUrl);
        expect(bank).toBe(buildThaiQrPayload({ kind: 'bank_account', bankCode: '004', accountNumber: '6628873714' }, 100));
    });

    it('tolerates a trailing slash on the base URL', () => {
        expect(qrImageUrl(acc(), 10, 'https://app.example/').startsWith('https://app.example/api/qr?p=')).toBe(true);
    });
});

describe('GET /api/qr', () => {
    const call = async (query: Record<string, unknown>, method = 'GET') => {
        const res = fakeRes() as ReturnType<typeof fakeRes> & { headers: Record<string, string>; setHeader: (k: string, v: string) => void };
        res.headers = {};
        res.setHeader = (k, v) => { res.headers[k] = v; };
        await qr({ method, query } as never, res as never);
        return res;
    };
    const good = buildThaiQrPayload({ kind: 'mobile', id: '0812345678' }, 100);

    it('draws a valid Thai QR payload as a cacheable PNG', async () => {
        const r = await call({ p: good, s: '400' });
        expect(r.statusCode).toBe(200);
        expect(r.headers['Content-Type']).toBe('image/png');
        expect(r.headers['Cache-Control']).toContain('immutable');
        const png = r.body as Buffer;
        expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    });

    it('refuses anything that is not a valid Thai QR payload (it is not a general QR service)', async () => {
        for (const bad of [undefined, '', 'hello', 'https://evil.example', good.replace('100.00', '999.99'), good + 'x'.repeat(300)]) {
            const r = await call({ p: bad });
            expect(r.statusCode, String(bad)).toBe(400);
        }
    });

    it('clamps the size and only accepts GET/HEAD', async () => {
        expect((await call({ p: good, s: '99999' })).statusCode).toBe(200);
        expect((await call({ p: good, s: 'abc' })).statusCode).toBe(200);
        expect((await call({ p: good }, 'POST')).statusCode).toBe(405);
        expect((await call({ p: good }, 'HEAD')).statusCode).toBe(200);
    });
});