import { describe, expect, it } from 'vitest';
import {
    DEFAULT_METER_SETTINGS, canBulkConfirm, canConfirm, computeFlags, groupConfirmed, matchRoom, parseReading,
    type BatchItem, type RoomMeterContext,
} from './meterBatch';

const rooms = [
    { id: 'r101', room_number: '101' },
    { id: 'r102', room_number: '102' },
    { id: 'rA1', room_number: 'A-1' },
    { id: 'r999', room_number: '999', is_active: false },
];

function item(over: Partial<BatchItem> = {}): BatchItem {
    return {
        id: 'i1', fileName: 'a.jpg', status: 'review_required', ocrRoom: '101', roomId: 'r101',
        meterType: 'electric', reading: '1285', confidence: 0.95, ...over,
    };
}

const ctxOf = (map: Record<string, RoomMeterContext>) => (roomId: string, type: 'electric' | 'water') => map[`${roomId}|${type}`];
const normalCtx = ctxOf({ 'r101|electric': { previous: 1245, lastUnits: 40, locked: false } });

const flagsFor = (items: BatchItem[], ctx = normalCtx) => computeFlags(items, rooms, ctx);

describe('matchRoom', () => {
    it('matches exactly one room, ignoring case and spaces', () => {
        expect(matchRoom(rooms, ' 101 ')).toEqual({ kind: 'matched', roomId: 'r101' });
        expect(matchRoom(rooms, 'a-1')).toEqual({ kind: 'matched', roomId: 'rA1' });
    });
    it('reports not found for unknown, empty, null and inactive rooms', () => {
        expect(matchRoom(rooms, '777').kind).toBe('not_found');
        expect(matchRoom(rooms, '').kind).toBe('not_found');
        expect(matchRoom(rooms, null).kind).toBe('not_found');
        expect(matchRoom(rooms, '999').kind).toBe('not_found');
    });
    it('never guesses when several rooms share the number', () => {
        const dup = [...rooms, { id: 'x', room_number: '101' }];
        expect(matchRoom(dup, '101')).toEqual({ kind: 'ambiguous', roomIds: ['r101', 'x'] });
    });
    it('does not fuzzy-match partial numbers', () => {
        expect(matchRoom(rooms, '10').kind).toBe('not_found');
    });
});

describe('parseReading', () => {
    it('accepts digits only', () => {
        expect(parseReading('1285')).toBe(1285);
        expect(parseReading(' 007 ')).toBe(7);
        for (const bad of ['', 'abc', '12.5', '-3', '1e3', '12 85']) expect(parseReading(bad)).toBeNull();
    });
});

describe('computeFlags — blocking', () => {
    it('a clean reading has no flags', () => {
        expect(flagsFor([item()]).i1).toEqual([]);
    });
    it('room not found / no room id', () => {
        expect(flagsFor([item({ roomId: null, ocrRoom: '777' })]).i1).toContain('room_not_found');
        expect(flagsFor([item({ roomId: null, ocrRoom: null })]).i1).toContain('room_not_found');
    });
    it('ambiguous OCR room is reported as such', () => {
        const dup = [...rooms, { id: 'x', room_number: '101' }];
        const f = computeFlags([item({ roomId: null })], dup, normalCtx);
        expect(f.i1).toContain('room_ambiguous');
    });
    it('duplicate room + type in the same batch flags BOTH photos', () => {
        const f = flagsFor([item({ id: 'a' }), item({ id: 'b' })]);
        expect(f.a).toContain('duplicate_in_batch');
        expect(f.b).toContain('duplicate_in_batch');
    });
    it('same room, different meter types is fine', () => {
        const f = flagsFor([item({ id: 'a' }), item({ id: 'b', meterType: 'water', reading: '50' })]);
        expect(f.a).not.toContain('duplicate_in_batch');
        expect(f.b).not.toContain('duplicate_in_batch');
    });
    it('unknown meter type and unreadable value', () => {
        expect(flagsFor([item({ meterType: 'unknown' })]).i1).toContain('unknown_type');
        expect(flagsFor([item({ reading: '' })]).i1).toContain('no_reading');
        expect(flagsFor([item({ reading: '12x' })]).i1).toContain('no_reading');
    });
    it('locked month blocks', () => {
        const locked = ctxOf({ 'r101|electric': { previous: 1245, lastUnits: 40, locked: true } });
        expect(flagsFor([item()], locked).i1).toContain('month_locked');
    });
    it('ignores items that are still processing or failed', () => {
        const f = flagsFor([item({ id: 'p', status: 'processing' }), item({ id: 'e', status: 'error' })]);
        expect(f.p).toEqual([]);
        expect(f.e).toEqual([]);
    });
});

describe('computeFlags — warnings', () => {
    it('low confidence uses the threshold (boundary is not flagged)', () => {
        expect(flagsFor([item({ confidence: 0.79 })]).i1).toContain('low_confidence');
        expect(flagsFor([item({ confidence: DEFAULT_METER_SETTINGS.minConfidence })]).i1).not.toContain('low_confidence');
    });
    it('reading below previous month', () => {
        expect(flagsFor([item({ reading: '1200' })]).i1).toContain('below_previous');
        expect(flagsFor([item({ reading: '1245' })]).i1).not.toContain('below_previous'); // zero usage is fine
    });
    it('abnormal jump relative to last month, with a noise floor', () => {
        // last 40 units, ratio 3 → 120, floor 150 → limit 150
        expect(flagsFor([item({ reading: String(1245 + 150) })]).i1).not.toContain('abnormal_jump');
        expect(flagsFor([item({ reading: String(1245 + 151) })]).i1).toContain('abnormal_jump');
    });
    it('uses the fallback ceiling when the room has no history', () => {
        const noHistory = ctxOf({ 'r101|electric': { previous: 0, locked: false } });
        expect(flagsFor([item({ reading: '1500' })], noHistory).i1).not.toContain('abnormal_jump');
        expect(flagsFor([item({ reading: '1501' })], noHistory).i1).toContain('abnormal_jump');
    });
    it('below-previous does not also report a jump', () => {
        const f = flagsFor([item({ reading: '10' })]).i1;
        expect(f).toContain('below_previous');
        expect(f).not.toContain('abnormal_jump');
    });
});

describe('confirmation policy', () => {
    it('blocking flags can never be confirmed', () => {
        for (const f of ['no_reading', 'unknown_type', 'room_not_found', 'room_ambiguous', 'duplicate_in_batch', 'month_locked'] as const) {
            expect(canConfirm([f])).toBe(false);
            expect(canConfirm(['low_confidence', f])).toBe(false);
        }
    });
    it('warnings can be confirmed individually but never in bulk', () => {
        for (const f of ['low_confidence', 'below_previous', 'abnormal_jump'] as const) {
            expect(canConfirm([f])).toBe(true);
            expect(canBulkConfirm([f])).toBe(false);
        }
    });
    it('clean items can be bulk confirmed', () => {
        expect(canBulkConfirm([])).toBe(true);
    });
});

describe('groupConfirmed', () => {
    it('only confirmed items are saved, one entry per room', () => {
        const out = groupConfirmed([
            item({ id: 'a', status: 'confirmed' }),
            item({ id: 'b', status: 'confirmed', meterType: 'water', reading: '55' }),
            item({ id: 'c', status: 'review_required', roomId: 'r102', ocrRoom: '102' }),
            item({ id: 'd', status: 'saved', roomId: 'r102', ocrRoom: '102' }),
        ]);
        expect(out).toEqual([{ roomId: 'r101', electric: 1285, water: 55 }]);
    });
    it('skips confirmed items that cannot be saved safely', () => {
        expect(groupConfirmed([item({ status: 'confirmed', roomId: null })])).toEqual([]);
        expect(groupConfirmed([item({ status: 'confirmed', meterType: 'unknown' })])).toEqual([]);
        expect(groupConfirmed([item({ status: 'confirmed', reading: 'abc' })])).toEqual([]);
    });
});
