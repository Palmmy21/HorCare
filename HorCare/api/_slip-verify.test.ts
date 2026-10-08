import { describe, expect, it } from 'vitest';
import {
    SLIP_FUTURE_TOLERANCE_MS, SLIP_MAX_AGE_MS, checkDatetime, compareAccount, compareNames, describeChecks, normalizeName,
    parseSlipQr, senderBankFromQr, verifySlip, type ReceiverCandidate, type SlipDetails,
} from './_slip-verify.js';

const tlv = (id: string, value: string) => `${id}${String(value.length).padStart(2, '0')}${value}`;
const slipQr = (bank = '014', ref = 'ABCDEFGHIJ1234567890XYZ') =>
    tlv('00', tlv('00', '000001') + tlv('01', bank) + tlv('02', ref)) + tlv('51', 'TH') + tlv('91', 'CAFE');

describe('parseSlipQr', () => {
    it('reads the sending bank and transaction reference', () => {
        expect(parseSlipQr(slipQr())).toEqual({ bank_code: '014', reference: 'ABCDEFGHIJ1234567890XYZ' });
        expect(senderBankFromQr(slipQr('004'))?.short).toBe('KBANK');
    });
    it('is safe on junk, truncated or missing data', () => {
        for (const bad of [null, '', 'hello', '00', '0099abc', '0041' + 'x'.repeat(10), tlv('51', 'TH')]) {
            expect(parseSlipQr(bad as string | null)).toEqual({ bank_code: null, reference: null });
        }
        expect(senderBankFromQr('garbage')).toBeUndefined();
    });
    it('ignores a bank code that is not 3 digits and an implausible reference', () => {
        expect(parseSlipQr(tlv('00', tlv('01', '14') + tlv('02', 'abc')))).toEqual({ bank_code: null, reference: null });
    });
});

describe('normalizeName', () => {
    it('removes titles at the start only, never letters inside a word', () => {
        expect(normalizeName('นาย สมชาย ใจดี')).toEqual(['สมชาย', 'ใจดี']);
        expect(normalizeName('นายสมชาย ใจดี')).toEqual(['สมชาย', 'ใจดี']);
        expect(normalizeName('น.ส. สมหญิง รักดี')).toEqual(['สมหญิง', 'รักดี']);
        expect(normalizeName('นางสาวสมหญิง')).toEqual(['สมหญิง']);
        // a surname that merely contains/ends with title letters is untouched
        expect(normalizeName('สมชาย ศรีนาย')).toEqual(['สมชาย', 'ศรีนาย']);
        expect(normalizeName('MR. John SMITH')).toEqual(['john', 'smith']);
        expect(normalizeName('บริษัท เอบีซี จำกัด')).toEqual(['เอบีซี']);
        expect(normalizeName('   ')).toEqual([]);
    });
});

describe('compareNames', () => {
    const cmp = compareNames;
    it('passes when the names agree, ignoring titles and spacing', () => {
        expect(cmp('นาย สมชาย ใจดี', 'สมชาย ใจดี')).toBe('pass');
        expect(cmp('นายสมชาย ใจดี', 'นาย สมชาย ใจดี')).toBe('pass');
        expect(cmp('บริษัท เอบีซี จำกัด', 'เอบีซี')).toBe('pass');
    });
    it('accepts the shortened / masked surnames slips print', () => {
        expect(cmp('น.ส. สมหญิง ร', 'สมหญิง รักดี')).toBe('pass');
        expect(cmp('นาย สมชาย ใจ***', 'สมชาย ใจดี')).toBe('pass');
        expect(cmp('สมชาย', 'สมชาย ใจดี')).toBe('pass');
        expect(cmp('ใจดี', 'สมชาย ใจดี')).toBe('pass');
    });
    it('fails for a different person', () => {
        expect(cmp('นาย สมศักดิ์ ใจดี', 'สมชาย ใจดี')).toBe('fail');
        expect(cmp('สมชาย ว', 'สมชาย ใจดี')).toBe('fail');
        expect(cmp('สม', 'สมชาย ใจดี')).toBe('fail');
    });
    it('is "unknown" when it cannot compare (missing data, or Thai vs English spelling)', () => {
        expect(cmp(null, 'สมชาย')).toBe('unknown');
        expect(cmp('สมชาย', null)).toBe('unknown');
        expect(cmp('', 'สมชาย')).toBe('unknown');
        expect(cmp('xxx', 'สมชาย')).toBe('unknown');
        expect(cmp('MR. SOMCHAI J', 'สมชาย ใจดี')).toBe('unknown');
        expect(cmp('นาย สมชาย', 'SOMCHAI JAIDEE')).toBe('unknown');
    });
    it('English names compare too', () => {
        expect(cmp('MR. SOMCHAI J', 'Somchai Jaidee')).toBe('pass');
        expect(cmp('MR. SOMSAK J', 'Somchai Jaidee')).toBe('fail');
    });
});

describe('compareAccount', () => {
    // Account 1234567890 — a typical slip prints "xxx-x-x6789-x" (digits 6–9 visible).
    const REAL = '1234567890';
    it('matches visible digits in place when the length agrees', () => {
        expect(compareAccount('xxx-x-x6789-x', REAL)).toBe('pass');
        expect(compareAccount('xxx-x-x1234-x', REAL)).toBe('fail');
        expect(compareAccount('XXX-X-X6789-X', '123-4-56789-0')).toBe('pass');
        expect(compareAccount('xxx-xxx-7890', REAL)).toBe('pass');
        expect(compareAccount('12345xxxxx', REAL)).toBe('pass');
        expect(compareAccount('12346xxxxx', REAL)).toBe('fail');
    });
    it('falls back to visible digit runs when the layout differs', () => {
        expect(compareAccount('xxxx7890', REAL)).toBe('pass');
        expect(compareAccount('***9999', REAL)).toBe('fail');
        expect(compareAccount('••••7890', REAL)).toBe('pass');
    });
    it('is unknown when the slip shows too little or nothing usable', () => {
        expect(compareAccount('xxx-x-xxxx-x', REAL)).toBe('unknown');
        expect(compareAccount('xx12', REAL)).toBe('unknown');
        expect(compareAccount(null, REAL)).toBe('unknown');
        expect(compareAccount('xxx7890', null)).toBe('unknown');
        expect(compareAccount('xxx7890', '123')).toBe('unknown');
    });
});
describe('checkDatetime', () => {
    const now = Date.parse('2026-10-10T12:00:00+07:00');
    const iso = (d: string) => d;
    it('passes a recent slip', () => expect(checkDatetime(iso('2026-10-10T09:30:00+07:00'), null, now)).toBe('pass'));
    it('fails slips from the future (beyond a small clock tolerance)', () => {
        expect(checkDatetime(new Date(now + SLIP_FUTURE_TOLERANCE_MS - 1000).toISOString(), null, now)).toBe('pass');
        expect(checkDatetime(new Date(now + SLIP_FUTURE_TOLERANCE_MS + 60_000).toISOString(), null, now)).toBe('fail');
    });
    it('fails stale slips', () => {
        expect(checkDatetime(new Date(now - SLIP_MAX_AGE_MS + 3600_000).toISOString(), null, now)).toBe('pass');
        expect(checkDatetime(new Date(now - SLIP_MAX_AGE_MS - 3600_000).toISOString(), null, now)).toBe('fail');
    });
    it('fails a slip that predates the bill by more than a few days', () => {
        const bill = '2026-10-05T00:00:00+07:00';
        expect(checkDatetime('2026-10-04T10:00:00+07:00', bill, now)).toBe('pass');   // within 3 days — early payment
        expect(checkDatetime('2026-09-25T10:00:00+07:00', bill, now)).toBe('fail');
    });
    it('is unknown without a readable time', () => {
        expect(checkDatetime(null, null, now)).toBe('unknown');
        expect(checkDatetime('not a date', null, now)).toBe('unknown');
    });
});

describe('verifySlip', () => {
    const now = Date.parse('2026-10-10T12:00:00+07:00');
    const acct: ReceiverCandidate = { id: 'acc1', name: 'สมชาย ใจดี', number: '1234567890', label: 'KBANK ••••7890' };
    const pp: ReceiverCandidate = { id: 'promptpay', name: 'สมชาย ใจดี', number: '0812345678', label: 'PromptPay' };
    const good: SlipDetails = {
        amount: 3500, sender_name: 'น.ส. มาลี', receiver_name: 'นาย สมชาย ใ', receiver_account: 'xxx-x-x6789-x',
        receiver_bank: 'กสิกรไทย', sender_bank: 'ไทยพาณิชย์', datetime_iso: '2026-10-10T09:30:00+07:00', reference: 'R1',
    };
    const run = (over: Partial<Parameters<typeof verifySlip>[0]> = {}, details: Partial<SlipDetails> | null = {}) =>
        verifySlip({
            details: details === null ? null : { ...good, ...details }, qrPresent: true, duplicate: false, expectedAmount: 3500,
            candidates: [acct], now, ...over,
        });

    it('auto-approves when amount, receiver, time and QR all check out', () => {
        const v = run();
        expect(v.checks).toEqual({ amount: 'pass', receiver_name: 'pass', receiver_account: 'pass', datetime: 'pass', duplicate: 'pass', qr: 'pass' });
        expect(v.matched_candidate_id).toBe('acc1');
        expect(v.auto_approve).toBe(true);
    });
    it('does not approve a wrong amount, even by a little', () => {
        for (const amount of [3499.99, 3501, 350, 0]) expect(run({}, { amount }).auto_approve).toBe(false);
        expect(run({}, { amount: 3500.0 }).auto_approve).toBe(true);
        expect(run({}, { amount: null }).checks.amount).toBe('unknown');
        expect(run({}, { amount: null }).auto_approve).toBe(false);
    });
    it('does not approve a slip paid to someone else', () => {
        const v = run({}, { receiver_name: 'นาย สมศักดิ์ ใจดี', receiver_account: 'xxx-x-x9999-x' });
        expect(v.checks.receiver_name).toBe('fail');
        expect(v.checks.receiver_account).toBe('fail');
        expect(v.auto_approve).toBe(false);
    });
    it('a conflict between name and account blocks approval even if one matches', () => {
        expect(run({}, { receiver_account: 'xxx-x-x9999-x' }).auto_approve).toBe(false); // name ok, number wrong
        expect(run({}, { receiver_name: 'นาย สมศักดิ์ ใจดี' }).auto_approve).toBe(false); // number ok, name wrong
    });
    it('one matching signal is enough when the other cannot be read', () => {
        expect(run({}, { receiver_account: null }).auto_approve).toBe(true);
        expect(run({}, { receiver_name: null }).auto_approve).toBe(true);
        expect(run({}, { receiver_name: null, receiver_account: null }).auto_approve).toBe(false); // nothing identifies the receiver
    });
    it('requires a slip QR and rejects duplicates', () => {
        expect(run({ qrPresent: false }).auto_approve).toBe(false);
        const dup = run({ duplicate: true });
        expect(dup.checks.duplicate).toBe('fail');
        expect(dup.auto_approve).toBe(false);
    });
    it('rejects future-dated and stale slips; an unreadable time does not block', () => {
        expect(run({}, { datetime_iso: '2026-10-11T12:00:00+07:00' }).auto_approve).toBe(false);
        expect(run({}, { datetime_iso: '2026-08-01T12:00:00+07:00' }).auto_approve).toBe(false);
        expect(run({}, { datetime_iso: null }).auto_approve).toBe(true);
    });
    it('accepts a payment to ANY registered account and reports which one', () => {
        const other: ReceiverCandidate = { id: 'acc2', name: 'มาลี รักษ์ดี', number: '9876543210', label: 'SCB ••••3210' };
        const v = run({ candidates: [other, acct] });
        expect(v.matched_candidate_id).toBe('acc1');
        expect(v.auto_approve).toBe(true);
        const v2 = run({ candidates: [other, acct] }, { receiver_name: 'มาลี รัก', receiver_account: 'xxx-x-x4321-x' });
        expect(v2.matched_candidate_id).toBe('acc2');
    });
    it('PromptPay details count as a receiving account', () => {
        const v = run({ candidates: [pp] }, { receiver_account: 'xxx-xxx-5678' });
        expect(v.matched_candidate_id).toBe('promptpay');
        expect(v.auto_approve).toBe(true);
    });
    it('with no account on file it keeps the old rule: amount + QR + not duplicate', () => {
        const v = run({ candidates: [] });
        expect(v.checks.receiver_name).toBe('unknown');
        expect(v.auto_approve).toBe(true);
        expect(run({ candidates: [] }, { amount: 100 }).auto_approve).toBe(false);
    });
    it('without any readable details nothing is approved', () => {
        expect(run({}, null).auto_approve).toBe(false);
        expect(run({ candidates: [] }, null).auto_approve).toBe(false);
    });
    it('describes the outcome for the owner in Thai', () => {
        const text = describeChecks(run({}, { receiver_account: 'xxx-x-x9999-x' }).checks);
        expect(text).toContain('ผ่าน:');
        expect(text).toContain('ไม่ผ่าน: เลขบัญชีผู้รับ');
    });
});
