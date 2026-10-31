import { describe, expect, it } from 'vitest';
import { affectedRooms, cleanPlate, parkingSummary, roomParkingFor, spotCodes } from './parking';
import { rentForRecalc, roomFees } from '../utils/calculations';
import type { ParkingSpot } from '../types';

const spot = (id: string, code: string, room_id: string | null, fee = 500, kind: ParkingSpot['kind'] = 'car'): ParkingSpot => ({
  id, code, kind, monthly_fee: fee, room_id, room_number: room_id, created_at: '', updated_at: '',
});

describe('parking', () => {
  const spots = [spot('s2', 'A-10', 'r1'), spot('s1', 'A-02', 'r1', 300, 'motorcycle'), spot('s3', 'B-01', null), spot('s4', 'B-02', 'r2', 0)];

  it("derives a room's parking from its spots, sorted by code", () => {
    expect(roomParkingFor(spots, 'r1')).toEqual([
      { spot_id: 's1', code: 'A-02', kind: 'motorcycle', fee: 300, plate: null },
      { spot_id: 's2', code: 'A-10', kind: 'car', fee: 500, plate: null },
    ]);
    expect(roomParkingFor(spots, 'nobody')).toEqual([]);
  });

  it('lists the rooms touched by a move', () => {
    expect(affectedRooms({ room_id: 'r1' }, { room_id: 'r2' })).toEqual(['r1', 'r2']);
    expect(affectedRooms({ room_id: 'r1' }, { room_id: 'r1' })).toEqual(['r1']);
    expect(affectedRooms(null, { room_id: null })).toEqual([]);
  });

  it('summarises occupancy and income', () => {
    expect(parkingSummary(spots)).toEqual({ total: 4, rented: 3, vacant: 1, monthlyIncome: 800 });
  });

  it('makes runs of spot codes', () => {
    expect(spotCodes('A-', 1, 3)).toEqual(['A-01', 'A-02', 'A-03']);
    expect(spotCodes('M', 98, 3)).toEqual(['M098', 'M099', 'M100']);
    expect(spotCodes('A', 1, 0)).toBeNull();
    expect(spotCodes('A', 1, 500)).toBeNull();
  });

  it('accepts Thai plates and rejects junk', () => {
    expect(cleanPlate(' กข  1234 ')).toBe('กข 1234');
    expect(cleanPlate('1กก-5678')).toBe('1กก-5678');
    expect(cleanPlate('')).toBeNull();
    expect(cleanPlate('<script>')).toBeUndefined();
  });
});

describe('bill fees for a room', () => {
  it('adds paid parking spots to the common fees', () => {
    const fees = roomFees([{ id: 'f1', name: 'ส่วนกลาง', amount: 100, is_active: true, created_at: '' }], { parking: roomParkingFor([spot('s1', 'A-01', 'r1', 500), spot('s2', 'A-02', 'r1', 0)], 'r1') });
    expect(fees.map(f => [f.name, f.amount])).toEqual([['ส่วนกลาง', 100], ['ค่าที่จอดรถยนต์ A-01', 500]]);
    expect(roomFees([], {})).toEqual([]);
  });

  it('keeps a saved prorate when a bill is recalculated', () => {
    expect(rentForRecalc(3100, { rent_prorate: { days: 11, days_in_month: 31, full_rent: 3100, from: '2026-10-21', to: '2026-10-31' } })).toBe(1100);
    expect(rentForRecalc(3200, { rent_prorate: { days: 11, days_in_month: 31, full_rent: 3100, from: '2026-10-21', to: '2026-10-31' } })).toBe(1135);
    expect(rentForRecalc(3100, {})).toBe(3100);
    expect(rentForRecalc(3100, null)).toBe(3100);
  });
});
