import { describe, expect, it } from 'vitest';
import { rentOnlyAmounts } from './calculations';
import { nextBillPatch } from '../hooks/useFirestore';

const fees = [
  { id: 'clean', name: 'ค่าขยะ', amount: 100, is_active: true, created_at: '' },
  { id: 'yearly', name: 'ค่าประกัน', amount: 1200, is_active: true, charge_cycle: 'yearly' as const, charge_month: 1, created_at: '' },
];

describe('rent-only bills', () => {
  it('bill rent and the monthly fees, with no meter lines', () => {
    const a = rentOnlyAmounts(3000, fees, { tenant_count: 1 }, '2026-11');
    expect(a).toMatchObject({
      elec_units: 0, elec_bill: 0, water_units: 0, water_bill: 0, water_flat_amount: 0, water_excess_amount: 0,
      room_rent: 3000, common_fee: 100, total_bill: 3100,
    });
    expect(a.applied_common_fees).toEqual([{ id: 'clean', name: 'ค่าขยะ', amount: 100 }]);
    // the yearly fee lands in its month only
    expect(rentOnlyAmounts(3000, fees, { tenant_count: 1 }, '2027-01').total_bill).toBe(4300);
  });

  it('a room override switches a fee off for that stall', () => {
    expect(rentOnlyAmounts(2500, fees, { common_fee_overrides: { clean: { is_active: false } } }, '2026-11').total_bill).toBe(2500);
  });

  it("recording last month's meters never adds meter charges to a rent-only bill", () => {
    const room = { id: 'r', room_number: 'A1', room_type: 'commercial', current_meter_elec: 0, current_meter_water: 0, is_active: true, rent_amount: 3000, rent_type: 'monthly' };
    const patch = nextBillPatch(
      { curr_elec: 500, curr_water: 40 } as never,
      { rent_only: true, total_bill: 3100, curr_elec: 0, curr_water: 0 } as never,
      room as never, '2026-12', { electricity_rate: 8, water_config: { type: 'flat_rate_tier', flat_price: 150, flat_limit_unit: 10, excess_unit_rate: 20 }, room_rent: 3000 } as never, [],
    );
    expect(patch).toEqual({ prev_elec: 500, prev_water: 40 });
  });
});
