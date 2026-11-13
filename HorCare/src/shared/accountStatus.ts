// โปรไฟล์ของฉัน: what the account's plan is right now, in one shape the profile page can show.
// Pure, so it can be tested; the rules mirror shared/trial.ts and the access_until expiry the app enforces.

import { isTrialActive, TRIAL_LICENSE } from './trial.js';

export type PlanStatusKind = 'trial' | 'paid' | 'expired' | 'free' | 'unlimited';

export interface PlanFacts {
  license?: string | null;
  trial_until?: number | null;
  trial_started_at?: number | null;
  /** epoch millis: paid access ends here (the app's single source of truth for expiry) */
  access_until?: number | null;
  subscription_status?: string | null;
  billing_cycle?: string | null;
}

export interface PlanStatus {
  kind: PlanStatusKind;
  /** the license the account may use now (a running trial counts as Pro) */
  license: string;
  /** epoch millis the current period ends, or null when it never does */
  endsAt: number | null;
  /** whole days until endsAt (0 when past or none) */
  daysLeft: number;
  cycle: 'monthly' | 'yearly' | null;
}

const PAID_RE = /^(monthly|yearly)_(small|medium|large|business)$/;

export function planStatus(p: PlanFacts | null | undefined, now = Date.now()): PlanStatus {
  const license = p?.license || 'free';
  const days = (t: number) => Math.max(0, Math.ceil((t - now) / 86_400_000));

  if (license === 'free' && isTrialActive(p, now)) {
    const end = p!.trial_until as number;
    return { kind: 'trial', license: TRIAL_LICENSE, endsAt: end, daysLeft: days(end), cycle: null };
  }
  if (license === 'active') return { kind: 'unlimited', license, endsAt: null, daysLeft: 0, cycle: null };

  const paid = license.match(PAID_RE);
  if (paid) {
    const end = typeof p?.access_until === 'number' && p.access_until > 0 ? p.access_until : null;
    const cycle = paid[1] as 'monthly' | 'yearly';
    if (end !== null && end <= now) return { kind: 'expired', license, endsAt: end, daysLeft: 0, cycle };
    return { kind: 'paid', license, endsAt: end, daysLeft: end ? days(end) : 0, cycle };
  }
  return { kind: 'free', license: 'free', endsAt: null, daysLeft: 0, cycle: null };
}

/** "13 พ.ย. 2569" for an epoch-millis moment, in Thai time. */
export function thaiShortDate(ms: number): string {
  const d = new Date(ms + 7 * 3600_000);
  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear() + 543}`;
}
