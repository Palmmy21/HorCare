// DormUtility Pro - Core Calculation Logic
import type { DormConfig, BillCalculation, WaterConfig, Room } from '../types';

/**
 * Calculate electricity bill
 * Formula: ค่าไฟ = (เลขเดือนนี้ - เลขเดือนก่อน) × ราคาต่อหน่วย
 */
export function calculateElectricity(
    prevReading: number,
    currReading: number,
    ratePerUnit: number
): { units: number; bill: number } {
    const units = Math.max(0, currReading - prevReading);
    const bill = units * ratePerUnit;
    return { units, bill };
}

/**
 * Calculate water bill with flat-rate tier system
 * Case 1: หน่วยที่ใช้ ≤ Limit → ค่าน้ำ = ราคาเหมาจ่าย
 * Case 2: หน่วยที่ใช้ > Limit → ค่าน้ำ = ราคาเหมาจ่าย + (ส่วนเกิน × ราคาต่อหน่วยส่วนเกิน)
 */
export function calculateWater(
    prevReading: number,
    currReading: number,
    waterConfig: WaterConfig,
    tenantCount: number = 1
): {
    units: number;
    bill: number;
    flatAmount: number;
    excessUnits: number;
    excessAmount: number;
} {
    const units = Math.max(0, currReading - prevReading);

    if (waterConfig.type === 'normal') {
        const bill = units * (waterConfig.unit_rate || 0);
        return {
            units,
            bill,
            flatAmount: 0,
            excessUnits: 0,
            excessAmount: 0
        };
    }

    // Flat rate tier calculation (Scaled by tenants)
    // Example: 1 person = 150B/5units -> 2 people = 300B/10units
    const tenants = Math.max(1, tenantCount);
    const flatPrice = (waterConfig.flat_price || 0) * tenants;
    const flatLimitUnit = (waterConfig.flat_limit_unit || 0) * tenants;
    const excessUnitRate = waterConfig.excess_unit_rate || 0;

    if (units <= flatLimitUnit) {
        // Case 1: Within limit
        return {
            units,
            bill: flatPrice,
            flatAmount: flatPrice,
            excessUnits: 0,
            excessAmount: 0
        };
    } else {
        // Case 2: Exceeding limit
        const excessUnits = units - flatLimitUnit;
        const excessAmount = excessUnits * excessUnitRate;
        const bill = flatPrice + excessAmount;
        return {
            units,
            bill,
            flatAmount: flatPrice,
            excessUnits,
            excessAmount
        };
    }
}

/**
 * Get effective rates for a room (room override > room-type default > global config)
 */
export function getEffectiveRates(
    room: Room,
    config: DormConfig
): { electricityRate: number; waterConfig: WaterConfig } {
    // Water config priority: room custom > room-type default > global
    const isCommercial = (room.room_type || 'dormitory') === 'commercial';
    const defaultWaterConfig = isCommercial
        ? (config.commercial_water_config ?? config.water_config)
        : config.water_config;

    return {
        electricityRate: room.custom_electricity_rate ?? config.electricity_rate,
        waterConfig: room.custom_water_config ?? defaultWaterConfig
    };
}

/**
 * Calculate full bill for a room
 */
export function calculateFullBill(
    prevElec: number,
    currElec: number,
    prevWater: number,
    currWater: number,
    config: DormConfig,
    roomRent: number,
    tenantCount: number = 1,
    roomElecRate?: number,
    roomWaterConfig?: WaterConfig
): BillCalculation {
    const elecRate = roomElecRate ?? config.electricity_rate;
    const waterCfg = roomWaterConfig ?? config.water_config;

    const elec = calculateElectricity(prevElec, currElec, elecRate);
    const water = calculateWater(prevWater, currWater, waterCfg, tenantCount);

    return {
        elec_units: elec.units,
        elec_bill: elec.bill,
        water_units: water.units,
        water_bill: water.bill,
        water_flat_amount: water.flatAmount,
        water_excess_units: water.excessUnits,
        water_excess_amount: water.excessAmount,
        total_bill: elec.bill + water.bill + roomRent
    };
}

/**
 * Format currency in Thai Baht
 */
export function formatCurrency(amount: number): string {
    return new Intl.NumberFormat('th-TH', {
        style: 'currency',
        currency: 'THB',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(amount);
}

/**
 * Format month string (YYYY-MM) to Thai display
 */
export function formatMonthThai(monthStr: string): string {
    const [year, month] = monthStr.split('-');
    const thaiMonths = [
        'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
        'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
    ];
    const thaiYear = parseInt(year) + 543;
    const monthIndex = parseInt(month) - 1;
    return `${thaiMonths[monthIndex]} ${thaiYear % 100}`;
}

/**
 * Get current month in YYYY-MM format
 */
export function getCurrentMonth(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
}

/**
 * Get previous month in YYYY-MM format
 */
export function getPreviousMonth(monthStr: string): string {
    const [year, month] = monthStr.split('-').map(Number);
    if (month === 1) {
        return `${year - 1}-12`;
    }
    return `${year}-${String(month - 1).padStart(2, '0')}`;
}

/**
 * Get next month in YYYY-MM format
 */
export function getNextMonth(monthStr: string): string {
    const [year, month] = monthStr.split('-').map(Number);
    if (month === 12) {
        return `${year + 1}-01`;
    }
    return `${year}-${String(month + 1).padStart(2, '0')}`;
}

/**
 * Generate a unique dormitory code for LINE registration (e.g. HC-K7MN2P)
 * Excludes O, 0, I, 1 to avoid confusion
 */
export function generateDormCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'HC-';
    for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
}

/**
 * Validate meter reading
 */
export function validateReading(
    prevReading: number,
    currReading: number
): { valid: boolean; warning?: string } {
    if (currReading < prevReading) {
        return {
            valid: false,
            warning: 'เลขมิเตอร์ปัจจุบันน้อยกว่าเดือนก่อน (ยกเว้นกรณีมิเตอร์วนรอบใหม่)'
        };
    }
    if (currReading - prevReading > 500) {
        return {
            valid: true,
            warning: 'หน่วยการใช้สูงผิดปกติ กรุณาตรวจสอบอีกครั้ง'
        };
    }
    return { valid: true };
}
