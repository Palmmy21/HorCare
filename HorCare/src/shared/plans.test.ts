import { describe, expect, it } from 'vitest';
import { CHECKOUT_AMOUNTS, isPaidPlan, isPlusOrAbove, isProOrAbove, parsePlan } from './plans';
import { getMaxBuildings, getMaxRooms, PLAN_PRICES } from '../hooks/useSubscription';

describe('plans', () => {
  it('parses every plan key, Business included', () => {
    expect(parsePlan('yearly_business')).toEqual({ cycle: 'yearly', plan: 'business' });
    expect(parsePlan('monthly_large')).toEqual({ cycle: 'monthly', plan: 'large' });
    expect(parsePlan('free')).toBeNull();
    expect(parsePlan('monthly_huge')).toBeNull();
  });

  it('Business unlocks everything Pro does', () => {
    for (const l of ['monthly_business', 'yearly_business', 'active']) {
      expect(isPaidPlan(l)).toBe(true);
      expect(isPlusOrAbove(l)).toBe(true);
      expect(isProOrAbove(l)).toBe(true);
    }
    expect(isProOrAbove('monthly_medium')).toBe(false);
    expect(isPlusOrAbove('monthly_small')).toBe(false);
    expect(isPaidPlan('free')).toBe(false);
  });

  it('Business has no property or room limit; Pro keeps 10 properties', () => {
    expect(getMaxBuildings('monthly_business')).toBe(Infinity);
    expect(getMaxRooms('yearly_business')).toBe(Infinity);
    expect(getMaxBuildings('monthly_large')).toBe(10);
  });

  it('charges ฿679 a month or ฿5,000 a year, and the app shows what checkout charges', () => {
    expect(CHECKOUT_AMOUNTS.monthly_business).toBe(679);
    expect(CHECKOUT_AMOUNTS.yearly_business).toBe(5000);
    expect(PLAN_PRICES.business).toEqual({ monthly: 679, yearly: 5000 });
    expect(PLAN_PRICES.small).toEqual({ monthly: 149, yearly: 950 });
  });
});
