import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import { evaluateSlip, loadReceiverCandidates } from './_slip-flow.js';
import { read, resetFake, seed } from './_fake-firestore.js';

const OWNER = 'owner-1';
const BLD = 'bld-A';
const B = `users/${OWNER}/buildings/${BLD}`;
const fetchMock = vi.fn();

const tlv = (id: string, v: string) => `${id}${String(v.length).padStart(2, '0')}${v}`;
const QR = tlv('00', tlv('00', '000001') + tlv('01', '014') + tlv('02', 'TXN1234567890ABCDEF')) + tlv('51', 'TH') + tlv('91', 'ABCD');

const aiReply = (details: Record<string, unknown>) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(details) } }] }), text: async () => '' });
const recent = () => new Date(Date.now() - 3600_000).toISOString().replace(/\.\d{3}Z$/, '').replace('Z', '');
// the model is asked for Thailand time, so format an instant as Bangkok local YYYY-MM-DDTHH:mm
const bangkok = (ms: number) => new Date(ms + 7 * 3600_000).toISOString().slice(0, 16);

const goodSlip = () => ({
    amount: 3500, sender_name: 'น.ส. มาลี', receiver_name: 'นาย สมชาย ใ', receiver_account: 'xxx-x-x6789-x',
    receiver_bank: 'กสิกรไทย', sender_bank: 'ไทยพาณิชย์', datetime: bangkok(Date.now() - 3600_000), reference: 'R1',
});

const run = (over: Partial<Parameters<typeof evaluateSlip>[0]> = {}) => evaluateSlip({
    ownerUid: OWNER, buildingId: BLD, imageBase64: 'AAAA', mimeType: 'image/jpeg', qrPayload: QR, expectedAmount: 3500,
    billCreatedAt: new Date(Date.now() - 5 * 86400_000).toISOString(), isPro: true, ...over,
});

beforeEach(() => {
    resetFake();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    process.env.OPENROUTER_API_KEY = 'k';
    seed(B, { id: BLD });
    seed(`${B}/data/config`, { bill_customization: {} });
    seed(`${B}/bank_accounts/acc1`, {
        id: 'acc1', bank_code: '004', bank_short: 'KBANK', account_name: 'สมชาย ใจดี', account_number: '1234567890',
        status: 'active', is_default: true,
    });
});
afterEach(() => { vi.unstubAllGlobals(); delete process.env.OPENROUTER_API_KEY; });
void recent;

describe('evaluateSlip', () => {
    it('approves a slip that matches the bill and a registered account, recording it as slip-only evidence', async () => {
        fetchMock.mockResolvedValue(aiReply(goodSlip()));
        const e = await run();
        expect(e.autoApprove).toBe(true);
        expect(e.fields).toMatchObject({
            payment_method: 'bank_transfer', paid_method: 'auto', paid_amount: 3500,
            verification_status: 'unverified',               // a picture is not bank confirmation
            bank_account_id: 'acc1', bank_account: 'KBANK ••••7890', slip_account_id: 'acc1',
            slip_amount: 3500, slip_receiver_name: 'นาย สมชาย ใ', transaction_ref: 'TXN1234567890ABCDEF',
            slip_bank: 'ไทยพาณิชย์',
        });
        expect(e.fields.slip_checks).toMatchObject({ amount: 'pass', receiver_name: 'pass', receiver_account: 'pass', datetime: 'pass' });
        expect(e.verifyNote).toContain('ยังไม่ยืนยันกับบัญชีธนาคาร');
        expect(Object.values(e.fields).every(v => v !== undefined && v !== null)).toBe(true); // safe to write to Firestore
    });

    it('never approves a slip paid to a different account or person', async () => {
        fetchMock.mockResolvedValue(aiReply({ ...goodSlip(), receiver_name: 'นาย สมศักดิ์ ใจดี', receiver_account: 'xxx-x-x9999-x' }));
        const e = await run();
        expect(e.autoApprove).toBe(false);
        expect(e.fields.payment_method).toBeUndefined();
        expect(e.fields.verification_status).toBeUndefined();
        expect(e.fields.slip_checks).toMatchObject({ receiver_name: 'fail', receiver_account: 'fail' });
        expect(e.verifyNote).toContain('ไม่ผ่าน');
    });

    it('never approves a wrong amount, but keeps what was read for the owner', async () => {
        fetchMock.mockResolvedValue(aiReply({ ...goodSlip(), amount: 3000 }));
        const e = await run();
        expect(e.autoApprove).toBe(false);
        expect(e.fields).toMatchObject({ slip_amount: 3000 });
        expect(e.aiAmount).toBe(3000);
    });

    it('rejects an old slip and one dated before the bill existed', async () => {
        fetchMock.mockResolvedValue(aiReply({ ...goodSlip(), datetime: bangkok(Date.now() - 60 * 86400_000) }));
        expect((await run()).autoApprove).toBe(false);
        fetchMock.mockResolvedValue(aiReply({ ...goodSlip(), datetime: bangkok(Date.now() - 20 * 86400_000) }));
        expect((await run({ billCreatedAt: new Date(Date.now() - 2 * 86400_000).toISOString() })).autoApprove).toBe(false);
    });

    it('falls back to the legacy note and no AI call without a QR, image, or paid plan', async () => {
        for (const over of [{ qrPayload: null }, { imageBase64: null }, { isPro: false }]) {
            const e = await run(over);
            expect(e.autoApprove).toBe(false);
            expect(e.fields).toEqual({});
            expect(e.verifyNote).toMatch(/QR/);
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('legacy note differs by whether the QR was readable', async () => {
        expect((await run({ isPro: false })).verifyNote).toBe('ตรวจ QR ผ่าน (ไม่ซ้ำ) — รอเจ้าของยืนยันยอด');
        expect((await run({ isPro: false, qrPayload: null })).verifyNote).toBe('อ่าน QR ไม่ได้ — โปรดตรวจสลิปด้วยตา');
    });

    it('does nothing risky when the AI fails', async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}), text: async () => 'down' });
        const e = await run();
        expect(e.autoApprove).toBe(false);
        expect(e.details).toBeNull();
    });

    it('ignores disabled accounts', async () => {
        seed(`${B}/bank_accounts/acc1`, { ...read(`${B}/bank_accounts/acc1`)!, status: 'inactive' });
        fetchMock.mockResolvedValue(aiReply(goodSlip()));
        const e = await run();
        // no active account and no PromptPay on file → legacy rule (amount + QR), no account recorded
        expect(e.autoApprove).toBe(true);
        expect(e.fields.bank_account_id).toBeUndefined();
    });

    it('treats the configured PromptPay name/number as a receiving account', async () => {
        seed(`${B}/bank_accounts/acc1`, { ...read(`${B}/bank_accounts/acc1`)!, status: 'inactive' });
        seed(`${B}/data/config`, { bill_customization: { promptpay_name: 'สมชาย ใจดี', promptpay_number: '0812345678' } });
        fetchMock.mockResolvedValue(aiReply({ ...goodSlip(), receiver_account: 'xxx-xxx-5678' }));
        const e = await run();
        expect(e.autoApprove).toBe(true);
        expect(e.fields).toMatchObject({ bank_account: 'PromptPay' });
        expect(e.fields.bank_account_id).toBeUndefined();
        // and a slip to someone else is refused
        fetchMock.mockResolvedValue(aiReply({ ...goodSlip(), receiver_name: 'นาย อื่น คนอื่น', receiver_account: 'xxx-xxx-0000' }));
        expect((await run()).autoApprove).toBe(false);
    });
});

describe('loadReceiverCandidates', () => {
    it('lists active accounts and PromptPay, with masked labels', async () => {
        seed(`${B}/bank_accounts/acc2`, { id: 'acc2', bank_code: '014', bank_short: 'SCB', account_name: 'X', account_number: '9876543210', status: 'inactive' });
        seed(`${B}/data/config`, { bill_customization: { promptpay_name: 'P', promptpay_number: '081-234-5678' } });
        const { candidates, accounts } = await loadReceiverCandidates(OWNER, BLD);
        expect(accounts.map(a => a.id)).toEqual(['acc1']);
        expect(candidates).toEqual([
            { id: 'acc1', name: 'สมชาย ใจดี', number: '1234567890', label: 'KBANK ••••7890' },
            { id: 'promptpay', name: 'P', number: '0812345678', label: 'PromptPay' },
        ]);
    });
});
