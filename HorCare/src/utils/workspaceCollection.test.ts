import { describe, expect, it } from 'vitest';
import {
  collectionStyleOf, defaultCollectionStyle, rentOnMeterBill, utilitiesBilledApart, defaultRentType, getWorkspaceTerms, rentTypeLabel, rentTypeOptions, rentUnitLabel, BUILDING_TYPE_LABELS,
} from './workspaceTerminology';

describe('each asset type collects money its own way', () => {
  it('hotels and resorts go per night, markets per day/week, the rest monthly', () => {
    expect(defaultCollectionStyle('resort')).toBe('nightly');
    expect(defaultCollectionStyle('hotel')).toBe('nightly');
    expect(defaultCollectionStyle('market')).toBe('stall');
    for (const t of ['dormitory', 'apartment', 'condo', 'house', 'commercial', 'office', undefined]) expect(defaultCollectionStyle(t)).toBe('monthly');
    expect(defaultRentType('resort')).toBe('daily');
    expect(defaultRentType('market', 'weekly')).toBe('weekly');
    expect(defaultRentType('market')).toBe('daily');
    expect(defaultRentType('dormitory')).toBe('monthly');
  });

  it('the owner\'s saved choice wins over the building type', () => {
    expect(collectionStyleOf({ building_type: 'resort', collection_style: 'monthly' })).toBe('monthly');
    expect(collectionStyleOf({ building_type: 'resort' })).toBe('nightly');
    expect(collectionStyleOf(undefined)).toBe('monthly');
  });

  it('never calls a hotel night or a market stall "monthly"', () => {
    expect(rentTypeLabel('daily', 'resort')).toBe('ต่อคืน');
    expect(rentTypeLabel('monthly', 'market')).toBe('เก็บตามกำหนด');
    expect(rentTypeLabel('daily', 'market')).toBe('เก็บรายวัน');
    expect(rentTypeLabel('monthly', 'dormitory')).toBe('รายเดือน');
    expect(rentTypeLabel(undefined, 'dormitory')).toBe('รายเดือน');
    expect(rentTypeOptions('hotel').map(o => o.value)).toEqual(['daily', 'weekly', 'monthly']);
    expect(rentTypeOptions('market').map(o => o.label)).not.toContain('รายเดือน');
    expect(rentTypeOptions('dormitory')[0].value).toBe('monthly');
  });

  it('quotes prices per the right unit', () => {
    expect(rentUnitLabel('daily', 'resort')).toBe('คืน');
    expect(rentUnitLabel('daily', 'market')).toBe('วัน');
    expect(rentUnitLabel('monthly', 'dormitory')).toBe('เดือน');
  });

  it('every type can bill water and electricity; rent rides on the meter bill only where rent is billed monthly', () => {
    for (const t of ['dormitory', 'market', 'commercial', 'apartment', 'resort', 'hotel'] as const) expect(getWorkspaceTerms(t).usesMeters).toBe(true);
    const room = { rent_type: 'monthly', rent_amount: 3000 };
    expect(rentOnMeterBill({ building_type: 'dormitory', room_rent: 3500 }, room)).toBe(3000);
    expect(rentOnMeterBill({ building_type: 'commercial', room_rent: 3500 }, {})).toBe(3500);
    // market (stall round) and resort / hotel (stays): utilities only, the rent is collected on its own screen
    expect(rentOnMeterBill({ building_type: 'market', room_rent: 3500 }, room)).toBe(0);
    expect(rentOnMeterBill({ building_type: 'resort', room_rent: 3500 }, room)).toBe(0);
    expect(rentOnMeterBill({ building_type: 'market', collection_style: 'monthly', room_rent: 3500 }, room)).toBe(3000);
    expect(rentOnMeterBill({ building_type: 'dormitory', room_rent: 3500 }, { rent_type: 'daily', rent_amount: 300 })).toBe(0);
    expect(utilitiesBilledApart({ building_type: 'market' })).toBe(true);
    expect(utilitiesBilledApart({ building_type: 'office' })).toBe(false);
  });

  it('every building type has a name for the branch card', () => {
    for (const t of ['dormitory', 'commercial', 'resort', 'hotel', 'apartment', 'condo', 'house', 'office', 'market', 'other'] as const) {
      expect(BUILDING_TYPE_LABELS[t].length).toBeGreaterThan(0);
    }
  });
});
