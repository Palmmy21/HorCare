// Buildings inside one property ("ตึก A", "ตึก B"), from each room's building_name. Pure.
// A property with rooms in two or more of them lets the owner work on one building at a time.

interface WingRoom { id: string; building_name?: string; is_active?: boolean }
interface WingBill { room_id: string; month: string; total_bill: number; is_saved?: boolean }

const clean = (s?: string) => (typeof s === 'string' ? s.trim() : '');

/** The buildings named on the property's rooms, in natural order ('A' < 'B' < 'ตึก 2' < 'ตึก 10'). */
export function wingsOf(rooms: WingRoom[]): string[] {
    return [...new Set(rooms.map(r => clean(r.building_name)).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
}

/** Whether the property has more than one building to choose between. */
export const hasWings = (rooms: WingRoom[]): boolean => wingsOf(rooms).length >= 2;

/** "A" → "ตึก A"; names that already say what they are ("อาคาร 2", "Tower B") are kept. */
export function wingLabel(name: string): string {
    return /^(ตึก|อาคาร|tower|building|block|บล็อก)/i.test(name) ? name : `ตึก ${name}`;
}

export function roomsInWing<T extends WingRoom>(rooms: T[], wing: string | null): T[] {
    return wing ? rooms.filter(r => clean(r.building_name) === wing) : rooms;
}

export function billsInWing<T extends WingBill>(bills: T[], rooms: WingRoom[]): T[] {
    const ids = new Set(rooms.map(r => r.id));
    return bills.filter(b => ids.has(b.room_id));
}

/** The month's progress for a set of rooms (same rules as useFirestore's getMonthStats). */
export function monthStatsOf(rooms: WingRoom[], bills: WingBill[], month: string) {
    const monthBills = bills.filter(b => b.month === month);
    const active = rooms.filter(r => r.is_active !== false);
    const savedCount = active.filter(r => monthBills.some(b => b.room_id === r.id && b.is_saved)).length;
    return {
        savedCount,
        totalRooms: active.length,
        totalRevenue: monthBills.reduce((s, b) => s + b.total_bill, 0),
        isAllSaved: active.length > 0 && savedCount === active.length,
        progress: active.length > 0 ? (savedCount / active.length) * 100 : 0,
    };
}

/** The chosen building, still valid for these rooms (a renamed or emptied building falls back to all). */
export function validWing(saved: string | null | undefined, rooms: WingRoom[]): string | null {
    return saved && wingsOf(rooms).includes(saved) && hasWings(rooms) ? saved : null;
}
