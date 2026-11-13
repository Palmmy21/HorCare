import { describe, expect, it } from 'vitest';
import { planStatus, thaiShortDate } from './accountStatus';

const NOW = Date.UTC(2026, 10, 13, 5, 0, 0); // 13 Nov 2026 12:00 Thai time
const DAY = 86_400_000;

describe('planStatus', () => {
  it('reads a running trial as Pro with its end date', () => {
    const s = planStatus({ license: 'free', trial_started_at: NOW - 10 * DAY, trial_until: NOW + 20 * DAY }, NOW);
    expect(s).toMatchObject({ kind: 'trial', license: 'monthly_large', daysLeft: 20, endsAt: NOW + 20 * DAY });
  });
  it('falls back to free once the trial ran out', () => {
    expect(planStatus({ license: 'free', trial_until: NOW - DAY }, NOW).kind).toBe('free');
  });
  it('shows a paid plan with days left and its cycle', () => {
    expect(planStatus({ license: 'yearly_large', access_until: NOW + 71 * DAY }, NOW))
      .toMatchObject({ kind: 'paid', cycle: 'yearly', daysLeft: 71 });
  });
  it('marks a lapsed paid plan as expired', () => {
    expect(planStatus({ license: 'monthly_medium', access_until: NOW - 1 }, NOW).kind).toBe('expired');
  });
  it('treats a paid plan without an end date as running', () => {
    expect(planStatus({ license: 'monthly_small' }, NOW)).toMatchObject({ kind: 'paid', endsAt: null });
  });
  it('knows the lifetime and free licenses', () => {
    expect(planStatus({ license: 'active' }, NOW).kind).toBe('unlimited');
    expect(planStatus(null, NOW).kind).toBe('free');
  });
});

describe('thaiShortDate', () => {
  it('writes the Buddhist year in Thai time', () => {
    expect(thaiShortDate(Date.UTC(2027, 0, 22, 18, 0))).toBe('23 ม.ค. 2570');
  });
});
