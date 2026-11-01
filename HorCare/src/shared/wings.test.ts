import { describe, expect, it } from 'vitest';
import { billsInWing, hasWings, monthStatsOf, roomsInWing, validWing, wingLabel, wingsOf } from './wings';

const rooms = [
  { id: 'a1', building_name: 'A', is_active: true },
  { id: 'a2', building_name: ' A ', is_active: true },
  { id: 'b1', building_name: 'B', is_active: true },
  { id: 'b2', building_name: 'B', is_active: false },
  { id: 'x', is_active: true },
];
const bills = [
  { room_id: 'a1', month: '2026-10', total_bill: 4000, is_saved: true },
  { room_id: 'b1', month: '2026-10', total_bill: 3000, is_saved: true },
  { room_id: 'a1', month: '2026-09', total_bill: 3900, is_saved: true },
];

describe('buildings within a property', () => {
  it('lists the named buildings in natural order', () => {
    expect(wingsOf(rooms)).toEqual(['A', 'B']);
    expect(wingsOf([{ id: '1', building_name: 'ตึก 10' }, { id: '2', building_name: 'ตึก 2' }])).toEqual(['ตึก 2', 'ตึก 10']);
    expect(hasWings(rooms)).toBe(true);
    expect(hasWings([{ id: '1', building_name: 'A' }, { id: '2' }])).toBe(false); // one building: nothing to choose
  });

  it('labels buildings the way people say them', () => {
    expect(wingLabel('A')).toBe('ตึก A');
    expect(wingLabel('อาคาร 2')).toBe('อาคาร 2');
    expect(wingLabel('Tower B')).toBe('Tower B');
  });

  it("scopes rooms, bills and the month's figures to one building", () => {
    const a = roomsInWing(rooms, 'A');
    expect(a.map(r => r.id)).toEqual(['a1', 'a2']);
    expect(roomsInWing(rooms, null)).toHaveLength(5);
    expect(billsInWing(bills, a).map(b => b.total_bill)).toEqual([4000, 3900]);
    expect(monthStatsOf(a, billsInWing(bills, a), '2026-10')).toEqual({ savedCount: 1, totalRooms: 2, totalRevenue: 4000, isAllSaved: false, progress: 50 });
  });

  it('forgets a choice that no longer exists', () => {
    expect(validWing('A', rooms)).toBe('A');
    expect(validWing('C', rooms)).toBeNull();
    expect(validWing('A', [{ id: '1', building_name: 'A' }])).toBeNull();
    expect(validWing(null, rooms)).toBeNull();
  });
});
