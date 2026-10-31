import { describe, expect, it } from 'vitest';
import { canStartTrial, effectiveLicense, isTrialActive, TRIAL_LICENSE, trialDaysLeft } from './trial';

const NOW = Date.UTC(2026, 9, 31);
const DAY = 86_400_000;

describe('trial', () => {
  it('lifts the free plan to Pro while the trial runs, and drops back afterwards', () => {
    expect(effectiveLicense({ license: 'free', trial_until: NOW + DAY }, NOW)).toBe(TRIAL_LICENSE);
    expect(effectiveLicense({ license: 'free', trial_until: NOW - 1 }, NOW)).toBe('free');
    expect(effectiveLicense({ license: 'free' }, NOW)).toBe('free');
    expect(effectiveLicense(undefined, NOW)).toBe('free');
  });
  it('never changes a paid or lifetime plan', () => {
    expect(effectiveLicense({ license: 'monthly_small', trial_until: NOW + DAY }, NOW)).toBe('monthly_small');
    expect(effectiveLicense({ license: 'active', trial_until: NOW + DAY }, NOW)).toBe('active');
  });
  it('allows one trial per free account', () => {
    expect(canStartTrial({ license: 'free' })).toBe(true);
    expect(canStartTrial({})).toBe(true);
    expect(canStartTrial({ license: 'free', trial_started_at: NOW - 40 * DAY })).toBe(false);
    expect(canStartTrial({ license: 'yearly_large' })).toBe(false);
  });
  it('counts whole days left', () => {
    expect(trialDaysLeft({ trial_until: NOW + 30 * DAY }, NOW)).toBe(30);
    expect(trialDaysLeft({ trial_until: NOW + 1 }, NOW)).toBe(1);
    expect(trialDaysLeft({ trial_until: NOW }, NOW)).toBe(0);
    expect(isTrialActive({ trial_until: NOW }, NOW)).toBe(false);
  });
});
