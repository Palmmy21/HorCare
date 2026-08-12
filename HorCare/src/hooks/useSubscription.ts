import type { PlanName, BillingCycle, LicenseType } from '../types';

/* ── Plan config ──────────────────────────────────────────
   Internal keys stay as small / medium / large (no Firestore migration needed).
   Display names: Start / Plus / Pro.
────────────────────────────────────────────────────────── */

export const FREE_MAX_ROOMS = 250;

export const PLAN_CONFIG = {
    small:  { maxRooms: 50,       displayName: 'Start' },
    medium: { maxRooms: 150,      displayName: 'Plus'  },
    large:  { maxRooms: Infinity, displayName: 'Pro'   },
} as const;

/** Human-readable plan name from license key */
export function getPlanDisplayName(license: LicenseType): string {
    if (license === 'free')   return 'Free';
    if (license === 'active') return 'Active';
    const parsed = parseLicense(license);
    if (!parsed) return license;
    return PLAN_CONFIG[parsed.plan].displayName;
}

/** Max rooms allowed for a given license */
export function getMaxRooms(license: LicenseType): number {
    if (license === 'free') return FREE_MAX_ROOMS;
    if (license === 'active') return Infinity;
    const parsed = parseLicense(license);
    if (!parsed) return 0;
    return PLAN_CONFIG[parsed.plan].maxRooms;
}

export const PLAN_PRICES = {
    small:  { monthly: 79,  yearly: 790  },
    medium: { monthly: 199, yearly: 1990 },
    large:  { monthly: 399, yearly: 2990 },
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

/** Whether this license is any paid subscription (Start / Plus / Pro / Active) */
export function isPaidLicense(license: LicenseType): boolean {
    return parseLicense(license) !== null || license === 'active';
}

/** Whether this license is Plus or above (medium / large / active) */
export function isPlusOrAbove(license: LicenseType): boolean {
    if (license === 'active') return true;
    const parsed = parseLicense(license);
    return parsed?.plan === 'medium' || parsed?.plan === 'large';
}

/** Whether this license can send bills via LINE (Start+ only) */
export function canSendLine(license: LicenseType): boolean {
    if (license === 'free') return false;
    if (license === 'active') return true;
    return parseLicense(license) !== null;
}

/** Max buildings allowed for a given license */
export function getMaxBuildings(license: LicenseType): number {
    if (license === 'free') return 1;
    if (license === 'active') return Infinity;
    const parsed = parseLicense(license);
    if (!parsed) return 1;
    if (parsed.plan === 'small')  return 1;
    if (parsed.plan === 'medium') return 5;
    return 10; // large = Pro
}

/** Whether this license is the Pro (large) tier */
export function isProPlan(license: LicenseType): boolean {
    if (license === 'active') return true;
    const parsed = parseLicense(license);
    return parsed?.plan === 'large';
}

// NOTE: ตัว hook useSubscription (mock checkout เขียน license ตรงจาก client) ถูกลบแล้ว —
// การจ่ายเงินจริงไปทาง PricingPage → /api/create-checkout → stripe-webhook เท่านั้น
// ไฟล์นี้เหลือเฉพาะ plan config + pure helpers ที่ App ใช้
