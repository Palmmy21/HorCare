// The property plan (ผังหอ / ผังตลาด / ผังโครงการ): units laid out on a grid per floor, zone or street.
// Pure, so the layout rules can be tested and shared. The plan is generated from the rooms' floor / zone the first time
// and only stored once the owner edits it; every read reconciles it with the current rooms, so a room added or
// removed elsewhere never leaves the plan stale.
import type { DormConfig } from '../types';

export type PlanKind = 'floors' | 'zones' | 'streets';

export interface PlanCell { room_id: string; col: number; row: number; w: number; h: number }
/** A deliberate empty space (walkway, stairs, a gap between houses). */
export interface PlanGap { id: string; col: number; row: number; w: number; h: number }
export interface PlanGroup { id: string; name: string; cols: number; cells: PlanCell[]; gaps: PlanGap[] }
/** Units the owner tied to one tenant by hand (on top of the ones contracts already tie). */
export interface PlanLink { id: string; room_ids: string[] }

export interface FloorPlan {
  version: 1;
  groups: PlanGroup[];
  links: PlanLink[];
  updated_at?: string;
  updated_by?: string;
}

export interface PlanRoom {
  id: string;
  room_number: string;
  is_active: boolean;
  floor?: string;
  zone?: string;
  building_name?: string;
}

export const MIN_COLS = 4;
export const MAX_COLS = 16;
export const MAX_SPAN = 4;
export const UNPLACED_GROUP_NAME = 'ยังไม่ได้จัดวาง';

export function planKindOf(type: DormConfig['building_type'] | undefined): PlanKind {
  if (type === 'market') return 'zones';
  if (type === 'house') return 'streets';
  return 'floors';
}

export const PLAN_LABELS: Record<PlanKind, { title: string; group: string; unit: string }> = {
  floors: { title: 'ผังอาคาร', group: 'ชั้น', unit: 'ห้อง' },
  zones: { title: 'ผังตลาด', group: 'โซน', unit: 'แผง' },
  streets: { title: 'ผังโครงการ', group: 'ซอย', unit: 'บ้าน' },
};

const byNumber = (a: string, b: string) => a.localeCompare(b, 'th', { numeric: true });
const clean = (s?: string) => (typeof s === 'string' ? s.trim() : '');

/** The group a room belongs to when nobody placed it: its zone / floor as entered, else read from the room number. */
export function groupNameOf(room: PlanRoom, kind: PlanKind): string {
  const named = kind === 'floors' ? clean(room.floor) || clean(room.zone) : clean(room.zone) || clean(room.floor);
  if (named) return kind === 'floors' && /^\d+$/.test(named) ? `ชั้น ${named}` : named;
  if (kind === 'floors') {
    // 101–199 → ชั้น 1, 1201 → ชั้น 12 (only plain 3–4 digit room numbers)
    const m = /^(\d{1,2})\d{2}$/.exec(room.room_number.trim());
    if (m) return `ชั้น ${Number(m[1])}`;
  }
  if (kind === 'zones') {
    const m = /^([A-Za-zก-ฮ]+)/.exec(room.room_number.trim());
    if (m) return `โซน ${m[1].toUpperCase()}`;
  }
  return clean(room.building_name) || 'ทั้งหมด';
}

/** Floors read top to bottom like the building; zones and streets in name order. */
function sortGroups(names: string[], kind: PlanKind): string[] {
  const sorted = [...names].sort(byNumber);
  return kind === 'floors' ? sorted.reverse() : sorted;
}

let seq = 0;
export const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(seq++).toString(36)}`;

/** A first plan from the rooms alone: one group per floor / zone, units in number order, as many columns as fit. */
export function autoPlan(rooms: PlanRoom[], kind: PlanKind): FloorPlan {
  const active = rooms.filter(r => r.is_active);
  const groups = new Map<string, PlanRoom[]>();
  for (const r of active) {
    const g = groupNameOf(r, kind);
    groups.set(g, [...(groups.get(g) ?? []), r]);
  }
  const largest = Math.max(0, ...[...groups.values()].map(g => g.length));
  const cols = Math.min(10, Math.max(MIN_COLS, largest));
  return {
    version: 1,
    links: [],
    groups: sortGroups([...groups.keys()], kind).map((name, gi) => {
      const list = groups.get(name)!.sort((a, b) => byNumber(a.room_number, b.room_number));
      return {
        id: `g${gi}`, name, cols, gaps: [],
        cells: list.map((r, i) => ({ room_id: r.id, col: i % cols, row: Math.floor(i / cols), w: 1, h: 1 })),
      };
    }),
  };
}

type Box = { col: number; row: number; w: number; h: number };
const overlaps = (a: Box, b: Box) => a.col < b.col + b.w && b.col < a.col + a.w && a.row < b.row + b.h && b.row < a.row + a.h;
const boxesOf = (g: PlanGroup, skip?: { room?: string; gap?: string }) =>
  [...g.cells.filter(c => c.room_id !== skip?.room), ...g.gaps.filter(x => x.id !== skip?.gap)] as Box[];

/** Whether a box fits inside the group's columns without covering anything else. */
export function fits(g: PlanGroup, box: Box, skip?: { room?: string; gap?: string }): boolean {
  if (box.col < 0 || box.row < 0 || box.w < 1 || box.h < 1 || box.col + box.w > g.cols) return false;
  return !boxesOf(g, skip).some(b => overlaps(b, box));
}

/** Rows the group needs to show everything it holds. */
export function rowsOf(g: PlanGroup): number {
  return Math.max(0, ...g.cells.map(c => c.row + c.h), ...g.gaps.map(x => x.row + x.h));
}

/** First free slot of the given size, scanning row by row (a new row at the bottom when the group is full). */
export function firstFree(g: PlanGroup, w = 1, h = 1): { col: number; row: number } {
  const width = Math.min(w, g.cols);
  for (let row = 0; row <= rowsOf(g); row++) {
    for (let col = 0; col + width <= g.cols; col++) {
      if (fits(g, { col, row, w: width, h })) return { col, row };
    }
  }
  return { col: 0, row: rowsOf(g) };
}

/**
 * The stored plan brought up to date with the rooms: cells of deleted / closed rooms drop out, links lose them, and
 * rooms the plan has not seen go to the group of their floor / zone (or a "not placed yet" group) at the first free
 * slot. Returns the plan unchanged (same object) when nothing needed fixing.
 */
export function reconcile(plan: FloorPlan, rooms: PlanRoom[], kind: PlanKind): FloorPlan {
  const live = new Map(rooms.filter(r => r.is_active).map(r => [r.id, r]));
  let changed = false;
  const groups = plan.groups.map(g => {
    const cells = g.cells.filter(c => live.has(c.room_id));
    if (cells.length !== g.cells.length) changed = true;
    return { ...g, cells, gaps: [...g.gaps] };
  });
  const placed = new Set(groups.flatMap(g => g.cells.map(c => c.room_id)));
  const missing = [...live.values()].filter(r => !placed.has(r.id)).sort((a, b) => byNumber(a.room_number, b.room_number));
  for (const r of missing) {
    changed = true;
    const name = groupNameOf(r, kind);
    let g = groups.find(x => x.name === name) ?? groups.find(x => x.name === UNPLACED_GROUP_NAME);
    if (!g) {
      g = { id: newId('g'), name: UNPLACED_GROUP_NAME, cols: Math.max(MIN_COLS, groups[0]?.cols ?? 8), cells: [], gaps: [] };
      groups.push(g);
    }
    const at = firstFree(g);
    g.cells.push({ room_id: r.id, ...at, w: 1, h: 1 });
  }
  const links = plan.links
    .map(l => ({ ...l, room_ids: l.room_ids.filter(id => live.has(id)) }))
    .filter(l => l.room_ids.length > 1);
  if (links.length !== plan.links.length || links.some((l, i) => l.room_ids.length !== plan.links[i]?.room_ids.length)) changed = true;
  return changed ? { ...plan, groups, links } : plan;
}

// ── Edits. Each returns a new plan, or null when the move is not possible (the caller keeps the old plan). ──

const withGroups = (plan: FloorPlan, groups: PlanGroup[]): FloorPlan => ({ ...plan, groups });
const findCell = (plan: FloorPlan, roomId: string) => {
  for (const g of plan.groups) {
    const c = g.cells.find(x => x.room_id === roomId);
    if (c) return { g, c };
  }
  return null;
};

/**
 * Move a unit to a slot. Dropping it on another unit of the same size swaps the two; dropping it where it does not
 * fit is refused.
 */
export function moveUnit(plan: FloorPlan, roomId: string, toGroupId: string, col: number, row: number): FloorPlan | null {
  const from = findCell(plan, roomId);
  const target = plan.groups.find(g => g.id === toGroupId);
  if (!from || !target) return null;
  const box = { col, row, w: Math.min(from.c.w, target.cols), h: from.c.h };
  if (fits(target, box, { room: roomId })) {
    return withGroups(plan, plan.groups.map(g => {
      let cells = g.cells.filter(c => c.room_id !== roomId);
      if (g.id === target.id) cells = [...cells, { room_id: roomId, ...box }];
      return { ...g, cells };
    }));
  }
  // swap with a unit of the same size sitting exactly there
  const other = target.cells.find(c => c.room_id !== roomId && c.col === col && c.row === row);
  if (!other || other.w !== from.c.w || other.h !== from.c.h) return null;
  return withGroups(plan, plan.groups.map(g => ({
    ...g,
    cells: g.cells.map(c => {
      if (c.room_id === roomId) return { ...c, room_id: other.room_id };
      if (c.room_id === other.room_id) return { ...c, room_id: roomId };
      return c;
    }),
  })));
}

export function resizeUnit(plan: FloorPlan, roomId: string, w: number, h: number): FloorPlan | null {
  const at = findCell(plan, roomId);
  if (!at || w < 1 || h < 1 || w > MAX_SPAN || h > MAX_SPAN) return null;
  const box = { col: at.c.col, row: at.c.row, w, h };
  if (!fits(at.g, box, { room: roomId })) return null;
  return withGroups(plan, plan.groups.map(g => g.id !== at.g.id ? g : { ...g, cells: g.cells.map(c => c.room_id === roomId ? { ...c, w, h } : c) }));
}

/** Place a unit that is not on the plan yet (a room just created from the plan) at a slot. */
export function placeUnit(plan: FloorPlan, roomId: string, groupId: string, col: number, row: number): FloorPlan | null {
  const g = plan.groups.find(x => x.id === groupId);
  if (!g || findCell(plan, roomId) || !fits(g, { col, row, w: 1, h: 1 })) return null;
  return withGroups(plan, plan.groups.map(x => x.id === groupId ? { ...x, cells: [...x.cells, { room_id: roomId, col, row, w: 1, h: 1 }] } : x));
}

export function addGap(plan: FloorPlan, groupId: string, col: number, row: number): FloorPlan | null {
  const g = plan.groups.find(x => x.id === groupId);
  if (!g || !fits(g, { col, row, w: 1, h: 1 })) return null;
  return withGroups(plan, plan.groups.map(x => x.id === groupId ? { ...x, gaps: [...x.gaps, { id: newId('gap'), col, row, w: 1, h: 1 }] } : x));
}

export function removeGap(plan: FloorPlan, gapId: string): FloorPlan {
  return withGroups(plan, plan.groups.map(g => ({ ...g, gaps: g.gaps.filter(x => x.id !== gapId) })));
}

export function addGroup(plan: FloorPlan, name: string): FloorPlan | null {
  const n = name.trim();
  if (!n || plan.groups.some(g => g.name === n)) return null;
  return withGroups(plan, [...plan.groups, { id: newId('g'), name: n, cols: plan.groups[0]?.cols ?? 8, cells: [], gaps: [] }]);
}

export function renameGroup(plan: FloorPlan, groupId: string, name: string): FloorPlan | null {
  const n = name.trim();
  if (!n || plan.groups.some(g => g.name === n && g.id !== groupId)) return null;
  return withGroups(plan, plan.groups.map(g => g.id === groupId ? { ...g, name: n } : g));
}

/** Only an empty group can go (units are never dropped off the plan by accident). */
export function removeGroup(plan: FloorPlan, groupId: string): FloorPlan | null {
  const g = plan.groups.find(x => x.id === groupId);
  if (!g || g.cells.length > 0) return null;
  return withGroups(plan, plan.groups.filter(x => x.id !== groupId));
}

export function moveGroup(plan: FloorPlan, groupId: string, by: -1 | 1): FloorPlan {
  const i = plan.groups.findIndex(g => g.id === groupId);
  const j = i + by;
  if (i < 0 || j < 0 || j >= plan.groups.length) return plan;
  const groups = [...plan.groups];
  [groups[i], groups[j]] = [groups[j], groups[i]];
  return withGroups(plan, groups);
}

/** Change a group's width; refused while something would fall outside it. */
export function setCols(plan: FloorPlan, groupId: string, cols: number): FloorPlan | null {
  const g = plan.groups.find(x => x.id === groupId);
  if (!g || cols < MIN_COLS || cols > MAX_COLS) return null;
  if ([...g.cells, ...g.gaps].some(b => b.col + b.w > cols)) return null;
  return withGroups(plan, plan.groups.map(x => x.id === groupId ? { ...x, cols } : x));
}

/** Tie units to one tenant by hand; units already tied elsewhere move into the new tie. */
export function linkUnits(plan: FloorPlan, roomIds: string[]): FloorPlan | null {
  const ids = [...new Set(roomIds)];
  if (ids.length < 2) return null;
  const merged = new Set(ids);
  const rest = plan.links.filter(l => {
    if (!l.room_ids.some(id => merged.has(id))) return true;
    l.room_ids.forEach(id => merged.add(id));
    return false;
  });
  return { ...plan, links: [...rest, { id: newId('link'), room_ids: [...merged] }] };
}

export function unlinkUnit(plan: FloorPlan, roomId: string): FloorPlan {
  return {
    ...plan,
    links: plan.links
      .map(l => ({ ...l, room_ids: l.room_ids.filter(id => id !== roomId) }))
      .filter(l => l.room_ids.length > 1),
  };
}

// ── Reading the plan ──

const normName = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Units that belong to one tenant: tied by hand on the plan, or occupied under the same tenant name in their
 * contracts. Returns, per room id, the ids of all the units in its group (itself included); single units are absent.
 */
export function tenantGroups(plan: FloorPlan, tenantByRoom: Record<string, string | undefined>): Record<string, string[]> {
  const parent = new Map<string, string>();
  const find = (x: string): string => { const p = parent.get(x) ?? x; if (p === x) return x; const r = find(p); parent.set(x, r); return r; };
  const join = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const l of plan.links) l.room_ids.slice(1).forEach(id => join(l.room_ids[0], id));
  const byName = new Map<string, string>();
  for (const [roomId, name] of Object.entries(tenantByRoom)) {
    if (!name || !name.trim()) continue;
    const key = normName(name);
    const first = byName.get(key);
    if (first) join(first, roomId); else byName.set(key, roomId);
  }
  const sets = new Map<string, string[]>();
  for (const id of new Set([...plan.links.flatMap(l => l.room_ids), ...Object.keys(tenantByRoom)])) {
    const r = find(id);
    sets.set(r, [...(sets.get(r) ?? []), id]);
  }
  const out: Record<string, string[]> = {};
  for (const members of sets.values()) if (members.length > 1) for (const id of members) out[id] = members;
  return out;
}

/** Days from `today` to `end` (both "YYYY-MM-DD"); negative once it has passed. */
export function daysUntil(end: string, today: string): number {
  const d = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((d(end) - d(today)) / 86_400_000);
}

export type ContractState = 'none' | 'ok' | 'ending' | 'ended';
export const ENDING_DAYS = 90;

export function contractState(end: string | undefined, today: string): ContractState {
  if (!end) return 'none';
  const left = daysUntil(end, today);
  return left < 0 ? 'ended' : left <= ENDING_DAYS ? 'ending' : 'ok';
}

/** Whether a stored document looks like a plan this version can read. */
export function isFloorPlan(x: unknown): x is FloorPlan {
  const p = x as FloorPlan;
  return !!p && p.version === 1 && Array.isArray(p.groups) && Array.isArray(p.links)
    && p.groups.every(g => typeof g.id === 'string' && typeof g.name === 'string' && Number.isInteger(g.cols) && Array.isArray(g.cells) && Array.isArray(g.gaps));
}
