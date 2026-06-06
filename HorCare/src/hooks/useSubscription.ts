import { useCallback } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import type { PlanName, BillingCycle, LicenseType } from '../types';

/* ── Plan config ── */

export const TRIAL_MAX_ROOMS = 5;

export const PLAN_CONFIG = {
    small:  { maxRooms: 20,       name: 'หอเล็ก' },
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

/** Whether this license includes multi-building (Large plan only) */
export function isLargePlan(license: LicenseType): boolean {
    if (license === 'active') return true;
    const parsed = parseLicense(license);
    return parsed?.plan === 'large';
}

export function useSubscription(uid: string | null) {
    /**
     * Demo mode: simulate payment and write license to Firestore.
     * Replace the body of this function with Stripe Checkout redirect when ready.
     */
    const startCheckout = useCallback(
        async (plan: PlanName, cycle: BillingCycle): Promise<void> => {
            if (!uid) throw new Error('ไม่ได้เข้าสู่ระบบ');

            // ── TODO: Replace with real Stripe checkout ──
            // import { getFunctions, httpsCallable } from 'firebase/functions';
            // const functions = getFunctions();
            // const createSession = httpsCallable(functions, 'createCheckoutSession');
            // const { data } = await createSession({ plan, cycle, uid });
            // window.location.href = (data as { url: string }).url;
            // ─────────────────────────────────────────────

            // Demo mode: write license directly to Firestore
            const licenseType = toLicenseType(plan, cycle);
            const periodEnd = new Date();
            if (cycle === 'monthly') {
                periodEnd.setMonth(periodEnd.getMonth() + 1);
            } else {
                periodEnd.setFullYear(periodEnd.getFullYear() + 1);
            }

            await updateDoc(doc(db, 'users', uid), {
                license: licenseType,
                plan_name: plan,
                billing_cycle: cycle,
                subscription_status: 'active',
                current_period_end: periodEnd.toISOString(),
                // Demo: no real subscription_id
                subscription_id: `demo_${Date.now()}`,
            });
        },
        [uid],
    );

    /**
     * Check if a user with this license can manage `roomCount` rooms.
     */
    const isRoomCountAllowed = useCallback(
        (license: LicenseType, roomCount: number): boolean => {
            if (license === 'active') return true; // legacy lifetime
            const parsed = parseLicense(license);
            if (!parsed) return false;
            return roomCount <= PLAN_CONFIG[parsed.plan].maxRooms;
        },
        [],
    );

    return { startCheckout, isRoomCountAllowed, PLAN_CONFIG, PLAN_PRICES };
}
