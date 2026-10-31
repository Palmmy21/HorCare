import { describe, expect, it } from 'vitest';
import { chargeableLateDays, dueDateOf, lateFeeAmount } from './lateFee';

const perDay = { enabled: true, mode: 'per_day' as const, amount: 50, grace_days: 2, max_amount: 500 };
const flat = { enabled: true, mode: 'flat' as const, amount: 300, grace_days: 0 };

describe('lateFee', () => {
  it('clamps the due day to short months', () => {
    expect(dueDateOf('2026-02', 31)).toBe('2026-02-28');
    expect(dueDateOf('2026-10', 5)).toBe('2026-10-05');
  });
  it('counts days only after the due date and the grace period', () => {
    expect(chargeableLateDays('2026-10-05', '2026-10-05', 2)).toBe(0);
    expect(chargeableLateDays('2026-10-05', '2026-10-07', 2)).toBe(0);
    expect(chargeableLateDays('2026-10-05', '2026-10-08', 2)).toBe(1);
    expect(chargeableLateDays('2026-10-05', '2026-11-02', 0)).toBe(28); // across a month end
  });
  it('charges per day up to the cap', () => {
    expect(lateFeeAmount(perDay, '2026-10', 5, '2026-10-07')).toBe(0);
    expect(lateFeeAmount(perDay, '2026-10', 5, '2026-10-10')).toBe(150);
    expect(lateFeeAmount(perDay, '2026-10', 5, '2026-11-30')).toBe(500);
    expect(lateFeeAmount({ ...perDay, max_amount: 0 }, '2026-10', 5, '2026-10-27')).toBe(1000);
  });
  it('charges a flat fee once late', () => {
    expect(lateFeeAmount(flat, '2026-10', 5, '2026-10-05')).toBe(0);
    expect(lateFeeAmount(flat, '2026-10', 5, '2026-10-06')).toBe(300);
    expect(lateFeeAmount(flat, '2026-10', 5, '2026-12-01')).toBe(300);
  });
  it('charges nothing when off or misconfigured', () => {
    expect(lateFeeAmount(undefined, '2026-10', 5, '2026-12-01')).toBe(0);
    expect(lateFeeAmount({ ...flat, enabled: false }, '2026-10', 5, '2026-12-01')).toBe(0);
    expect(lateFeeAmount({ ...flat, amount: 0 }, '2026-10', 5, '2026-12-01')).toBe(0);
  });
});
