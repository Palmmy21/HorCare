import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import { fromEasySlip, fromSlipOk, slipProvider, verifyBankSlip } from './_bank-slip.js';
import { evaluateSlip, tenantSlipReply } from './_slip-flow.js';
import { resetFake, seed } from './_fake-firestore.js';

const QR = '0041000600000101030140219TXN1234567890ABCDEF5102TH9104ABCD';
const reply = (status: number, json: unknown) => ({ ok: status < 300, status, json: async () => json, text: async () => JSON.stringify(json) });
const recentIso = () => new Date(Date.now() - 3600_000).toISOString();

const slipOkRecord = (over: Record<string, unknown> = {}) => ({
    success: true,
    data: {
        success: true, transRef: 'TXN1234567890ABCDEF', sendingBank: '014', receivingBank: '004',
        transTimestamp: recentIso(), amount: 3500,
        sender: { displayName: 'น.ส. มาลี ร.', account: { value: 'xxx-x-x1111-x' } },
        receiver: { displayName: 'นาย สมชาย ใ', account: { value: 'xxx-x-x6789-x' } },
        ...over,
    },
});

describe('provider choice', () => {
    it('uses whichever service has keys, or the forced one', () => {
        expect(slipProvider({})).toBeNull();
        expect(slipProvider({ EASYSLIP_API_KEY: 'k' })).toBe('easyslip');
        expect(slipProvider({ SLIPOK_API_KEY: 'k' })).toBeNull(); // SlipOK also needs the branch id
        expect(slipProvider({ SLIPOK_API_KEY: 'k', SLIPOK_BRANCH_ID: '1', EASYSLIP_API_KEY: 'k' })).toBe('slipok');
        expect(slipProvider({ SLIPOK_API_KEY: 'k', SLIPOK_BRANCH_ID: '1', EASYSLIP_API_KEY: 'k', SLIP_VERIFY_PROVIDER: 'easyslip' })).toBe('easyslip');
    });
});

describe('reading each service', () => {
    it('SlipOK: date + time become Thailand ISO; PromptPay receivers fall back to the masked proxy', () => {
        const d = fromSlipOk({ amount: '1200.50', transDate: '20261015', transTime: '09:30', transRef: 'R', receiver: { name: 'สมชาย', proxy: { value: 'xxx-xxx-5678' } } }, () => null);
        expect(d).toMatchObject({ amount: 1200.5, datetime_iso: '2026-10-15T09:30:00+07:00', receiver_name: 'สมชาย', receiver_account: 'xxx-xxx-5678', reference: 'R' });
    });
    it('EasySlip: nested amount, Thai names, short bank names', () => {
        const d = fromEasySlip({
            transRef: 'R2', date: '2026-10-15T09:30:00+07:00', amount: { amount: 3500 },
            sender: { bank: { short: 'SCB' }, account: { name: { th: 'มาลี', en: 'Malee' } } },
            receiver: { bank: { short: 'KBANK' }, account: { name: { th: 'สมชาย ใ' }, bank: { account: 'xxx-x-x6789-x' } } },
        });
        expect(d).toEqual({
            amount: 3500, sender_name: 'มาลี', receiver_name: 'สมชาย ใ', receiver_account: 'xxx-x-x6789-x',
            receiver_bank: 'KBANK', sender_bank: 'SCB', datetime_iso: '2026-10-15T09:30:00+07:00', reference: 'R2',
        });
    });
});

describe('verifyBankSlip', () => {
    const slipok = { SLIPOK_API_KEY: 'key', SLIPOK_BRANCH_ID: '42' };
    it('calls SlipOK with the QR and no logging, and maps its answers', async () => {
        const f = vi.fn().mockResolvedValue(reply(200, slipOkRecord()));
        const r = await verifyBankSlip(QR, { env: slipok, fetchImpl: f as never });
        expect(r.status).toBe('verified');
        const [url, init] = f.mock.calls[0];
        expect(url).toBe('https://api.slipok.com/api/line/apikey/42');
        expect(init.headers['x-authorization']).toBe('key');
        expect(JSON.parse(init.body)).toEqual({ data: QR, log: false });

        for (const [code, status] of [[1011, 'not_found'], [1008, 'not_found'], [1010, 'pending'], [1004, 'unavailable']] as const) {
            const g = vi.fn().mockResolvedValue(reply(400, { success: false, code, message: 'x' }));
            expect((await verifyBankSlip(QR, { env: slipok, fetchImpl: g as never })).status).toBe(status);
        }
    });
    it('calls EasySlip v2 and maps its error codes', async () => {
        const env = { EASYSLIP_API_KEY: 'es' };
        const ok = vi.fn().mockResolvedValue(reply(200, { success: true, data: { rawSlip: { transRef: 'R', amount: { amount: 10 }, date: recentIso() } } }));
        expect((await verifyBankSlip(QR, { env, fetchImpl: ok as never })).status).toBe('verified');
        expect(ok.mock.calls[0][0]).toBe('https://api.easyslip.com/v2/verify/bank');
        expect(ok.mock.calls[0][1].headers.Authorization).toBe('Bearer es');
        const nf = vi.fn().mockResolvedValue(reply(404, { success: false, error: { code: 'SLIP_NOT_FOUND', message: '' } }));
        expect((await verifyBankSlip(QR, { env, fetchImpl: nf as never })).status).toBe('not_found');
        const invalid = vi.fn().mockResolvedValue(reply(400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid bank slip format or verification failed' } }));
        expect((await verifyBankSlip(QR, { env, fetchImpl: invalid as never })).status).toBe('not_found');
        const badKey = vi.fn().mockResolvedValue(reply(401, { success: false, error: { code: 'INVALID_API_KEY', message: 'Invalid API key' } }));
        expect(await verifyBankSlip(QR, { env, fetchImpl: badKey as never })).toMatchObject({ status: 'unavailable', reason: 'easyslip_INVALID_API_KEY' });
        const pend = vi.fn().mockResolvedValue(reply(404, { success: false, error: { code: 'SLIP_PENDING', message: '' } }));
        expect((await verifyBankSlip(QR, { env, fetchImpl: pend as never })).status).toBe('pending');
    });
    it('is unavailable — never throws — on network failure or with nothing configured', async () => {
        expect(await verifyBankSlip(QR, { env: {} })).toEqual({ status: 'unavailable', provider: null, reason: 'not_configured' });
        const boom = vi.fn().mockRejectedValue(new Error('down'));
        expect(await verifyBankSlip(QR, { env: { EASYSLIP_API_KEY: 'k' }, fetchImpl: boom as never })).toMatchObject({ status: 'unavailable', reason: 'network' });
    });
});

describe('evaluateSlip with the bank in the loop', () => {
    const OWNER = 'o1', BLD = 'b1', B = `users/${OWNER}/buildings/${BLD}`;
    const fetchMock = vi.fn();
    const run = () => evaluateSlip({
        ownerUid: OWNER, buildingId: BLD, imageBase64: 'AAAA', mimeType: 'image/jpeg', qrPayload: QR, expectedAmount: 3500,
        billCreatedAt: new Date(Date.now() - 5 * 86400_000).toISOString(), isPro: true,
    });
    const aiReply = (d: Record<string, unknown>) => reply(200, { choices: [{ message: { content: JSON.stringify(d) } }] });
    const pictureSaysPaid = { amount: 3500, receiver_name: 'นาย สมชาย ใ', receiver_account: 'xxx-x-x6789-x', datetime: new Date(Date.now() + 7 * 3600_000 - 3600_000).toISOString().slice(0, 16), reference: 'R' };

    beforeEach(() => {
        resetFake();
        fetchMock.mockReset();
        vi.stubGlobal('fetch', fetchMock);
        process.env.SLIPOK_API_KEY = 'key';
        process.env.SLIPOK_BRANCH_ID = '42';
        process.env.OPENROUTER_API_KEY = 'ai';
        seed(`${B}/bank_accounts/acc1`, { id: 'acc1', bank_code: '004', bank_short: 'KBANK', account_name: 'สมชาย ใจดี', account_number: '1234567890', status: 'active' });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        for (const k of ['SLIPOK_API_KEY', 'SLIPOK_BRANCH_ID', 'OPENROUTER_API_KEY']) delete process.env[k];
    });

    it('approves a slip the bank confirms, from the bank record, without asking the AI', async () => {
        fetchMock.mockResolvedValueOnce(reply(200, slipOkRecord()));
        const e = await run();
        expect(e.autoApprove).toBe(true);
        expect(e.bankVerified).toBe(true);
        expect(e.fields).toMatchObject({ slip_bank_check: 'verified', slip_bank_provider: 'slipok', paid_amount: 3500, bank_account_id: 'acc1' });
        expect(fetchMock).toHaveBeenCalledTimes(1); // the bank only — no AI call
        expect(tenantSlipReply('101', e)).toContain('ตรวจกับธนาคารแล้ว');
    });

    it('rejects a fake slip the bank has never seen', async () => {
        fetchMock.mockResolvedValueOnce(reply(400, { success: false, code: 1011 }));
        const e = await run();
        expect(e.autoApprove).toBe(false);
        expect(e.outcome).toBe('mismatch');
        expect(e.problems[0]).toContain('ธนาคารไม่พบรายการโอน');
        expect(e.fields).toEqual({ slip_bank_check: 'not_found', slip_bank_provider: 'slipok' });
    });

    it('catches an edited picture: the bank says 350 baht, not 3,500', async () => {
        fetchMock.mockResolvedValueOnce(reply(200, slipOkRecord({ amount: 350 })));
        const e = await run();
        expect(e.autoApprove).toBe(false);
        expect(e.fields.slip_checks).toMatchObject({ amount: 'fail' });
    });

    it('catches a real transfer to someone else', async () => {
        fetchMock.mockResolvedValueOnce(reply(200, slipOkRecord({ receiver: { displayName: 'นาย อื่น ๆ', account: { value: 'xxx-x-x0000-x' } } })));
        const e = await run();
        expect(e.autoApprove).toBe(false);
        expect(e.problems.join()).toContain('ไม่ใช่บัญชีของหอพัก');
    });

    it('never auto-approves from the picture while the bank cannot be asked', async () => {
        fetchMock.mockResolvedValueOnce(reply(400, { success: false, code: 1009 }));   // bank outage
        fetchMock.mockResolvedValueOnce(aiReply(pictureSaysPaid));                     // the picture looks perfect
        const e = await run();
        expect(e.autoApprove).toBe(false);
        expect(e.outcome).toBe('review');
        expect(e.verifyNote).toContain('ตรวจกับธนาคารไม่ได้');
        expect(e.fields).toMatchObject({ slip_bank_check: 'unavailable' });
        expect(e.fields.verification_status).toBeUndefined();
    });
});
