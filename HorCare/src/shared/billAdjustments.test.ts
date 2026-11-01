import { describe, expect, it } from 'vitest';
import { adjustmentsTotal, baseTotal, cleanAdjustments } from './billAdjustments';

describe('bill adjustments', () => {
  const bill = { total_bill: 4300, adjustments: [{ id: 'a', label: 'ค่าซ่อม', amount: 500 }, { id: 'b', label: 'ส่วนลด', amount: -200 }] };

  it('adds charges and subtracts discounts', () => {
    expect(adjustmentsTotal(bill)).toBe(300);
    expect(baseTotal(bill)).toBe(4000);
    expect(adjustmentsTotal({})).toBe(0);
    expect(adjustmentsTotal(null)).toBe(0);
  });

  it('cleans editor rows: drops blanks, reads "1,200", keeps ids', () => {
    const r = cleanAdjustments([
      { id: 'a', label: ' ค่าซ่อม  แอร์ ', amount: '1,200' },
      { label: '', amount: '' },
      { label: 'ส่วนลด', amount: -100.456 },
    ], 4000);
    expect(r).toEqual({ ok: true, adjustments: [
      { id: 'a', label: 'ค่าซ่อม แอร์', amount: 1200 },
      { id: expect.stringMatching(/^adj_/), label: 'ส่วนลด', amount: -100.46 },
    ] });
  });

  it('says what to fix', () => {
    expect(cleanAdjustments([{ label: '', amount: 300 }], 4000)).toEqual({ ok: false, error: 'ใส่ชื่อรายการให้ครบทุกแถว' });
    expect(cleanAdjustments([{ label: 'ค่าซ่อม', amount: '' }], 4000)).toMatchObject({ ok: false });
    expect(cleanAdjustments([{ label: 'ส่วนลด', amount: -5000 }], 4000)).toEqual({ ok: false, error: 'ส่วนลดมากกว่ายอดบิล' });
    expect(cleanAdjustments([{ label: 'x', amount: 'abc' }], 4000)).toMatchObject({ ok: false });
  });
});

describe('recalculating a bill keeps its hand-added charges', () => {
  it('next month opening readings change, its extra charge stays in the total', async () => {
    const { nextBillPatch } = await import('../hooks/useFirestore');
    const config = { building_type: 'dormitory', electricity_rate: 8, water_config: { type: 'normal', unit_rate: 20 }, room_rent: 3000 } as const;
    const room = { id: 'r1', room_number: '101', room_type: 'dormitory', current_meter_elec: 0, current_meter_water: 0, is_active: true, rent_amount: 3000, rent_type: 'monthly' } as const;
    const bill = { curr_elec: 100, curr_water: 10 } as never;
    const next = {
      curr_elec: 150, curr_water: 15, total_bill: 0,
      adjustments: [{ id: 'a', label: 'ค่าซ่อม', amount: 500 }],
    } as never;
    const patch = nextBillPatch(bill, next, room as never, '2026-11', config as never, []);
    // 50 units × 8 + 5 units × 20 + 3,000 rent + 500 repair
    expect(patch.total_bill).toBe(400 + 100 + 3000 + 500);
  });
});
