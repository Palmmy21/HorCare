import { describe, expect, it } from 'vitest';
import { categoriesInUse, categoryTotals, categoryOf, defaultCategoryFor, parseUnitCategory, unitHasMeters } from './unitCategory';

describe('unit category', () => {
    it('falls back to the branch kind, so existing branches are unchanged', () => {
        expect(categoryOf({}, 'dormitory')).toBe('room');
        expect(categoryOf({}, 'condo')).toBe('condo');
        expect(categoryOf({ unit_category: 'land' }, 'dormitory')).toBe('land');
        expect(defaultCategoryFor(undefined)).toBe('room');
    });

    it('keeps land off the meters unless the owner says otherwise', () => {
        expect(unitHasMeters({ unit_category: 'land' })).toBe(false);
        expect(unitHasMeters({ unit_category: 'land', has_meters: true })).toBe(true);
        expect(unitHasMeters({ unit_category: 'house', has_meters: false })).toBe(false);
        expect(unitHasMeters({}, 'house')).toBe(true);
    });

    it('lists the kinds in use in a stable order', () => {
        expect(categoriesInUse([{ unit_category: 'land' }, {}, { unit_category: 'condo' }, {}], 'house')).toEqual(['condo', 'house', 'land']);
    });

    it('reads what owners type in a sheet', () => {
        expect(parseUnitCategory('บ้านเช่า')).toBe('house');
        expect(parseUnitCategory('ที่ดินให้เช่า')).toBe('land');
        expect(parseUnitCategory('คอนโดมิเนียม')).toBe('condo');
        expect(parseUnitCategory('ทาวน์โฮม 2 ชั้น')).toBe('townhouse');
        expect(parseUnitCategory('ห้องพัก')).toBe('room');
        expect(parseUnitCategory('Condo')).toBe('condo');
        expect(parseUnitCategory('')).toBeNull();
        expect(parseUnitCategory('ยานอวกาศ')).toBeUndefined();
    });

    it('sums units, bills and collections per kind', () => {
        const rooms = [{ id: 'a' }, { id: 'b', unit_category: 'land' as const }, { id: 'c', unit_category: 'land' as const }, { id: 'd', is_active: false }];
        const bills = [
            { room_id: 'a', month: '2026-11', total_bill: 4000, payment_status: 'paid' },
            { room_id: 'b', month: '2026-11', total_bill: 8000 },
            { room_id: 'b', month: '2026-10', total_bill: 8000, payment_status: 'paid' },
            { room_id: 'd', month: '2026-11', total_bill: 999 },
        ];
        expect(categoryTotals(rooms, bills, '2026-11', 'house')).toEqual([
            { category: 'house', units: 1, billed: 1, amount: 4000, paid: 4000 },
            { category: 'land', units: 2, billed: 1, amount: 8000, paid: 0 },
        ]);
    });
});
