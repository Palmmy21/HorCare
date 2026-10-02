// Pure logic for AI batch meter reading: matching OCR results to rooms and deciding
// what a human must look at. No Firebase / React so it is easy to test.
//
// Policy: the AI only *proposes*. Nothing reaches a real meter record until the item
// is confirmed, and an item with a blocking flag can never be confirmed (or bulk
// confirmed) until the problem is fixed.

import { normalizeRoomNumber } from './bulkRooms';

export type MeterType = 'electric' | 'water' | 'unknown';

export type MeterFlag =
  | 'no_reading'          // AI could not read a number
  | 'unknown_type'        // electric vs water not identified
  | 'room_not_found'      // room number missing or not in this property
  | 'room_ambiguous'      // room number matches more than one room
  | 'duplicate_in_batch'  // another photo in this batch is the same room + meter type
  | 'month_locked'        // the room's bill for this month is already closed
  | 'low_confidence'      // AI confidence under threshold
  | 'below_previous'      // reading is lower than last month's
  | 'abnormal_jump';      // usage far above the room's norm

/** Blocking flags: the user must fix these; they cannot be overridden. */
export const BLOCKING_FLAGS: readonly MeterFlag[] = [
  'no_reading', 'unknown_type', 'room_not_found', 'room_ambiguous', 'duplicate_in_batch', 'month_locked',
];
/** Warning flags: a person may confirm after checking the photo (explicit override). */
export const WARNING_FLAGS: readonly MeterFlag[] = ['low_confidence', 'below_previous', 'abnormal_jump'];

export const FLAG_LABELS_TH: Record<MeterFlag, string> = {
  no_reading: 'อ่านเลขไม่ได้',
  unknown_type: 'ไม่ทราบชนิดมิเตอร์',
  room_not_found: 'ไม่พบเลขห้อง',
  room_ambiguous: 'เลขห้องตรงหลายห้อง',
  duplicate_in_batch: 'ห้อง/ชนิดซ้ำในชุดนี้',
  month_locked: 'บิลเดือนนี้ปิดแล้ว',
  low_confidence: 'AI ไม่มั่นใจ',
  below_previous: 'ต่ำกว่าเดือนก่อน',
  abnormal_jump: 'เพิ่มผิดปกติ',
};

export interface MeterSettings {
  /** AI confidence (0..1) below this → low_confidence. */
  minConfidence: number;
  /** Usage above (last month's usage × ratio) → abnormal_jump. */
  jumpRatio: number;
  /** Never flag a jump smaller than this many units (avoids noise on near-zero rooms). */
  minJumpUnits: Record<'electric' | 'water', number>;
  /** Used when a room has no usage history to compare against. */
  fallbackMaxUnits: Record<'electric' | 'water', number>;
}

export const DEFAULT_METER_SETTINGS: MeterSettings = {
  minConfidence: 0.8,
  jumpRatio: 3,
  minJumpUnits: { electric: 150, water: 30 },
  fallbackMaxUnits: { electric: 1500, water: 200 },
};

export type ItemStatus = 'processing' | 'review_required' | 'confirmed' | 'saved' | 'error';

export interface BatchItem {
  id: string;
  fileName: string;
  /** Object URL of the original photo, shown beside the AI's reading. */
  previewUrl?: string;
  status: ItemStatus;
  /** Room number as read by the AI (kept for display even after the user remaps). */
  ocrRoom: string | null;
  /** Room chosen by the user, or matched automatically. null = unmatched. */
  roomId: string | null;
  meterType: MeterType;
  /** Editable text so the user can correct digits. */
  reading: string;
  confidence: number;
  note?: string;
  error?: string;
  /** User confirmed despite warning flags. */
  overridden?: boolean;
}

export interface RoomRef { id: string; room_number: string; is_active?: boolean }

export interface RoomMeterContext {
  /** Previous month's closing reading for this meter type. */
  previous: number;
  /** Units used last month for this meter type (undefined = no history). */
  lastUnits?: number;
  locked: boolean;
}

export type MatchResult =
  | { kind: 'matched'; roomId: string }
  | { kind: 'not_found' }
  | { kind: 'ambiguous'; roomIds: string[] };

/** Match the AI's room text against this property's rooms. Never guesses on ties. */
export function matchRoom(rooms: RoomRef[], ocrRoom: string | null): MatchResult {
  if (!ocrRoom || !ocrRoom.trim()) return { kind: 'not_found' };
  const key = normalizeRoomNumber(ocrRoom).replace(/\s+/g, '');
  const hits = rooms.filter(r => r.is_active !== false && normalizeRoomNumber(r.room_number).replace(/\s+/g, '') === key);
  if (hits.length === 1) return { kind: 'matched', roomId: hits[0].id };
  if (hits.length > 1) return { kind: 'ambiguous', roomIds: hits.map(h => h.id) };
  return { kind: 'not_found' };
}

export function parseReading(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Compute the flags for every item. Duplicate detection needs the whole batch, so this
 * works on the list. Items still processing/errored get no flags.
 */
export function computeFlags(
  items: BatchItem[],
  rooms: RoomRef[],
  getContext: (roomId: string, type: 'electric' | 'water') => RoomMeterContext | undefined,
  settings: MeterSettings = DEFAULT_METER_SETTINGS,
): Record<string, MeterFlag[]> {
  const out: Record<string, MeterFlag[]> = {};

  // Count how many live items claim the same room + meter type.
  const claims = new Map<string, number>();
  const claimKey = (i: BatchItem) => `${i.roomId}|${i.meterType}`;
  for (const i of items) {
    if (i.status === 'processing' || i.status === 'error' || !i.roomId || i.meterType === 'unknown') continue;
    claims.set(claimKey(i), (claims.get(claimKey(i)) ?? 0) + 1);
  }

  for (const item of items) {
    if (item.status === 'processing' || item.status === 'error') { out[item.id] = []; continue; }
    const flags: MeterFlag[] = [];

    const reading = parseReading(item.reading);
    if (reading === null) flags.push('no_reading');
    if (item.meterType === 'unknown') flags.push('unknown_type');

    if (!item.roomId || !rooms.some(r => r.id === item.roomId)) {
      const m = matchRoom(rooms, item.ocrRoom);
      flags.push(m.kind === 'ambiguous' ? 'room_ambiguous' : 'room_not_found');
    } else if (item.meterType !== 'unknown' && (claims.get(claimKey(item)) ?? 0) > 1) {
      flags.push('duplicate_in_batch');
    }

    if (item.confidence < settings.minConfidence) flags.push('low_confidence');

    if (item.roomId && item.meterType !== 'unknown' && reading !== null) {
      const ctx = getContext(item.roomId, item.meterType);
      if (ctx) {
        if (ctx.locked) flags.push('month_locked');
        if (reading < ctx.previous) {
          flags.push('below_previous');
        } else {
          const used = reading - ctx.previous;
          const limit = ctx.lastUnits !== undefined && ctx.lastUnits > 0
            ? Math.max(ctx.lastUnits * settings.jumpRatio, settings.minJumpUnits[item.meterType])
            : settings.fallbackMaxUnits[item.meterType];
          if (used > limit) flags.push('abnormal_jump');
        }
      }
    }
    out[item.id] = flags;
  }
  return out;
}

export const isBlocking = (f: MeterFlag) => BLOCKING_FLAGS.includes(f);

/** Can this item be confirmed at all? Blocking flags can never be overridden. */
export function canConfirm(flags: MeterFlag[]): boolean {
  return !flags.some(isBlocking);
}

/** Bulk confirm only touches items with no flags whatsoever — warnings need an eye on the photo. */
export function canBulkConfirm(flags: MeterFlag[]): boolean {
  return flags.length === 0;
}

export interface RoomReadings { roomId: string; electric?: number; water?: number }

/** Fold confirmed items into one entry per room (a room has one electric + one water reading). */
export function groupConfirmed(items: BatchItem[]): RoomReadings[] {
  const byRoom = new Map<string, RoomReadings>();
  for (const i of items) {
    if (i.status !== 'confirmed' || !i.roomId || i.meterType === 'unknown') continue;
    const reading = parseReading(i.reading);
    if (reading === null) continue;
    const cur = byRoom.get(i.roomId) ?? { roomId: i.roomId };
    if (i.meterType === 'electric') cur.electric = reading; else cur.water = reading;
    byRoom.set(i.roomId, cur);
  }
  return [...byRoom.values()];
}
