// One LINE account, one or more rooms. A teacher who rents three rooms for students, a parent paying for two children,
// a company housing staff: the bills of every room go to the same LINE account.
//
// `line_rooms/{lineUserId}` keeps its original shape — the fields of ONE room at the top level — so everything written
// for a single room keeps working untouched. That room is the "primary". When the account holds more than one room the
// document also carries `rooms`, the full list with the primary first. No `rooms` field means exactly one room.
// Pure: no Firestore here, so the rules can be tested exhaustively.

export interface LinkedRoom {
    uid: string;
    building_id: string;
    room_id: string;
    room_number: string;
    dorm_name?: string;
    due_day?: number;
}

/** Fields that describe a room; everything else on the document (slip window, split mode, …) belongs to the account. */
const ROOM_FIELDS = ['uid', 'building_id', 'room_id', 'room_number', 'dorm_name', 'due_day'] as const;

/** A LINE account may hold this many rooms; more is a property manager, who has the app. */
export const MAX_ROOMS_PER_LINE = 20;

export const sameRoom = (a: Pick<LinkedRoom, 'uid' | 'building_id' | 'room_id'>, b: Pick<LinkedRoom, 'uid' | 'building_id' | 'room_id'>): boolean =>
    a.uid === b.uid && a.building_id === b.building_id && a.room_id === b.room_id;

const pickRoom = (src: Record<string, unknown>): LinkedRoom => {
    const out: Record<string, unknown> = {};
    for (const f of ROOM_FIELDS) if (src[f] !== undefined) out[f] = src[f];
    out.room_number = String(src.room_number ?? '');
    return out as unknown as LinkedRoom;
};

const isRoomEntry = (r: unknown): r is Record<string, unknown> =>
    !!r && typeof r === 'object' && typeof (r as LinkedRoom).uid === 'string' && typeof (r as LinkedRoom).building_id === 'string' && typeof (r as LinkedRoom).room_id === 'string';

/** Every room a `line_rooms` document holds, primary first. A missing document holds none. */
export function roomsOfLink(link: Record<string, unknown> | null | undefined): LinkedRoom[] {
    if (!link || !isRoomEntry(link)) return [];
    const primary = pickRoom(link);
    const listed = Array.isArray(link.rooms) ? link.rooms.filter(isRoomEntry).map(pickRoom) : [];
    const out = [primary];
    for (const r of listed) if (!out.some(o => sameRoom(o, r))) out.push(r);
    return out;
}

/**
 * The document to store for a list of rooms (first = primary), keeping the account's other fields.
 * Null when the list is empty: the document should be deleted.
 */
export function linkWithRooms(link: Record<string, unknown> | null | undefined, rooms: LinkedRoom[]): Record<string, unknown> | null {
    if (rooms.length === 0) return null;
    const rest: Record<string, unknown> = { ...(link ?? {}) };
    for (const f of ROOM_FIELDS) delete rest[f];
    delete rest.rooms;
    const out: Record<string, unknown> = { ...rest, ...rooms[0] };
    if (rooms.length > 1) out.rooms = rooms;
    return out;
}

/** The list after adding a room (unchanged if it is already there; refreshed in place if its details changed). */
export function addRoom(rooms: LinkedRoom[], room: LinkedRoom): LinkedRoom[] {
    return rooms.some(r => sameRoom(r, room)) ? rooms.map(r => (sameRoom(r, room) ? { ...r, ...room } : r)) : [...rooms, room];
}

export function removeRoom(rooms: LinkedRoom[], room: Pick<LinkedRoom, 'uid' | 'building_id' | 'room_id'>): LinkedRoom[] {
    return rooms.filter(r => !sameRoom(r, room));
}

/** "101, 102 และ 103" — how a set of rooms is named in a sentence. */
export function roomNumbersText(rooms: Pick<LinkedRoom, 'room_number'>[]): string {
    const n = rooms.map(r => r.room_number);
    return n.length <= 1 ? (n[0] ?? '') : `${n.slice(0, -1).join(', ')} และ ${n[n.length - 1]}`;
}

/**
 * What registering another room should do for someone who already has one.
 *   'bind'    nothing to ask: no room yet, or this very room
 *   'ask'     exactly one other room: they may be moving, or taking a second room — ask
 *   'add'     already several rooms: it can only be one more
 *   'full'    at the limit
 */
export function registrationChoice(current: LinkedRoom[], target: Pick<LinkedRoom, 'uid' | 'building_id' | 'room_id'>): 'bind' | 'ask' | 'add' | 'full' {
    if (current.length === 0 || current.some(r => sameRoom(r, target))) return 'bind';
    if (current.length >= MAX_ROOMS_PER_LINE) return 'full';
    return current.length === 1 ? 'ask' : 'add';
}

export type BindMode = 'move' | 'add';
export const isBindMode = (v: unknown): v is BindMode => v === 'move' || v === 'add';
