import { describe, expect, it } from 'vitest';
import {
    SLIP_FUTURE_TOLERANCE_MS, checkDatetime, compareAccount, compareNames, describeChecks, normalizeName,
    parseSlipQr, senderBankFromQr, verifySlip, type ReceiverCandidate, type SlipDetails,
    checkSlipQr, crc16, inspectSlipQr, sameReference,
} from './_slip-verify.js';
import { bankFromText } from '../src/shared/banks.js';

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
    it('reads names whose words are cut off and masked', () => {
        expect(cmp('นาย สมช*** ใจ***', 'สมชาย ใจดี')).toBe('pass');
        expect(cmp('สมชxxx ใจxxx', 'นาย สมชาย ใจดี')).toBe('pass');
        expect(cmp('นาย สมช***', 'สมชาย ใจดี')).toBe('pass');
        expect(cmp('นาย ส*** ใ***', 'สมชาย ใจดี')).toBe('unknown');   // one letter each: not wrong, not proof
        expect(cmp('นาย สมศ*** ใจ***', 'สมชาย ใจดี')).toBe('fail');
        expect(cmp('นาย สมช*** รั***', 'สมชาย ใจดี')).toBe('fail');
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
        expect(cmp('MR. SOMCHAI J', 'สมชาย ใจดี (หอ A)')).toBe('unknown');   // a Thai name with a note in Latin letters
    });
    it('English names compare too', () => {
        expect(cmp('MR. SOMCHAI J', 'Somchai Jaidee')).toBe('pass');
        expect(cmp('MR. SOMSAK J', 'Somchai Jaidee')).toBe('fail');
        expect(cmp('MR.SOMCHAI J', 'Somchai Jaidee')).toBe('pass');         // no space after the title
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
    it('a PromptPay id that does not fit the account number proves nothing; against the PromptPay id on file it does', () => {
        expect(compareAccount('xxx-xxx-9999', REAL)).toBe('unknown');
        expect(compareAccount('x-xxxx-xxxxx-99-9', REAL)).toBe('unknown');
        expect(compareAccount('xxx-xxx-9999', '0891234567', 'promptpay')).toBe('fail');
        expect(compareAccount('xxx-xxx-4567', '0891234567', 'promptpay')).toBe('pass');
        expect(compareAccount('xxx-x-x1234-x', REAL)).toBe('fail');   // an account number, written as one
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
    it('never fails a slip for its age alone — late payment is normal', () => {
        expect(checkDatetime(new Date(now - 90 * 86400_000).toISOString(), null, now)).toBe('pass');
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
    it('rejects future-dated slips and old slips from before the bill; late ones and an unreadable time do not block', () => {
        expect(run({}, { datetime_iso: '2026-10-11T12:00:00+07:00' }).auto_approve).toBe(false);
        expect(run({ billCreatedAt: '2026-09-01T00:00:00+07:00' }, { datetime_iso: '2026-08-01T12:00:00+07:00' }).auto_approve).toBe(false);
        expect(run({ billCreatedAt: '2026-07-01T00:00:00+07:00' }, { datetime_iso: '2026-08-01T12:00:00+07:00' }).auto_approve).toBe(true);
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
    it('with no account on file the receiver name cannot be checked, so nothing is approved', () => {
        const v = run({ candidates: [] });
        expect(v.checks.receiver_name).toBe('unknown');
        expect(v.auto_approve).toBe(false);
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

describe('a slip that really is for the property', () => {
    const now = Date.parse('2026-11-17T05:00:00Z');
    const bank = { id: 'acc1', name: 'นางสาว ลดา ใจดี', number: '1234567890', label: 'KBANK' };
    const promptpay = { id: 'acc1', name: 'นางสาว ลดา ใจดี', number: '0891234567', label: 'KBANK', kind: 'promptpay' as const };
    const slip = (over: Partial<SlipDetails>): SlipDetails => ({
        amount: 3116.4, sender_name: 'นาย ก', receiver_name: 'น.ส. ลดา ใ', receiver_account: 'xxx-x-x6789-x', receiver_bank: null, sender_bank: null,
        datetime_iso: '2026-11-17T10:00:00+07:00', reference: null, ...over,
    });
    const run = (d: Partial<SlipDetails>, candidates = [bank, promptpay], expectedAmount = 3116.4) =>
        verifySlip({ details: slip(d), qrPresent: true, duplicate: false, expectedAmount, candidates, now });

    it('matches the account by its number or by its PromptPay id', () => {
        expect(run({}).auto_approve).toBe(true);                                            // bank account number
        const pp = run({ receiver_account: 'xxx-xxx-4567' });                               // paid to the PromptPay phone
        expect(pp.checks.receiver_account).toBe('pass');
        expect(pp.auto_approve).toBe(true);
    });
    it('forgives a character the reader got wrong in the name, and satang kept as a long decimal', () => {
        expect(run({ receiver_name: 'น.ส. ลดา ใจดิ' }).auto_approve).toBe(true);
        expect(run({}, [bank, promptpay], 3116.4000000000005).checks.amount).toBe('pass');
        expect(run({ amount: 3116.41 }).checks.amount).toBe('fail');
    });
    it('half a match waits for the owner instead of being called a mismatch', () => {
        const v = run({ receiver_account: 'xxx-xxx-9999' });                                // not the PromptPay number on file
        expect(v.checks).toMatchObject({ receiver_name: 'pass', receiver_account: 'fail' });
        expect(v.receiver_conflict).toBe(true);
        expect(v.auto_approve).toBe(false);
        const other = run({ receiver_name: 'นาย สมชาย รักดี', receiver_account: 'xxx-xxx-9999' });
        expect(other.receiver_conflict).toBe(false);                                        // nothing matches: someone else's account
        expect(other.checks.receiver_name).toBe('fail');
    });
    it('a PromptPay transfer is not "the wrong account" just because the property has no PromptPay id on file', () => {
        const v = run({ receiver_account: 'xxx-xxx-9999' }, [bank]);                        // only the account number is known
        expect(v.checks).toMatchObject({ receiver_name: 'pass', receiver_account: 'unknown' });
        expect(v.receiver_conflict).toBe(false);
        expect(v.auto_approve).toBe(true);                                                  // the name is the evidence
        // the slip's name in English cannot be compared either: nothing says it is wrong, so it waits — not a mismatch
        const en = run({ receiver_name: 'MS. LADA J', receiver_account: 'x-xxxx-xxxxx-12-3' }, [bank]);
        expect(en.checks).toMatchObject({ receiver_name: 'unknown', receiver_account: 'unknown' });
        expect(en.auto_approve).toBe(false);
    });
});

describe('the QR on a slip', () => {
    // published samples: a bank slip (Bangkok Bank), and TrueMoney Wallet's own format
    const BBL = '004000060000010103002021900021231231212000115102TH91049C30';
    const TRUEMONEY = '00480002010102010203P2P0313TXN00012345670408250120249104b425';
    const signed = (body: string) => body + crc16(body).toString(16).toUpperCase().padStart(4, '0');
    const bankQr = (bank: string, ref: string) => signed(`${tlv('00', tlv('00', '000001') + tlv('01', bank) + tlv('02', ref))}${tlv('51', 'TH')}9104`);
    const read = (over: Partial<SlipDetails> = {}): SlipDetails => ({
        amount: 100, sender_name: null, receiver_name: null, receiver_account: null, receiver_bank: null, sender_bank: null,
        datetime_iso: null, reference: null, ...over,
    });

    it('computes the checksum banks use', () => {
        expect(crc16('123456789')).toBe(0x29B1);
        expect(crc16(BBL.slice(0, -4))).toBe(0x9C30);
    });

    it('takes a bank slip apart and checks its checksum', () => {
        expect(inspectSlipQr(BBL)).toEqual({ kind: 'bank', crc_ok: true, bank_code: '002', reference: '0002123123121200011', ref_date: null });
        expect(inspectSlipQr(` ${BBL}\n`)?.crc_ok).toBe(true);
        // one character changed anywhere — the reference, the bank, the checksum itself — and it no longer holds
        expect(inspectSlipQr(BBL.replace('0002123', '0002124'))?.crc_ok).toBe(false);
        expect(inspectSlipQr(BBL.replace('0103002', '0103014'))?.crc_ok).toBe(false);
        expect(inspectSlipQr(BBL.slice(0, -1) + '1')?.crc_ok).toBe(false);
        expect(inspectSlipQr(BBL.slice(0, -8))).toMatchObject({ kind: 'bank', crc_ok: false });   // no checksum at all
    });

    it('reads TrueMoney, with its lowercase checksum and the day inside', () => {
        expect(inspectSlipQr(TRUEMONEY)).toEqual({ kind: 'truemoney', crc_ok: true, bank_code: null, reference: 'TXN0001234567', ref_date: '2024-01-25' });
    });

    it('accepts a checksum whose leading zero the bank app dropped', () => {
        // find a reference whose checksum starts with 0, then write it the way such an app does
        const ref = Array.from({ length: 400 }, (_, i) => `2026111712345${String(i).padStart(4, '0')}`).find(r => bankQr('014', r).slice(-4).startsWith('0'))!;
        const full = bankQr('014', ref);
        const short = `${full.slice(0, -8)}9103${full.slice(-3)}`;
        expect(inspectSlipQr(short)).toMatchObject({ kind: 'bank', crc_ok: true, reference: ref, ref_date: '2026-11-17' });
        expect(inspectSlipQr(`${full.slice(0, -4)}${full.slice(-3)}`)?.crc_ok).toBe(true);
    });

    it('tells a slip QR from a QR to pay into and from anything else', () => {
        expect(inspectSlipQr('00020101021129370016A000000677010111011300668123456785802TH530376463041234')?.kind).toBe('payment');
        for (const other of ['https://line.me/R/ti/p/@horcare', 'WIFI:T:WPA;S:dorm;P:12345678;;', '0099abc', tlv('51', 'TH')]) {
            expect(inspectSlipQr(other)?.kind).toBe('other');
        }
        expect(inspectSlipQr(null)).toBeNull();
        expect(inspectSlipQr('  ')).toBeNull();
    });

    it('only reads a date from a reference that really starts with one', () => {
        expect(inspectSlipQr(bankQr('014', '2026111712345ABCDEFGHIJKL'))?.ref_date).toBe('2026-11-17');
        expect(inspectSlipQr(bankQr('014', '2026133112345ABCDEFGHIJKL'))?.ref_date).toBeNull();   // month 13
        expect(inspectSlipQr(bankQr('014', '2026023012345ABCDEFGHIJKL'))?.ref_date).toBeNull();   // 30 February
        expect(inspectSlipQr(bankQr('004', '016321145500BTF01234'))?.ref_date).toBeNull();
    });

    it('matches the printed reference allowing for how it is printed and misread', () => {
        expect(sameReference('016321145500BTF01234', '016321145500BTF01234')).toBe(true);
        expect(sameReference('016321145500BTF01234', '0163 2114 5500 btf0 1234')).toBe(true);
        expect(sameReference('016321145500BTF01234', 'O1632114550OBTFO1234')).toBe(true);           // O read for 0
        expect(sameReference('016321145500BTF01234', 'Ref. 016321145500BTF01234 / 9')).toBe(true);
        expect(sameReference('016321145500BTF01234', '016321145500BTF01284')).toBe(true);           // one character misread
        expect(sameReference('016321145500BTF01234', '016321999900BTF09999')).toBe(false);
        expect(sameReference('016321145500BTF01234', '1234')).toBe(false);
    });

    it('names the bank a slip shows', () => {
        expect(bankFromText('ธ.กสิกรไทย')?.short).toBe('KBANK');
        expect(bankFromText('K PLUS')?.short).toBe('KBANK');
        expect(bankFromText('SCB')?.short).toBe('SCB');
        expect(bankFromText('ธนาคารกรุงเทพ')?.short).toBe('BBL');
        expect(bankFromText('กรุงเทพ')?.short).toBe('BBL');
        expect(bankFromText('Krungthai NEXT')?.short).toBe('KTB');
        expect(bankFromText('กรุงศรี')?.short).toBe('BAY');
        expect(bankFromText('ttb')?.short).toBe('TTB');
        expect(bankFromText('ออมสิน')?.short).toBe('GSB');
        expect(bankFromText('TrueMoney Wallet')).toBeUndefined();
        expect(bankFromText('SCB / KBANK')).toBeUndefined();
        expect(bankFromText(null)).toBeUndefined();
    });

    it('passes a QR that agrees with the slip, or that the slip says nothing against', () => {
        const info = inspectSlipQr(bankQr('014', '2026111712345ABCDEFGHIJKL'));
        expect(checkSlipQr(info, read())).toEqual({ check: 'pass', issues: [] });
        expect(checkSlipQr(info, null).check).toBe('pass');
        expect(checkSlipQr(info, read({ sender_bank: 'ไทยพาณิชย์', datetime_iso: '2026-11-17T23:59:00+07:00', references: ['2026111712345ABCDEFGHIJKL'] })).check).toBe('pass');
        expect(checkSlipQr(info, read({ datetime_iso: '2026-11-18T00:02:00+07:00' })).check).toBe('pass');   // around midnight
        expect(checkSlipQr(info, read({ sender_bank: 'ธนาคารที่ไม่รู้จัก', reference: 'R1' })).check).toBe('pass');
        expect(checkSlipQr(inspectSlipQr(TRUEMONEY), read({ sender_bank: 'TrueMoney', datetime_iso: '2024-01-25T10:00:00+07:00' })).check).toBe('pass');
        expect(checkSlipQr(null, read()).check).toBe('unknown');
    });

    it('fails a QR that disagrees with the slip it is on, and says how', () => {
        const info = inspectSlipQr(bankQr('014', '2026111712345ABCDEFGHIJKL'));
        const all = checkSlipQr(info, read({ sender_bank: 'กสิกรไทย', datetime_iso: '2026-11-20T10:00:00+07:00', reference: '016321145500BTF01234' }));
        expect(all.check).toBe('fail');
        expect(all.issues).toHaveLength(3);
        expect(checkSlipQr(inspectSlipQr(TRUEMONEY), read({ datetime_iso: '2026-11-17T10:00:00+07:00' })).check).toBe('fail');
        expect(checkSlipQr(inspectSlipQr(BBL.slice(0, -1) + '1'), read()).issues[0]).toContain('CRC');
    });

    it('verifySlip: a slip with everything right but a QR that fails is not approved', () => {
        const acc: ReceiverCandidate = { id: 'acc1', name: 'สมชาย ใจดี', number: '1234567890', label: 'KBANK' };
        const now = Date.parse('2026-11-17T05:00:00Z');
        const slip = read({ amount: 3500, receiver_name: 'นาย สมชาย ใ', receiver_account: 'xxx-x-x6789-x', datetime_iso: '2026-11-17T10:00:00+07:00' });
        const run = (qrPayload: string | null) => verifySlip({ details: slip, qrPresent: !!qrPayload, qrPayload, duplicate: false, expectedAmount: 3500, candidates: [acc], now });
        const good = bankQr('014', '2026111712345ABCDEFGHIJKL');
        expect(run(good)).toMatchObject({ auto_approve: true, qr_issues: [] });
        const forged = run(good.slice(0, -4) + 'FFFF');
        expect(forged.auto_approve).toBe(false);
        expect(forged.checks).toMatchObject({ amount: 'pass', receiver_name: 'pass', qr: 'fail' });
        expect(run(null).checks.qr).toBe('unknown');
        expect(describeChecks(forged.checks)).toContain('ไม่ผ่าน: QR สลิป');
    });
});
