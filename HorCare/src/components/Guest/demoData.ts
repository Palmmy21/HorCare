// Sample property shown to visitors who have not signed in. Built in memory: nothing is read from or written to Firestore.
import type { DormConfig, MonthlyBill, Room } from '../../types';
import { getCurrentMonth, getPreviousMonth } from '../../utils/calculations';

export const DEMO_BUILDING_NAME = 'หอพักตัวอย่าง HorCare';

export const DEMO_CONFIG: DormConfig = {
    building_type: 'dormitory',
    electricity_rate: 8,
    water_config: { type: 'flat_rate_tier', flat_price: 150, flat_limit_unit: 10, excess_unit_rate: 20 },
    commercial_water_config: { type: 'normal', unit_rate: 24 },
    room_rent: 3500,
};

// Deterministic pseudo-random numbers, so the sample looks the same on every visit.
function seeded(seed: number) {
    let s = seed;
    return () => {
        s = (s * 1103515245 + 12345) % 2147483648;
        return s / 2147483648;
    };
}

const FLOORS = 3;
const ROOMS_PER_FLOOR = 8;
const VACANT = new Set(['105', '207', '303']);

export const DEMO_ROOMS: Room[] = Array.from({ length: FLOORS * ROOMS_PER_FLOOR }, (_, i) => {
    const floor = Math.floor(i / ROOMS_PER_FLOOR) + 1;
    const number = `${floor}${String((i % ROOMS_PER_FLOOR) + 1).padStart(2, '0')}`;
    return {
        id: `demo-${number}`,
        room_number: number,
        room_type: 'dormitory',
        tenant_count: 1,
        current_meter_elec: 0,
        current_meter_water: 0,
        is_active: true,
        rent_amount: floor === 3 ? 4200 : 3500,
        rent_type: 'monthly',
        floor: String(floor),
        room_status: VACANT.has(number) ? 'vacant' : 'occupied',
    };
});

function buildBills(): MonthlyBill[] {
    const rand = seeded(42);
    const months: string[] = [];
    let m = getCurrentMonth();
    for (let i = 0; i < 6; i++) { months.unshift(m); m = getPreviousMonth(m); }

    const bills: MonthlyBill[] = [];
    const meters = new Map(DEMO_ROOMS.map(r => [r.id, { elec: 1000 + Math.floor(rand() * 4000), water: 100 + Math.floor(rand() * 400) }]));
    months.forEach((month, mi) => {
        const isCurrent = mi === months.length - 1;
        DEMO_ROOMS.forEach((room, ri) => {
            if (room.room_status === 'vacant') return;
            // this month the meters are still being read: a few rooms have no bill yet
            if (isCurrent && ri % 7 === 3) return;
            const meter = meters.get(room.id)!;
            const elecUnits = 80 + Math.floor(rand() * 170);
            const waterUnits = 4 + Math.floor(rand() * 12);
            const elecBill = elecUnits * DEMO_CONFIG.electricity_rate;
            const excess = Math.max(0, waterUnits - 10);
            const excessAmount = excess * 20;
            const total = room.rent_amount + elecBill + 150 + excessAmount;
            const status = !isCurrent ? 'paid' : ri % 5 === 0 ? 'pending' : ri % 3 === 0 ? 'unpaid' : 'paid';
            const at = `${month}-05T10:00:00.000Z`;
            bills.push({
                id: `demo-${month}-${room.room_number}`,
                room_id: room.id,
                room_number: room.room_number,
                month,
                prev_elec: meter.elec, curr_elec: meter.elec + elecUnits, elec_units: elecUnits, elec_bill: elecBill,
                prev_water: meter.water, curr_water: meter.water + waterUnits, water_units: waterUnits, water_bill: 0,
                water_flat_amount: 150, water_excess_units: excess, water_excess_amount: excessAmount,
                common_fee: 0,
                room_rent: room.rent_amount,
                total_bill: total,
                is_saved: true, is_locked: !isCurrent, is_notified: true,
                created_at: at, updated_at: at,
                payment_status: status,
                ...(status === 'paid' ? { paid_at: at, paid_method: 'auto' as const, payment_method: 'bank_transfer' as const, paid_amount: total } : {}),
            });
            meter.elec += elecUnits;
            meter.water += waterUnits;
        });
    });
    return bills;
}

export const DEMO_BILLS: MonthlyBill[] = buildBills();

export function demoStats(month: string) {
    const monthBills = DEMO_BILLS.filter(b => b.month === month);
    const totalRooms = DEMO_ROOMS.length;
    const savedCount = DEMO_ROOMS.filter(r => monthBills.some(b => b.room_id === r.id && b.is_saved)).length;
    return {
        savedCount,
        totalRooms,
        totalRevenue: monthBills.reduce((sum, b) => sum + b.total_bill, 0),
        isAllSaved: savedCount === totalRooms,
        progress: totalRooms > 0 ? (savedCount / totalRooms) * 100 : 0,
    };
}
