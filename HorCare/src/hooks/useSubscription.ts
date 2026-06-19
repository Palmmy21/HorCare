import type { PlanName, BillingCycle, LicenseType } from '../types';

/* ── Plan config ── */

export const TRIAL_MAX_ROOMS = 10;

export const PLAN_CONFIG = {
    small:  { maxRooms: 30,       name: 'หอเล็ก' },
    medium: { maxRooms: 100,      name: 'หอกลาง' },
    large:  { maxRooms: Infinity, name: 'หอใหญ่' },
} as const;

/** Max rooms allowed for a given license */
export function getMaxRooms(license: LicenseType): number {
    if (license === 'trial') return TRIAL_MAX_ROOMS;
    if (license === 'active') return Infinity;
    const parsed = parseLicense(license);
    if (!parsed) return 0;
    return PLAN_CONFIG[parsed.plan].maxRooms;
}

export const PLAN_PRICES = {
    small:  { monthly: 79,  yearly: 790 },
    medium: { monthly: 259, yearly: 1590 },
    large:  { monthly: 399, yearly: 2590 },
} as const;

/** Build license key from plan + cycle */
export function toLicenseType(plan: PlanName, cycle: BillingCycle): LicenseType {
    return `${cycle}_${plan}` as LicenseType;
}

/** Parse license key → plan + cycle */
export function parseLicense(license: LicenseType): { plan: PlanName; cycle: BillingCycle } | null {
    const match = license.match(/^(monthly|yearly)_(small|medium|large)$/);
    if (!match) return null;
    return { cycle: match[1] as BillingCycle, plan: match[2] as PlanName };
}

/** Whether this license is a paid subscription */
export function isPaidLicense(license: LicenseType): boolean {
    return parseLicense(license) !== null || license === 'active';
}

/** Whether this license can send bills via LINE (all paid plans) */
export function canSendLine(license: LicenseType): boolean {
    if (license === 'active' || license === 'trial') return true;
    return parseLicense(license) !== null;
}

/** Max buildings allowed for a given license */
export function getMaxBuildings(license: LicenseType): number {
    if (license === 'trial') return 1;
    if (license === 'active') return Infinity;
    const parsed = parseLicense(license);
    if (!parsed) return 1;
    if (parsed.plan === 'small')  return 1;
    if (parsed.plan === 'medium') return 3;
    return Infinity; // large
}

/** Whether this license includes multi-building (all paid plans) */
export function isLargePlan(license: LicenseType): boolean {
    if (license === 'active') return true;
    const parsed = parseLicense(license);
    return parsed?.plan === 'large';
}

// NOTE: ตัว hook useSubscription (mock checkout เขียน license ตรงจาก client) ถูกลบแล้ว —
// การจ่ายเงินจริงไปทาง PricingPage → /api/create-checkout → stripe-webhook เท่านั้น
// ไฟล์นี้เหลือเฉพาะ plan config + pure helpers ที่ App ใช้
