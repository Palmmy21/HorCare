import { describe, expect, it } from 'vitest';
import { MAX_BULK_ROOMS, buildRoomNumbers, findDuplicates, normalizeRoomNumber, validatePattern } from './bulkRooms';

describe('buildRoomNumbers', () => {
    it('101–120 creates 20 rooms', () => {
        const nums = buildRoomNumbers({ start: 101, end: 120 });
        expect(nums).toHaveLength(20);
        expect(nums[0]).toBe('101');
        expect(nums[19]).toBe('120');
    });

    it('supports prefix, suffix and zero padding', () => {
        expect(buildRoomNumbers({ start: 1, end: 3, prefix: 'A-', padWidth: 3 })).toEqual(['A-001', 'A-002', 'A-003']);
        expect(buildRoomNumbers({ start: 7, end: 8, suffix: 'F' })).toEqual(['7F', '8F']);
    });

    it('a single-room range works', () => {
        expect(buildRoomNumbers({ start: 5, end: 5 })).toEqual(['5']);
    });
});

describe('validatePattern', () => {
    it('accepts a normal range', () => expect(validatePattern({ start: 101, end: 120 })).toBeNull());
    it('rejects reversed ranges', () => expect(validatePattern({ start: 20, end: 10 })).toBe('end_before_start'));
    it('rejects non-integers and NaN', () => {
        expect(validatePattern({ start: 1.5, end: 3 })).toBe('not_integer');
        expect(validatePattern({ start: NaN, end: 3 })).toBe('not_integer');
    });
    it('rejects negatives', () => expect(validatePattern({ start: -1, end: 3 })).toBe('negative'));
    it('caps the batch size', () => {
        expect(validatePattern({ start: 1, end: MAX_BULK_ROOMS })).toBeNull();
        expect(validatePattern({ start: 1, end: MAX_BULK_ROOMS + 1 })).toBe('too_many');
    });
});

describe('findDuplicates (no duplicate room number within a property)', () => {
    it('flags numbers that already exist', () => {
        expect(findDuplicates(['101', '102', '103'], ['102'])).toEqual(['102']);
    });
    it('ignores case and surrounding whitespace', () => {
        expect(findDuplicates(['a101'], ['A101 '])).toEqual(['a101']);
        expect(normalizeRoomNumber(' A101 ')).toBe('a101');
    });
    it('flags repeats inside the request itself', () => {
        expect(findDuplicates(['1', '2', '1'], [])).toEqual(['1']);
    });
    it('returns nothing when all numbers are new', () => {
        expect(findDuplicates(['201', '202'], ['101'])).toEqual([]);
    });
});
