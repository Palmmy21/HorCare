// The permanent LINE registration QR of a room: how a room's registration reads, and how a set of cards is cut into
// server calls and printed pages.

export type RequestStatus = 'pending' | 'approved' | 'rejected';

/** Someone scanned a room that already has a LINE account. Nothing changes until an admin decides. */
export interface RoomLineRequest {
  id: string;
  room_id: string;
  room_number: string;
  /** Server only: the status API sends `line_ref` instead. */
  line_user_id: string;
  line_ref: string;
  display_name: string;
  /** The OA they scanned from: 'tenant', 'market' or a team's `oa:<id>`. */
  channel: string;
  status: RequestStatus;
  created_at: string;
  decided_by?: string;
  decided_at?: string;
}

/** Open requests one room can hold, so a photo of a door can't flood the queue. */
export const MAX_PENDING_PER_ROOM = 5;
/** A rejected account can't ask for the same room again for this long. */
export const REJECT_COOLDOWN_MS = 24 * 3600 * 1000;

/**
 * linked       – on LINE and reachable
 * unreachable  – bound to the room, but LINE says we cannot message them (not a friend of the OA, or blocked)
 * unregistered – no LINE account yet
 */
export type RoomQrState = 'linked' | 'unreachable' | 'unregistered';

export function roomQrState(room: { line_user_id?: unknown; line_unreachable?: unknown }): RoomQrState {
  if (!room.line_user_id) return 'unregistered';
  return room.line_unreachable ? 'unreachable' : 'linked';
}

/** Rooms in one transaction: each can write 3 documents (retire old code, new code, room's pointer), within Firestore's 500. */
export const QR_CHUNK = 150;
export const CARDS_PER_PAGE = 9;

export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

interface Sortable { room_number: string; floor?: string; zone?: string }

/** The floor or zone a card is handed out on. */
export const groupOf = (r: Pick<Sortable, 'floor' | 'zone'>): string => (r.floor || r.zone || '').trim();

const byNumber = (a: string, b: string) => a.localeCompare(b, 'th', { numeric: true });

export function sortForPrint<T extends Sortable>(rooms: T[]): T[] {
  return [...rooms].sort((a, b) => byNumber(groupOf(a), groupOf(b)) || byNumber(a.room_number, b.room_number));
}

export interface PrintPage<T> { group: string; items: T[]; page: number; pages: number }

/** A4 pages, each floor or zone starting a new one, so a stack of paper can be split by floor before cutting. */
export function paginateForPrint<T extends Sortable>(rooms: T[], perPage = CARDS_PER_PAGE): PrintPage<T>[] {
  const groups = new Map<string, T[]>();
  for (const r of sortForPrint(rooms)) {
    const g = groupOf(r);
    const list = groups.get(g);
    if (list) list.push(r); else groups.set(g, [r]);
  }
  const pages = [...groups].flatMap(([group, items]) => chunk(items, perPage).map(part => ({ group, items: part })));
  return pages.map((p, i) => ({ ...p, page: i + 1, pages: pages.length }));
}
