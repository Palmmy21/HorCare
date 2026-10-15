import { describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import { buildSlipResultFlex } from './_slip-flex.js';
import type { SlipEvaluation } from './_slip-flow.js';

const details = {
    amount: 3500, sender_name: 'น.ส. มาลี', receiver_name: 'นาย สมชาย ใ', receiver_account: 'xxx-x-x6789-x',
    receiver_bank: 'กสิกรไทย', sender_bank: 'ไทยพาณิชย์', datetime_iso: '2026-10-15T09:30:00+07:00', reference: 'R1',
};
const evaluation = (over: Partial<SlipEvaluation>): SlipEvaluation => ({
    autoApprove: false, outcome: 'review', problems: [], qrPresent: true, details: null, verdict: null,
    fields: {}, verifyNote: '', aiAmount: null, ...over,
});
const checks = (amount: 'pass' | 'fail') => ({
    checks: { amount, receiver_name: 'pass', receiver_account: 'pass', datetime: 'pass', duplicate: 'pass', qr: 'pass' } as const,
    matched_candidate_id: 'acc1', auto_approve: amount === 'pass',
});
const build = (e: SlipEvaluation) => buildSlipResultFlex({ roomNumber: '101', dormName: 'บ้านสุข', itemLabel: 'บิล ต.ค. 2569', expectedAmount: 3500, evaluation: e });

/** Every text LINE would render; LINE rejects a text node with an empty `text`. */
function texts(node: unknown, out: string[] = []): string[] {
    if (Array.isArray(node)) node.forEach(n => texts(n, out));
    else if (node && typeof node === 'object') {
        const o = node as Record<string, unknown>;
        if (o.type === 'text') {
            expect(typeof o.text === 'string' && o.text.length > 0).toBe(true);
            out.push(o.text as string);
        }
        Object.values(o).forEach(v => texts(v, out));
    }
    return out;
}

describe('buildSlipResultFlex', () => {
    it('approved: status, dorm, slip rows, every check "ตรง" and the amounts', () => {
        const f = build(evaluation({ outcome: 'approved', autoApprove: true, details, aiAmount: 3500, verdict: checks('pass') })) as { altText: string };
        const all = texts(f);
        expect(all).toEqual(expect.arrayContaining(['ชำระสำเร็จ', 'บ้านสุข', 'ห้อง 101 · บิล ต.ค. 2569', 'น.ส. มาลี', 'ไทยพาณิชย์', '฿3,500.00']));
        expect(all.filter(t => t === 'ตรง')).toHaveLength(4);
        expect(f.altText).toContain('ได้รับยอดชำระ');
    });

    it('mismatch: the failing check and the problems are shown', () => {
        const f = build(evaluation({
            outcome: 'mismatch', details: { ...details, amount: 3000 }, aiAmount: 3000, verdict: checks('fail'),
            problems: ['ยอดในสลิป ฿3,000 ไม่ตรงกับยอดที่ต้องชำระ ฿3,500'],
        }));
        const all = texts(f);
        expect(all).toEqual(expect.arrayContaining(['สลิปไม่ตรงกับบิล', 'ไม่ตรง', '฿3,000.00', 'ยอดในสลิป ฿3,000 ไม่ตรงกับยอดที่ต้องชำระ ฿3,500']));
    });

    it('review without AI details: no check rows, nothing says "ตรง"', () => {
        const all = texts(build(evaluation({ outcome: 'review', qrPresent: false })));
        expect(all).toContain('รอตรวจสอบ');
        expect(all).not.toContain('ตรง');
        expect(all).toContain('อ่าน QR ในสลิปไม่ชัด เจ้าของหอจะตรวจสอบให้ค่ะ');
    });
});
