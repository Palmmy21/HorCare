import { describe, expect, it } from 'vitest';
import {
  addGap, addGroup, autoPlan, contractState, firstFree, fits, groupNameOf, isFloorPlan, linkUnits, moveUnit, placeUnit,
  reconcile, removeGroup, resizeUnit, setCols, tenantGroups, unlinkUnit, UNPLACED_GROUP_NAME, type FloorPlan, type PlanRoom,
} from './floorPlan';

const room = (id: string, room_number: string, over: Partial<PlanRoom> = {}): PlanRoom => ({ id, room_number, is_active: true, ...over });
const dorm = [room('a', '101'), room('b', '102'), room('c', '201'), room('d', '202'), room('e', '203')];

describe('groupNameOf', () => {
  it('uses the floor / zone as entered, numbers read as a floor', () => {
    expect(groupNameOf(room('x', '5', { floor: '3' }), 'floors')).toBe('ชั้น 3');
    expect(groupNameOf(room('x', 'A1', { zone: 'โซนอาหาร' }), 'zones')).toBe('โซนอาหาร');
  });
  it('reads the floor from a plain room number, the zone from a stall code', () => {
    expect(groupNameOf(room('x', '1204'), 'floors')).toBe('ชั้น 12');
    expect(groupNameOf(room('x', 'b07'), 'zones')).toBe('โซน B');
    expect(groupNameOf(room('x', 'บ้าน 9'), 'streets')).toBe('ทั้งหมด');
  });
});

describe('autoPlan', () => {
  it('one group per floor, top floor first, units in number order', () => {
    const p = autoPlan(dorm, 'floors');
    expect(p.groups.map(g => g.name)).toEqual(['ชั้น 2', 'ชั้น 1']);
    expect(p.groups[0].cells.map(c => c.room_id)).toEqual(['c', 'd', 'e']);
    expect(p.groups[0].cells[2]).toMatchObject({ col: 2, row: 0, w: 1, h: 1 });
  });
  it('skips closed rooms', () => {
    const p = autoPlan([...dorm, room('z', '204', { is_active: false })], 'floors');
    expect(p.groups.flatMap(g => g.cells).some(c => c.room_id === 'z')).toBe(false);
  });
});

describe('reconcile', () => {
  it('drops deleted rooms and places new ones in their floor', () => {
    const p = autoPlan(dorm, 'floors');
    const next = reconcile(p, [...dorm.filter(r => r.id !== 'a'), room('n', '103')], 'floors');
    const floor1 = next.groups.find(g => g.name === 'ชั้น 1')!;
    expect(floor1.cells.map(c => c.room_id)).toEqual(['b', 'n']);
    expect(floor1.cells[1]).toMatchObject({ col: 0, row: 0 }); // the slot room a left free
  });
  it('puts a room with no matching group into the "not placed yet" group', () => {
    const next = reconcile(autoPlan(dorm, 'floors'), [...dorm, room('m', 'Penthouse')], 'floors');
    expect(next.groups.at(-1)!.name).toBe(UNPLACED_GROUP_NAME);
  });
  it('returns the same object when nothing changed', () => {
    const p = autoPlan(dorm, 'floors');
    expect(reconcile(p, dorm, 'floors')).toBe(p);
  });
});

describe('edits', () => {
  const base = () => autoPlan(dorm, 'floors');
  it('moves a unit to an empty slot, refuses an overlap of different sizes, swaps same-size units', () => {
    const p = base();
    const g2 = p.groups[0].id;
    const moved = moveUnit(p, 'c', g2, 3, 1)!;
    expect(moved.groups[0].cells.find(c => c.room_id === 'c')).toMatchObject({ col: 3, row: 1 });
    const swapped = moveUnit(p, 'c', g2, 1, 0)!;
    expect(swapped.groups[0].cells.find(c => c.room_id === 'c')).toMatchObject({ col: 1, row: 0 });
    expect(swapped.groups[0].cells.find(c => c.room_id === 'd')).toMatchObject({ col: 0, row: 0 });
    const wide = resizeUnit(moved, 'c', 1, 1)!;
    expect(moveUnit(resizeUnit(wide, 'e', 1, 2)!, 'c', g2, 2, 0)).toBeNull();
  });
  it('moves a unit across floors', () => {
    const p = base();
    const next = moveUnit(p, 'a', p.groups[0].id, 3, 0)!;
    expect(next.groups[0].cells.map(c => c.room_id)).toContain('a');
    expect(next.groups[1].cells.map(c => c.room_id)).not.toContain('a');
  });
  it('resizes only into free space', () => {
    const p = base();
    expect(resizeUnit(p, 'e', 2, 1)).not.toBeNull();       // col 2 → 3 is free
    expect(resizeUnit(p, 'c', 2, 1)).toBeNull();           // would cover d
    expect(resizeUnit(p, 'c', 5, 1)).toBeNull();           // beyond the max span
  });
  it('gaps take a slot and block units', () => {
    const p = addGap(base(), base().groups[0].id, 3, 0)!;
    expect(fits(p.groups[0], { col: 3, row: 0, w: 1, h: 1 })).toBe(false);
    expect(addGap(p, p.groups[0].id, 0, 0)).toBeNull();
  });
  it('places a new unit, keeps groups that hold units', () => {
    const p = addGroup(base(), 'ชั้น 3')!;
    const g3 = p.groups.at(-1)!;
    expect(placeUnit(p, 'new', g3.id, 0, 0)!.groups.at(-1)!.cells).toHaveLength(1);
    expect(removeGroup(p, p.groups[0].id)).toBeNull();
    expect(removeGroup(p, g3.id)!.groups).toHaveLength(2);
    expect(addGroup(p, 'ชั้น 3')).toBeNull();
  });
  it('narrows a group only when nothing sticks out', () => {
    const p = base();
    expect(setCols(p, p.groups[0].id, 4)).not.toBeNull();
    const wide = resizeUnit(p, 'e', 2, 1)!;                 // e now spans cols 2–3
    expect(setCols(wide, p.groups[0].id, 3)).toBeNull();
  });
  it('firstFree finds the hole before adding a row', () => {
    const g = { id: 'g', name: 'x', cols: 2, gaps: [], cells: [{ room_id: 'a', col: 0, row: 0, w: 1, h: 1 }, { room_id: 'b', col: 0, row: 1, w: 1, h: 1 }] };
    expect(firstFree(g)).toEqual({ col: 1, row: 0 });
    expect(firstFree(g, 2)).toEqual({ col: 0, row: 2 });
  });
});

describe('tenant groups', () => {
  it('joins units by contract tenant name and by hand-made links', () => {
    const p: FloorPlan = linkUnits(autoPlan(dorm, 'floors'), ['a', 'b'])!;
    const groups = tenantGroups(p, { c: 'บริษัท เอ จำกัด', d: 'บริษัท  เอ จำกัด ', e: 'คนอื่น' });
    expect(groups.a.sort()).toEqual(['a', 'b']);
    expect(groups.c.sort()).toEqual(['c', 'd']);
    expect(groups.e).toBeUndefined();
  });
  it('linking into an existing link merges, unlinking a pair removes it', () => {
    let p = linkUnits(autoPlan(dorm, 'floors'), ['a', 'b'])!;
    p = linkUnits(p, ['b', 'c'])!;
    expect(p.links).toHaveLength(1);
    expect(p.links[0].room_ids.sort()).toEqual(['a', 'b', 'c']);
    expect(unlinkUnit(unlinkUnit(p, 'a'), 'b').links).toHaveLength(0);
  });
});

describe('contractState / isFloorPlan', () => {
  it('flags contracts ending within 90 days and past ones', () => {
    expect(contractState('2026-12-01', '2026-10-26')).toBe('ending');
    expect(contractState('2027-06-01', '2026-10-26')).toBe('ok');
    expect(contractState('2026-10-25', '2026-10-26')).toBe('ended');
    expect(contractState(undefined, '2026-10-26')).toBe('none');
  });
  it('accepts only a well-formed stored plan', () => {
    expect(isFloorPlan(autoPlan(dorm, 'floors'))).toBe(true);
    expect(isFloorPlan({ version: 2, groups: [], links: [] })).toBe(false);
    expect(isFloorPlan(null)).toBe(false);
  });
});
