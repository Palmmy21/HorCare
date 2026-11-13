/**
 * หมวดหมู่ของยูนิต — one branch can hold several kinds of property (rooms, condos, houses, land…) and be filtered and
 * summed by kind. A unit without its own category takes the branch's kind, so existing branches need no change.
 *
 * Land (and anything the owner marks so) has no meters: it is billed rent-only and kept off the meter rounds.
 */
import type { DormConfig, Room } from '../types/index.js';

export const UNIT_CATEGORIES = ['room', 'condo', 'house', 'townhouse', 'land', 'commercial', 'office', 'stall', 'warehouse', 'other'] as const;
export type UnitCategory = (typeof UNIT_CATEGORIES)[number];

export const UNIT_CATEGORY_LABELS: Record<UnitCategory, string> = {
    room: 'ห้องพัก',
    condo: 'คอนโด',
    house: 'บ้านเช่า',
    townhouse: 'ทาวน์โฮม',
    land: 'ที่ดิน',
    commercial: 'อาคารพาณิชย์/ร้านค้า',
    office: 'สำนักงาน',
    stall: 'แผงค้า',
    warehouse: 'โกดัง/โรงงาน',
    other: 'อื่นๆ',
};

/** Kinds that normally have no electricity / water meter of their own. */
const METERLESS: ReadonlySet<UnitCategory> = new Set(['land']);

export function isUnitCategory(v: unknown): v is UnitCategory {
    return typeof v === 'string' && (UNIT_CATEGORIES as readonly string[]).includes(v);
}

/** The kind a branch's units are when they have none of their own. */
export function defaultCategoryFor(buildingType?: DormConfig['building_type']): UnitCategory {
    switch (buildingType) {
        case 'condo': return 'condo';
        case 'house': return 'house';
        case 'market': return 'stall';
        case 'commercial': return 'commercial';
        case 'office': return 'office';
        case 'other': return 'other';
        default: return 'room'; // dormitory, apartment, hotel, resort
    }
}

export function categoryOf(room: Pick<Room, 'unit_category'>, buildingType?: DormConfig['building_type']): UnitCategory {
    return isUnitCategory(room.unit_category) ? room.unit_category : defaultCategoryFor(buildingType);
}

/** Does this unit have meters to read? The owner's choice wins; otherwise land has none. */
export function unitHasMeters(room: Pick<Room, 'unit_category' | 'has_meters'>, buildingType?: DormConfig['building_type']): boolean {
    if (typeof room.has_meters === 'boolean') return room.has_meters;
    return !METERLESS.has(categoryOf(room, buildingType));
}

/** The kinds present among these units, in the standard order — the filter shows only when there is more than one. */
export function categoriesInUse(rooms: Pick<Room, 'unit_category'>[], buildingType?: DormConfig['building_type']): UnitCategory[] {
    const used = new Set(rooms.map(r => categoryOf(r, buildingType)));
    return UNIT_CATEGORIES.filter(c => used.has(c));
}

// Most specific first: 'ทาวน์โฮม' before 'บ้าน', 'คอนโด' before 'ห้อง'.
const WORDS: [UnitCategory, RegExp][] = [
    ['townhouse', /ทาวน์|townho|town\s*home|ทาวเฮาส์/i],
    ['condo', /คอนโด|condo/i],
    ['land', /ที่ดิน|ที่ว่าง|แปลง|ไร่|land|plot/i],
    ['warehouse', /โกดัง|โรงงาน|คลังสินค้า|warehouse|factory/i],
    ['office', /สำนักงาน|ออฟฟิศ|office/i],
    ['stall', /แผง|ล็อก|ล็อค|stall|booth|kiosk/i],
    ['commercial', /พาณิชย์|ร้าน|อาคารพาณิชย์|ตึกแถว|shop|commercial|retail/i],
    ['house', /บ้าน|house|villa|วิลล่า/i],
    ['room', /ห้อง|หอ|อพาร์ต|อพาร์ท|แมนชั่น|room|apartment|studio|dorm/i],
    ['other', /อื่น|other/i],
];

/** 'บ้านเช่า', 'Condo', 'ที่ดินให้เช่า' → the category; empty → null; unrecognised → undefined. */
export function parseUnitCategory(v: string): UnitCategory | null | undefined {
    const t = v.trim();
    if (!t) return null;
    if (isUnitCategory(t)) return t;
    const exact = UNIT_CATEGORIES.find(c => UNIT_CATEGORY_LABELS[c] === t);
    if (exact) return exact;
    return WORDS.find(([, re]) => re.test(t))?.[0];
}

export interface CategoryTotal {
    category: UnitCategory;
    units: number;
    /** units with a bill this month */
    billed: number;
    /** this month's billed amount */
    amount: number;
    /** of that, paid */
    paid: number;
}

/** Per kind of property: how many units, how many billed this month, and how much was billed / collected. */
export function categoryTotals(
    rooms: (Pick<Room, 'id' | 'unit_category'> & { is_active?: boolean })[],
    bills: { room_id: string; month: string; total_bill: number; payment_status?: string }[],
    month: string,
    buildingType?: DormConfig['building_type'],
): CategoryTotal[] {
    const catOf = new Map(rooms.filter(r => r.is_active !== false).map(r => [r.id, categoryOf(r, buildingType)]));
    const totals = new Map<UnitCategory, CategoryTotal>();
    for (const c of catOf.values()) {
        const t = totals.get(c) ?? { category: c, units: 0, billed: 0, amount: 0, paid: 0 };
        t.units++;
        totals.set(c, t);
    }
    for (const b of bills) {
        if (b.month !== month) continue;
        const c = catOf.get(b.room_id);
        const t = c ? totals.get(c) : undefined;
        if (!t) continue;
        t.billed++;
        t.amount += Number(b.total_bill) || 0;
        if (b.payment_status === 'paid') t.paid += Number(b.total_bill) || 0;
    }
    return UNIT_CATEGORIES.filter(c => totals.has(c)).map(c => totals.get(c)!);
}
