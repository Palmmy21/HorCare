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
