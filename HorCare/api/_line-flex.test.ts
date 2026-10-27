import { describe, expect, it } from 'vitest';
import { buildBillFlex, buildFineFlex, parseSplitModePostback, splitModePostbackData } from './_line.js';
import type { Fine, MonthlyBill } from '../src/types/index.js';

const bill = (over: Partial<MonthlyBill> = {}) => ({
    id: 'bill1', room_id: 'r1', room_number: '101', month: '2026-10', elec_units: 10, water_units: 2,
    elec_bill: 80, water_bill: 36, room_rent: 3000, total_bill: 3116, payment_status: 'unpaid', ...over,
}) as MonthlyBill;

describe('invoice "แบ่งจ่าย" button', () => {
    it('an unpaid bill offers a split-payment postback next to the portal link', () => {
        const json = JSON.stringify(buildBillFlex(bill(), 'บ้านสุข', 5, '2026-10', { portalUrl: 'https://x/?uid=a' }));
        expect(json).toContain('"type":"postback"');
        expect(json).toContain(splitModePostbackData('bill', 'bill1'));
        expect(json).toContain('แบ่งจ่าย');
    });

    it('is shown without a portal link too, uses the room language, and not on a paid bill', () => {
        expect(JSON.stringify(buildBillFlex(bill(), 'บ้านสุข', 5, '2026-10', { lang: 'en' }))).toContain('Pay in parts');
        expect(JSON.stringify(buildBillFlex(bill({ payment_status: 'paid' }), 'บ้านสุข', 5, '2026-10'))).not.toContain('postback');
    });

    it('unpaid fines get it as well', () => {
        const fine = { id: 'f1', room_id: 'r1', room_number: '101', amount: 500, status: 'unpaid', date: '2026-10-01', reason: 'x', created_at: '2026-10-01' } as unknown as Fine;
        expect(JSON.stringify(buildFineFlex(fine, 'บ้านสุข'))).toContain(splitModePostbackData('fine', 'f1'));
    });

    it('postback data round-trips and rejects anything else', () => {
        expect(parseSplitModePostback(splitModePostbackData('fine', 'f1'))).toEqual({ kind: 'fine', itemId: 'f1' });
        expect(parseSplitModePostback('split|bill|b1|ref')).toBeNull();
        expect(parseSplitModePostback(undefined)).toBeNull();
    });
});

describe('invoice card', () => {
    const pay = { qrUrl: 'https://app.example.com/api/qr?p=x', bank: 'กสิกรไทย', accountName: 'สมชาย ใจดี', accountNumber: '662-8-87371-4' };
    const full = () => bill({
        prev_elec: 1200, curr_elec: 1210, prev_water: 50, curr_water: 52, common_fee: 150,
        applied_common_fees: [{ id: 'c1', name: 'ค่าขยะ', amount: 50 }, { id: 'c2', name: 'ค่าอินเทอร์เน็ต', amount: 100 }],
        total_bill: 3266,
    });

    it('is one bubble holding every charge, the meter readings, the QR and the account', () => {
        const flex = buildBillFlex(full(), 'บ้านสุข', 5, '2026-10', { pay }) as { contents: { type: string } };
        expect(flex.contents.type).toBe('bubble');
        const json = JSON.stringify(flex);
        for (const s of ['ค่าเช่าห้องพัก', 'ค่าไฟฟ้า', '1,200 → 1,210', 'ค่าน้ำประปา', '50 → 52', 'ค่าขยะ', 'ค่าอินเทอร์เน็ต', '฿3,266.00', 'กำหนดชำระ 5 ต.ค. 2569', pay.qrUrl, pay.accountNumber, 'รอชำระ']) {
            expect(json).toContain(s);
        }
        expect(json).not.toContain('📋');
    });

    it('shows a flat-rate water bill as its flat part and the excess', () => {
        const json = JSON.stringify(buildBillFlex(bill({ water_flat_amount: 250, water_excess_units: 3, water_excess_amount: 75, water_bill: 325 }), 'บ้านสุข', 5, '2026-10'));
        expect(json).toContain('ค่าน้ำประปา (เหมาจ่าย)');
        expect(json).toContain('ค่าน้ำส่วนเกิน');
        expect(json).toContain('฿75');
    });

    it('a paid bill says so and drops the QR, the slip note and the split button', () => {
        const json = JSON.stringify(buildBillFlex(bill({ payment_status: 'paid' }), 'บ้านสุข', 5, '2026-10', { pay }));
        expect(json).toContain('ชำระแล้ว');
        expect(json).not.toContain(pay.qrUrl);
        expect(json).not.toContain('สลิป');
    });
});

describe('fine card', () => {
    const pay = { qrUrl: 'https://app.example.com/api/qr?p=f', bank: 'กสิกรไทย', accountName: 'สมชาย ใจดี', accountNumber: '662-8-87371-4' };
    const fine = (over: Partial<Fine> = {}) => ({ id: 'f1', room_id: 'r1', room_number: '101', amount: 500, status: 'unpaid', date: '2026-10-03', reason: 'จอดรถผิดที่', note: 'ครั้งที่ 2', created_at: '2026-10-03', ...over }) as unknown as Fine;

    it('uses the invoice layout: reason + note as the item, date, QR and account in one bubble', () => {
        const flex = buildFineFlex(fine(), 'บ้านสุข', { pay }) as { contents: { type: string; size: string } };
        expect(flex.contents).toMatchObject({ type: 'bubble', size: 'mega' });
        const json = JSON.stringify(flex);
        for (const s of ['ใบแจ้งค่าปรับ', 'จอดรถผิดที่', 'หมายเหตุ: ครั้งที่ 2', '3 ต.ค. 2569', '฿500.00', pay.qrUrl, 'รอชำระ']) expect(json).toContain(s);
        expect(json).not.toContain('🚨');
    });

    it('speaks the room language and hides payment once paid', () => {
        expect(JSON.stringify(buildFineFlex(fine(), 'Home', { lang: 'en' }))).toContain('Fine notice');
        const paid = JSON.stringify(buildFineFlex(fine({ status: 'paid' }), 'บ้านสุข', { pay }));
        expect(paid).toContain('ชำระแล้ว');
        expect(paid).not.toContain(pay.qrUrl);
        expect(paid).not.toContain('postback');
    });
});
