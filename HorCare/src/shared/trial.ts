// Free trial of HorCare Pro: one per account, 30 days, every feature.
// The account keeps license 'free'; the backend writes `trial_until` (epoch millis, protected in Firestore rules)
// and every plan check reads the plan through effectiveLicense(), so nothing has to be downgraded when it ends.

export const TRIAL_DAYS = 30;
/** The plan a trial unlocks: Pro (internal key 'large'). */
export const TRIAL_LICENSE = 'monthly_large';
/** localStorage flag: a visitor chose "try free", so the app starts the trial once they are signed in. */
export const START_TRIAL_KEY = 'horcare_start_trial';

export interface TrialFields {
    license?: string | null;
    trial_until?: number | null;
    trial_started_at?: number | null;
}

export function isTrialActive(u: TrialFields | null | undefined, now = Date.now()): boolean {
    return typeof u?.trial_until === 'number' && u.trial_until > now;
}

/** Whether this account may still start its trial (never started one, and is on the free plan). */
export function canStartTrial(u: TrialFields | null | undefined): boolean {
    return !u?.trial_started_at && (u?.license ?? 'free') === 'free';
}

/** The plan the account may use right now: a running trial lifts the free plan to Pro; paid plans are unchanged. */
export function effectiveLicense(u: TrialFields | null | undefined, now = Date.now()): string {
    const license = u?.license || 'free';
    return license === 'free' && isTrialActive(u, now) ? TRIAL_LICENSE : license;
}

/** Whole days left in a running trial (0 when none). */
export function trialDaysLeft(u: TrialFields | null | undefined, now = Date.now()): number {
    if (!isTrialActive(u, now)) return 0;
    return Math.ceil(((u!.trial_until as number) - now) / 86_400_000);
}
