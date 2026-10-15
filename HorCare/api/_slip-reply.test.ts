import { describe, expect, it } from 'vitest';
import { billLabel, buildSlipFlex, classifySlip, type SlipReplyInput } from './_slip-reply.js';
import type { SlipEvaluation } from './_slip-flow.js';
import type { SlipChecks } from '../src/types/index.js';

const checks = (over: Partial<SlipChecks> = {}): SlipChecks => ({ amount: 'pass', receiver_name: 'pass', receiver_account: 'pass', datetime: 'pass', duplicate: 'pass', qr: 'pass', ...over });
const ev = (over: Partial<SlipEvaluation> & { c?: Partial<SlipChecks>; amount?: number | null } = {}): SlipEvaluation => ({
    autoApprove: false, fields: {}, verifyNote: '', aiAmount: over.amount === undefined ? 3500 : over.amount,
    details: { amount: over.amount === undefined ? 3500 : over.amount, sender_name: 'สมชาย', receiver_name: 'หอพัก ทดสอบ', receiver_account: 'xxx-x-x1234-x', receiver_bank: null, sender_bank: null, datetime_iso: '2026-10-08T14:32:00+07:00', reference: 'REF123456' },
    verdict: { checks: checks(over.c), matched_candidate_id: null, auto_approve: false },
    ...over,
}) as SlipEvaluation;
const input = (over: Partial<SlipReplyInput> = {}): SlipReplyInput => ({
    roomNumber: '203', dormName: 'ONE9 LIFE', targetLabel: 'บิลเดือน ตุลาคม 2569', expectedAmount: 3500, evaluation: ev(), duplicate: null, qrPresent: true, ...over,
});
const text = (o: object) => JSON.stringify(o);

describe('which card the tenant gets', () => {
    it('a matching slip is "paid"', () => {
        expect(classifySlip(input({ evaluation: ev({ autoApprove: true }) }))).toBe('paid');
    });
    it('a repeated slip is a duplicate even if everything else looks fine', () => {
        expect(classifySlip(input({ duplicate: { sameRoom: true }, evaluation: ev({ autoApprove: true }) }))).toBe('duplicate');
    });
    it('names the single most useful problem, receiver first, then amount, then date', () => {
        expect(classifySlip(input({ evaluation: ev({ c: { receiver_name: 'fail' } }) }))).toBe('wrong_receiver');
        expect(classifySlip(input({ evaluation: ev({ c: { receiver_account: 'fail', amount: 'fail' } }) }))).toBe('wrong_receiver');
        expect(classifySlip(input({ evaluation: ev({ amount: 3000, c: { amount: 'fail' } }) }))).toBe('wrong_amount');
        expect(classifySlip(input({ evaluation: ev({ c: { datetime: 'fail' } }) }))).toBe('old_slip');
    });
    it('anything it cannot judge waits for the owner (no AI, unreadable slip)', () => {
        expect(classifySlip(input({ evaluation: null }))).toBe('review');
        expect(classifySlip(input({ evaluation: ev({ c: { amount: 'unknown', receiver_name: 'unknown', receiver_account: 'unknown' } }) }))).toBe('review');
    });
});

describe('the Flex messages', () => {
    it('paid: says paid and the amount, when and the reference', () => {
        const m = buildSlipFlex(input({ evaluation: ev({ autoApprove: true }) }));
        const s = text(m);
        expect(m.type).toBe('flex');
        expect(m.altText).toContain('ชำระเงินเรียบร้อย');
        expect(m.altText).toContain('฿3,500');
        for (const piece of ['฿3,500', 'จ่ายแล้ว', 'REF123456', 'ห้อง', '203', 'ONE9 LIFE', 'บิลเดือน ตุลาคม 2569', '#16A34A']) expect(s).toContain(piece);
    });

    it('wrong amount: shows what was due, what was sent and exactly how much is short', () => {
        const m = buildSlipFlex(input({ evaluation: ev({ amount: 3000, c: { amount: 'fail' } }) }));
        const s = text(m);
        expect(m.altText).toContain('ยอดเงินไม่ตรงกับบิล');
        for (const piece of ['฿3,500', '฿3,000', 'ยังขาดอีก', '฿500']) expect(s).toContain(piece);
        expect(s).toContain('กรุณาโอนส่วนที่ขาด');
    });

    it('over-payment says "over", not "short"', () => {
        const s = text(buildSlipFlex(input({ evaluation: ev({ amount: 4000, c: { amount: 'fail' } }) })));
        expect(s).toContain('โอนเกิน');
        expect(s).not.toContain('ยังขาดอีก');
    });

    it('an unreadable amount does not invent a number', () => {
        const s = text(buildSlipFlex(input({ evaluation: ev({ amount: null, c: { amount: 'fail' } }) })));
        expect(s).toContain('อ่านยอดไม่ได้');
        expect(s).not.toContain('ยังขาดอีก');
    });

    it('wrong receiver: shows who the slip says received it and the property\'s own account', () => {
        const m = buildSlipFlex(input({ receiverHint: 'KBANK ••••1234 · หอพัก ทดสอบ', evaluation: ev({ c: { receiver_name: 'fail' } }) }));
        const s = text(m);
        expect(m.altText).toContain('บัญชีผู้รับไม่ตรง');
        for (const piece of ['ผู้รับในสลิป', 'หอพัก ทดสอบ', 'บัญชีของหอ', 'KBANK']) expect(s).toContain(piece);
    });

    it('duplicate: never reveals another room, and says when it was used', () => {
        const other = text(buildSlipFlex(input({ evaluation: null, duplicate: { sameRoom: false, usedAt: '2026-10-01T05:00:00Z' } })));
        expect(other).toContain('สลิปนี้ถูกใช้แล้ว');
        expect(other).toContain('ใช้ไปแล้วเมื่อ');
        expect(other).not.toMatch(/ห้อง\s*(?!203)\d+/); // only this tenant's own room appears
        const same = text(buildSlipFlex(input({ evaluation: null, duplicate: { sameRoom: true } })));
        expect(same).toContain('ห้องคุณไปแล้ว');
    });

    it('old slip and review cards explain what happens next', () => {
        expect(text(buildSlipFlex(input({ evaluation: ev({ c: { datetime: 'fail' } }) })))).toContain('วันที่ในสลิป');
        const review = text(buildSlipFlex(input({ evaluation: null, qrPresent: false })));
        expect(review).toContain('รอตรวจสอบ');
        expect(review).toContain('อ่านสลิปไม่ชัด');
    });

    it('stays inside LINE limits: altText ≤ 400, and every text is a non-empty string', () => {
        for (const e of [null, ev(), ev({ autoApprove: true }), ev({ c: { amount: 'fail' }, amount: 1 })]) {
            const m = buildSlipFlex(input({ evaluation: e, dormName: 'ก'.repeat(500) }));
            expect(m.altText.length).toBeLessThanOrEqual(400);
            const walk = (n: unknown) => {
                if (Array.isArray(n)) n.forEach(walk);
                else if (n && typeof n === 'object') {
                    const o = n as Record<string, unknown>;
                    if (o.type === 'text') expect(typeof o.text === 'string' && (o.text as string).length > 0).toBe(true);
                    Object.values(o).forEach(walk);
                }
            };
            walk(m.contents);
        }
    });
});

describe('billLabel', () => {
    it('writes the month in Thai with the Buddhist year, and handles fines and junk', () => {
        expect(billLabel('2026-10', false)).toBe('บิลเดือน ตุลาคม 2569');
        expect(billLabel('2026-01', false)).toBe('บิลเดือน มกราคม 2569');
        expect(billLabel('2026-13', false)).toBe('บิลล่าสุด');
        expect(billLabel(undefined, false)).toBe('บิลล่าสุด');
        expect(billLabel('2026-10', true)).toBe('ค่าปรับ');
    });
});
