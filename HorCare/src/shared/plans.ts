// Plan keys and what each one unlocks. One place for the app and the API, so adding a plan cannot miss a check.
// Internal keys stay small / medium / large (no Firestore migration); display names Start / Plus / HorCare Pro / Business.

export const PLAN_KEYS = ['small', 'medium', 'large', 'business'] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

const LICENSE_RE = /^(monthly|yearly)_(small|medium|large|business)$/;

/** 'monthly_large' → { cycle: 'monthly', plan: 'large' }; null for 'free', 'active' or anything unknown. */
export function parsePlan(license: string | null | undefined): { cycle: 'monthly' | 'yearly'; plan: PlanKey } | null {
    const m = (license ?? '').match(LICENSE_RE);
    return m ? { cycle: m[1] as 'monthly' | 'yearly', plan: m[2] as PlanKey } : null;
}

/** Any paid plan, or the lifetime licence. */
export function isPaidPlan(license: string | null | undefined): boolean {
    return license === 'active' || parsePlan(license) !== null;
}

/** Plus and above: AI meter reading, parcel label reading. */
export function isPlusOrAbove(license: string | null | undefined): boolean {
    if (license === 'active') return true;
    const p = parsePlan(license)?.plan;
    return p === 'medium' || p === 'large' || p === 'business';
}

/** HorCare Pro and above: น้องแคร์ AI and the rest of the top tier. */
export function isProOrAbove(license: string | null | undefined): boolean {
    if (license === 'active') return true;
    const p = parsePlan(license)?.plan;
    return p === 'large' || p === 'business';
}

/** One-time checkout amounts in baht, by license key (Stripe price_data; PromptPay cannot do subscriptions). */
export const CHECKOUT_AMOUNTS: Record<string, number> = {
    monthly_small: 149, yearly_small: 950,
    monthly_medium: 259, yearly_medium: 1590,
    monthly_large: 399, yearly_large: 2990,
    monthly_business: 679, yearly_business: 5000,
};
