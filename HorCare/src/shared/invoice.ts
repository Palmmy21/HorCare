/**
 * A monthly bill as invoice lines (ใบแจ้งหนี้): what the tenant is charged for, in the order the bill was built, with
 * the meter readings and rate behind each utility line. The lines add up to the bill's total.
 */
import type { MonthlyBill } from '../types';

export interface InvoiceLine {
  /** what the line is, so a document can word it in the tenant's language; fees and adjustments keep the owner's name */
  kind: 'rent' | 'elec' | 'water' | 'water_flat' | 'water_excess' | 'fee' | 'adjustment';
  label: string;
  /** meter readings behind a utility line */
  from?: number;
  to?: number;
  /** prorated rent: billed days of the month's days */
  days?: number;
  of?: number;
  /** e.g. meter readings, a prorate note */
  detail?: string;
  qty?: number;
  unit?: string;
  rate?: number;
  amount: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function invoiceLines(bill: MonthlyBill): InvoiceLine[] {
  const lines: InvoiceLine[] = [];
  const prorate = bill.rent_prorate;
  lines.push({
    kind: 'rent',
    label: 'ค่าเช่า',
    ...(prorate?.days && prorate.days_in_month ? { days: prorate.days, of: prorate.days_in_month } : {}),
    detail: prorate?.days && prorate.days_in_month ? `คิดตามจริง ${prorate.days} จาก ${prorate.days_in_month} วัน` : undefined,
    amount: Number(bill.room_rent) || 0,
  });
  if (!bill.rent_only) {
    const units = Number(bill.elec_units) || 0;
    lines.push({
      kind: 'elec', from: bill.prev_elec ?? 0, to: bill.curr_elec ?? 0,
      label: 'ค่าไฟฟ้า',
      detail: `มิเตอร์ ${bill.prev_elec ?? 0} → ${bill.curr_elec ?? 0}`,
      qty: units, unit: 'หน่วย',
      rate: units ? round2((Number(bill.elec_bill) || 0) / units) : undefined,
      amount: Number(bill.elec_bill) || 0,
    });
    if (bill.water_flat_amount) {
      lines.push({ kind: 'water_flat', label: 'ค่าน้ำประปา (เหมาจ่าย)', amount: Number(bill.water_flat_amount) || 0 });
    } else {
      const units = Number(bill.water_units) || 0;
      lines.push({
        kind: 'water', from: bill.prev_water ?? 0, to: bill.curr_water ?? 0,
        label: 'ค่าน้ำประปา',
        detail: `มิเตอร์ ${bill.prev_water ?? 0} → ${bill.curr_water ?? 0}`,
        qty: units, unit: 'หน่วย',
        rate: units ? round2((Number(bill.water_bill) || 0) / units) : undefined,
        amount: Number(bill.water_bill) || 0,
      });
    }
  }
  if (bill.water_excess_amount) {
    const units = Number(bill.water_excess_units) || 0;
    lines.push({
      kind: 'water_excess',
      label: 'ค่าน้ำส่วนเกิน', qty: units || undefined, unit: units ? 'หน่วย' : undefined,
      rate: units ? round2(Number(bill.water_excess_amount) / units) : undefined,
      amount: Number(bill.water_excess_amount) || 0,
    });
  }
  for (const f of bill.applied_common_fees ?? []) if (f.amount > 0) lines.push({ kind: 'fee', label: f.name, amount: f.amount });
  for (const a of bill.adjustments ?? []) if (a.amount) lines.push({ kind: 'adjustment', label: a.label, amount: a.amount });
  return lines;
}

/** INV-202610-101 — stable for the bill, so a reprint carries the same number. */
export function invoiceNumber(bill: Pick<MonthlyBill, 'month' | 'room_number'>): string {
  return `INV-${bill.month.replace('-', '')}-${String(bill.room_number ?? '').replace(/\s+/g, '')}`;
}

/** Due on `dueDay` of the bill's month, clamped to the month's last day (as the reminders count it). */
export function invoiceDueDate(month: string, dueDay: number | undefined): string {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const day = Math.min(Math.max(1, Math.floor(dueDay || 5)), last);
  return `${month}-${String(day).padStart(2, '0')}`;
}
