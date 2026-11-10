import { describe, expect, it } from 'vitest';
import {
    MAX_ROOMS_PER_LINE, addRoom, linkWithRooms, registrationChoice, removeRoom, roomNumbersText, roomsOfLink, type LinkedRoom,
} from './lineRooms';

const r = (id: string, number = id): LinkedRoom => ({ uid: 'o1', building_id: 'b1', room_id: id, room_number: number });

describe('roomsOfLink', () => {
    it('reads a document written before several rooms existed as exactly one room', () => {
        const old = { uid: 'o1', building_id: 'b1', room_id: 'r1', room_number: '101', dorm_name: 'A', due_day: 5, registered_at: 'x', slip_expected_until: 9 };
        expect(roomsOfLink(old)).toEqual([{ uid: 'o1', building_id: 'b1', room_id: 'r1', room_number: '101', dorm_name: 'A', due_day: 5 }]);
    });
    it('reads none from a missing or malformed document', () => {
        expect(roomsOfLink(null)).toEqual([]);
        expect(roomsOfLink(undefined)).toEqual([]);
        expect(roomsOfLink({ room_number: '101' })).toEqual([]);
    });
    it('lists every room once, primary first, ignoring junk entries', () => {
        const link = { ...r('r1', '101'), rooms: [r('r2', '102'), r('r1', '101'), null, { uid: 'o1' }, r('r3', '103')] };
        expect(roomsOfLink(link as never).map(x => x.room_number)).toEqual(['101', '102', '103']);
    });
});

describe('linkWithRooms', () => {
    it('keeps the single-room shape for one room: no `rooms` field', () => {
        const out = linkWithRooms({ ...r('r1'), rooms: [r('r1'), r('r2')], slip_expected_until: 9 }, [r('r2', '102')])!;
        expect(out).toEqual({ uid: 'o1', building_id: 'b1', room_id: 'r2', room_number: '102', slip_expected_until: 9 });
    });
    it('puts the first room at the top level and lists them all', () => {
        const out = linkWithRooms(null, [r('r1', '101'), r('r2', '102')])!;
        expect(out).toMatchObject({ room_id: 'r1', room_number: '101' });
        expect((out.rooms as LinkedRoom[]).map(x => x.room_id)).toEqual(['r1', 'r2']);
    });
    it('does not carry a room field of the old primary over to the new one', () => {
        const out = linkWithRooms({ ...r('r1'), dorm_name: 'Old dorm', due_day: 9 }, [r('r2')])!;
        expect(out.dorm_name).toBeUndefined();
        expect(out.due_day).toBeUndefined();
    });
    it('is null for no rooms: the document goes', () => {
        expect(linkWithRooms({ ...r('r1') }, [])).toBeNull();
    });
});

describe('adding and removing', () => {
    it('adds once, and refreshes details in place', () => {
        expect(addRoom([r('r1')], r('r2')).map(x => x.room_id)).toEqual(['r1', 'r2']);
        expect(addRoom([r('r1', '101')], r('r1', '101A'))).toEqual([r('r1', '101A')]);
    });
    it('tells rooms with the same id at different properties apart', () => {
        const other = { ...r('r1'), building_id: 'b2' };
        expect(addRoom([r('r1')], other)).toHaveLength(2);
        expect(removeRoom([r('r1'), other], other)).toEqual([r('r1')]);
    });
});

describe('registrationChoice', () => {
    it('binds without a question for a first room or a room already held', () => {
        expect(registrationChoice([], r('r1'))).toBe('bind');
        expect(registrationChoice([r('r1'), r('r2')], r('r2'))).toBe('bind');
    });
    it('asks when there is exactly one other room: they may be moving', () => {
        expect(registrationChoice([r('r1')], r('r2'))).toBe('ask');
    });
    it('can only add once there are several, up to the limit', () => {
        expect(registrationChoice([r('r1'), r('r2')], r('r3'))).toBe('add');
        const many = Array.from({ length: MAX_ROOMS_PER_LINE }, (_, i) => r(`r${i}`));
        expect(registrationChoice(many, r('new'))).toBe('full');
        expect(registrationChoice(many, r('r3'))).toBe('bind');
    });
});

describe('roomNumbersText', () => {
    it('names rooms the way a sentence does', () => {
        expect(roomNumbersText([])).toBe('');
        expect(roomNumbersText([r('a', '101')])).toBe('101');
        expect(roomNumbersText([r('a', '101'), r('b', '102')])).toBe('101 และ 102');
        expect(roomNumbersText([r('a', '101'), r('b', '102'), r('c', '103')])).toBe('101, 102 และ 103');
    });
});
