import { describe, expect, it } from 'vitest';
import { invoiceDueDate, invoiceLines, invoiceNumber } from './invoice';
import type { MonthlyBill } from '../types';

const bill = (over: Partial<MonthlyBill> = {}) => ({
  id: 'b', room_id: 'r', room_number: '101', month: '2026-10',
  prev_elec: 100, curr_elec: 150, elec_units: 50, elec_bill: 400,
  prev_water: 10, curr_water: 15, water_units: 5, water_bill: 90,
  water_flat_amount: 0, water_excess_units: 0, water_excess_amount: 0,
  common_fee: 200, applied_common_fees: [{ id: 'f', name: 'ค่าส่วนกลาง', amount: 200 }],
  room_rent: 3500, adjustments: [{ id: 'a', label: 'ส่วนลด', amount: -100 }],
  total_bill: 4090, is_saved: true, is_locked: false, is_notified: false, created_at: '', updated_at: '',
  ...over,
}) as MonthlyBill;

describe('invoiceLines', () => {
  it('adds up to the bill total, with the rate behind each meter line', () => {
    const lines = invoiceLines(bill());
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(4090);
    expect(lines.find(l => l.label === 'ค่าไฟฟ้า')).toMatchObject({ qty: 50, rate: 8, detail: 'มิเตอร์ 100 → 150' });
  });

  it('leaves the meters out of a rent-only bill and shows flat water as one line', () => {
    expect(invoiceLines(bill({ rent_only: true })).map(l => l.label)).toEqual(['ค่าเช่า', 'ค่าส่วนกลาง', 'ส่วนลด']);
    expect(invoiceLines(bill({ water_flat_amount: 150 })).some(l => l.label === 'ค่าน้ำประปา (เหมาจ่าย)')).toBe(true);
  });
});

describe('invoice number and due date', () => {
  it('is stable per bill', () => expect(invoiceNumber({ month: '2026-10', room_number: 'A 1' })).toBe('INV-202610-A1'));
  it('clamps the due day to the month', () => {
    expect(invoiceDueDate('2026-02', 31)).toBe('2026-02-28');
    expect(invoiceDueDate('2026-10', undefined)).toBe('2026-10-05');
  });
});
