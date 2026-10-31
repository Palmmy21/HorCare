// Parking spaces: who has which spot, and the copy each room keeps for billing. Pure.
import type { ParkingKind, ParkingSpot, RoomParking } from '../types/index.js';

export const PARKING_KIND_LABELS: Record<ParkingKind, string> = { car: 'รถยนต์', motorcycle: 'มอเตอร์ไซค์', other: 'อื่นๆ' };

/** The room's parking copy, derived from every spot assigned to it (sorted by code). */
export function roomParkingFor(spots: ParkingSpot[], roomId: string): RoomParking[] {
    return spots
        .filter(s => s.room_id === roomId)
        .sort((a, b) => a.code.localeCompare(b.code, 'th', { numeric: true }))
        .map(s => ({ spot_id: s.id, code: s.code, kind: s.kind, fee: Math.max(0, Number(s.monthly_fee) || 0), plate: s.plate ?? null }));
}

/** Rooms whose parking copy must be rewritten when a spot moves from `before` to `after` (either may be null). */
export function affectedRooms(before: Pick<ParkingSpot, 'room_id'> | null, after: Pick<ParkingSpot, 'room_id'> | null): string[] {
    return [...new Set([before?.room_id, after?.room_id].filter((r): r is string => !!r))];
}

export interface ParkingSummary { total: number; rented: number; vacant: number; monthlyIncome: number }

export function parkingSummary(spots: ParkingSpot[]): ParkingSummary {
    const rented = spots.filter(s => s.room_id);
    return {
        total: spots.length,
        rented: rented.length,
        vacant: spots.length - rented.length,
        monthlyIncome: rented.reduce((sum, s) => sum + Math.max(0, Number(s.monthly_fee) || 0), 0),
    };
}

/** Codes for a run of spots: prefix 'A-', from 1, count 3, width 2 → A-01, A-02, A-03. Null when out of range. */
export function spotCodes(prefix: string, from: number, count: number): string[] | null {
    if (!Number.isInteger(from) || !Number.isInteger(count) || from < 0 || count < 1 || count > 200) return null;
    const width = Math.max(2, String(from + count - 1).length);
    const p = prefix.trim().slice(0, 10);
    return Array.from({ length: count }, (_, i) => `${p}${String(from + i).padStart(width, '0')}`);
}

/** Thai licence plate, loosely: letters/digits/spaces/dashes, 2–20 chars. Empty → null; malformed → undefined. */
export function cleanPlate(v: unknown): string | null | undefined {
    if (v === undefined || v === null || v === '') return null;
    if (typeof v !== 'string') return undefined;
    const t = v.replace(/\s+/g, ' ').trim();
    if (!t) return null;
    return t.length >= 2 && t.length <= 20 && /^[\p{L}\p{M}\p{N} -]+$/u.test(t) ? t : undefined;
}
