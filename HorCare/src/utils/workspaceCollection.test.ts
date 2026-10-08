import { describe, expect, it } from 'vitest';
import {
  collectionStyleOf, defaultCollectionStyle, defaultRentType, getWorkspaceTerms, rentTypeLabel, rentTypeOptions, rentUnitLabel, BUILDING_TYPE_LABELS,
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

  it('hotels and resorts have no meters; everything else does', () => {
    expect(getWorkspaceTerms('resort').usesMeters).toBe(false);
    expect(getWorkspaceTerms('hotel').usesMeters).toBe(false);
    for (const t of ['dormitory', 'market', 'commercial', 'apartment'] as const) expect(getWorkspaceTerms(t).usesMeters).toBe(true);
  });

  it('every building type has a name for the branch card', () => {
    for (const t of ['dormitory', 'commercial', 'resort', 'hotel', 'apartment', 'condo', 'house', 'office', 'market', 'other'] as const) {
      expect(BUILDING_TYPE_LABELS[t].length).toBeGreaterThan(0);
    }
  });
});
