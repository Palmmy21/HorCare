import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseAmount, parseSlipDatetime, parseSlipDetails, readSlipDetails } from './_slip-ai.js';

const fetchMock = vi.fn();
beforeEach(() => {
    for (const k of ['OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'AI_PROVIDER']) delete process.env[k];
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const orReply = (text: string) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: text } }] }), text: async () => text });

describe('parseAmount', () => {
    it('accepts numbers and clean numeric strings', () => {
        expect(parseAmount(1500)).toBe(1500);
        expect(parseAmount('1,500.00')).toBe(1500);
        expect(parseAmount('3500')).toBe(3500);
        expect(parseAmount(0)).toBe(0);
    });
    it('rejects junk', () => {
        for (const v of [null, undefined, -1, NaN, Infinity, 'abc', '1500 baht', '1,50', [1], {}, true]) expect(parseAmount(v)).toBeNull();
    });
});

describe('parseSlipDatetime', () => {
    it('normalises to ISO with the Thai offset', () => {
        expect(parseSlipDatetime('2026-10-08T14:30')).toBe('2026-10-08T14:30:00+07:00');
        expect(parseSlipDatetime('2026-10-08 14:30:45')).toBe('2026-10-08T14:30:45+07:00');
    });
    it('converts a Buddhist Era year', () => {
        expect(parseSlipDatetime('2569-10-08T14:30')).toBe('2026-10-08T14:30:00+07:00');
    });
    it('ignores a zone suffix the model added (slips are Thai local time)', () => {
        expect(parseSlipDatetime('2026-10-08T14:30:00Z')).toBe('2026-10-08T14:30:00+07:00');
    });
    it('rejects impossible or implausible values', () => {
        for (const v of ['2026-02-31T10:00', '2026-13-01T10:00', '2026-10-08T25:00', '2026-10-08T10:61', '1999-01-01T10:00', '2300-01-01T10:00',
            '8 ต.ค. 69 14:30', '', null, 42, undefined]) {
            expect(parseSlipDatetime(v)).toBeNull();
        }
    });
});

describe('parseSlipDetails', () => {
    const full = {
        amount: 3500, sender_name: 'น.ส. มาลี', receiver_name: 'นาย สมชาย ใ', receiver_account: 'xxx-x-x6789-x',
        receiver_bank: 'กสิกรไทย', sender_bank: 'ไทยพาณิชย์', datetime: '2569-10-08T14:30', reference: 'REF123',
    };
    it('maps a complete reply', () => {
        expect(parseSlipDetails(JSON.stringify(full))).toEqual({
            amount: 3500, sender_name: 'น.ส. มาลี', receiver_name: 'นาย สมชาย ใ', receiver_account: 'xxx-x-x6789-x',
            receiver_bank: 'กสิกรไทย', sender_bank: 'ไทยพาณิชย์', datetime_iso: '2026-10-08T14:30:00+07:00', reference: 'REF123',
        });
    });
    it('tolerates fenced output and missing fields', () => {
        const d = parseSlipDetails('```json\n{"amount":"1,200.50"}\n```');
        expect(d).toMatchObject({ amount: 1200.5, receiver_name: null, datetime_iso: null });
    });
    it('treats wrong types as missing and caps text length', () => {
        const d = parseSlipDetails(JSON.stringify({ amount: 'lots', receiver_name: 'x'.repeat(500), sender_name: 42, reference: ['a'] }));
        expect(d!.amount).toBeNull();
        expect(d!.receiver_name!.length).toBe(100);
        expect(d!.sender_name).toBeNull();
        expect(d!.reference).toBeNull();
    });
    it('returns null for non-objects and non-JSON', () => {
        for (const raw of ['', 'sorry I cannot read this', '[1,2]', 'null', '42']) expect(parseSlipDetails(raw)).toBeNull();
    });
});

describe('readSlipDetails', () => {
    it('is null when no AI is configured, and never throws', async () => {
        expect(await readSlipDetails('AAAA', 'image/jpeg')).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });
    it('asks the vision model for JSON and returns the parsed details', async () => {
        process.env.OPENROUTER_API_KEY = 'k';
        fetchMock.mockResolvedValue(orReply('{"amount":3500,"receiver_name":"สมชาย ใจดี"}'));
        const d = await readSlipDetails('AAAA', 'image/png');
        expect(d).toMatchObject({ amount: 3500, receiver_name: 'สมชาย ใจดี' });
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.messages[0].content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } });
        expect(body.messages[0].content[0].text).toContain('receiver_account');
    });
    it('is null when the provider fails', async () => {
        process.env.OPENROUTER_API_KEY = 'k';
        fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}), text: async () => 'down' });
        expect(await readSlipDetails('AAAA', 'image/jpeg')).toBeNull();
    });
});
