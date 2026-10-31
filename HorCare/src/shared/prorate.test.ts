import { describe, expect, it } from 'vitest';
import { prorateRent, proratedAmount } from './prorate';

describe('prorateRent', () => {
  it('bills the days from a mid-month move-in', () => {
    const p = prorateRent(3100, '2026-10', { from: '2026-10-21' });
    expect(p).toMatchObject({ days: 11, days_in_month: 31, from: '2026-10-21', to: '2026-10-31' });
    expect(proratedAmount(3100, p)).toBe(1100);
  });
  it('bills the days up to a mid-month move-out', () => {
    const p = prorateRent(3000, '2026-11', { from: '2025-06-01', to: '2026-11-10' });
    expect(p).toMatchObject({ days: 10, days_in_month: 30, from: '2026-11-01', to: '2026-11-10' });
    expect(proratedAmount(3000, p)).toBe(1000);
  });
  it('handles moving in and out in the same month', () => {
    expect(prorateRent(2800, '2026-02', { from: '2026-02-10', to: '2026-02-16' })).toMatchObject({ days: 7, days_in_month: 28 });
  });
  it('bills the full month when the dates do not cut into it', () => {
    expect(prorateRent(3500, '2026-10', null)).toBeNull();
    expect(prorateRent(3500, '2026-10', { from: '2026-10-01' })).toBeNull();
    expect(prorateRent(3500, '2026-10', { from: '2026-03-15', to: '2027-01-31' })).toBeNull();
    expect(prorateRent(3500, '2026-10', { to: '2026-10-31' })).toBeNull();
    expect(prorateRent(3500, '2026-10', { from: '2026-10-20', to: '2026-10-05' })).toBeNull(); // inconsistent dates
    expect(prorateRent(0, '2026-10', { from: '2026-10-20' })).toBeNull();
    expect(proratedAmount(3500, null)).toBe(3500);
  });
});
