import { describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import qr from './_qr.js';
import { invoicePay, pickPayAccount, qrImageUrl } from './_payment-qr.js';
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

describe('invoicePay — the QR and account inside a LINE invoice', () => {
    const base = 'https://app.example';
    const qrOf = (p: ReturnType<typeof invoicePay>) => payloadOf(p!.qrUrl!);

    it('puts the amount in a valid Thai QR and carries the account details', () => {
        const p = invoicePay(acc(), 3500, base);
        expect(p!.qrUrl!.startsWith('https://app.example/api/qr?p=')).toBe(true);
        const payload = qrOf(p);
        expect(isValidThaiQrPayload(payload)).toBe(true);
        expect(payload).toContain('54073500.00'); // tag 54, length 07, value 3500.00
        expect(p).toMatchObject({ accountName: 'สมชาย ใจดี', accountNumber: '662-8-87371-4' });
    });

    it('a PromptPay id on the account makes it a standard PromptPay code; otherwise a bank-account code', () => {
        expect(qrOf(invoicePay(acc({ promptpay_id: '0812345678' }), 100, base))).toBe(buildThaiQrPayload({ kind: 'mobile', id: '0812345678' }, 100));
        expect(qrOf(invoicePay(acc(), 100, base))).toBe(buildThaiQrPayload({ kind: 'bank_account', bankCode: '004', accountNumber: '6628873714' }, 100));
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
describe('invoicePay — when there is nothing to show', () => {
    it('carries the account and an https QR for the invoice, nothing when there is nothing to pay', () => {
        const p = invoicePay(acc(), 3116, 'https://app.example.com');
        expect(p?.qrUrl).toMatch(/^https:\/\/app\.example\.com\/api\/qr\?p=/);
        expect(p?.accountName).toBe('สมชาย ใจดี');
        expect(invoicePay(acc(), 0, 'https://app.example.com')).toBeUndefined();
        expect(invoicePay(null, 100, 'https://app.example.com')).toBeUndefined();
    });

    it('leaves the QR out on a plain-http base (LINE only loads https images) but keeps the account', () => {
        const p = invoicePay(acc(), 100, 'http://localhost:5173');
        expect(p?.qrUrl).toBeUndefined();
        expect(p?.accountNumber).toBeTruthy();
    });
});
