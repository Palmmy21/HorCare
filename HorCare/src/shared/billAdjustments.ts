// Extra charges and discounts the owner adds to one bill by hand (ค่าซ่อม, ค่าทำความสะอาด, ส่วนลด …). Pure, shared by
// the app and the API. Convention: a bill's total_bill INCLUDES its adjustments; calculateFullBill returns the total
// without them, so every place that recalculates a bill adds adjustmentsTotal(bill) back (see useFirestore).
import type { BillAdjustment } from '../types/index.js';

export const MAX_ADJUSTMENTS = 20;
export const MAX_ADJUSTMENT_BAHT = 1_000_000;

/** Quick picks in the editor; amount sign: + charge, − discount. */
export const ADJUSTMENT_PRESETS: { label: string; sign: 1 | -1 }[] = [
    { label: 'ค่าซ่อมแซม', sign: 1 },
    { label: 'ค่าทำความสะอาด', sign: 1 },
    { label: 'ค่าปรับ', sign: 1 },
    { label: 'ค่าบริการอินเทอร์เน็ต', sign: 1 },
    { label: 'ค่าที่จอดรถ', sign: 1 },
    { label: 'ยอดค้างเดือนก่อน', sign: 1 },
    { label: 'ส่วนลด', sign: -1 },
];

export function adjustmentsTotal(bill: { adjustments?: BillAdjustment[] | null } | null | undefined): number {
    return (bill?.adjustments ?? []).reduce((sum, a) => sum + (Number(a.amount) || 0), 0);
}

/** The bill's total without its adjustments (what the meters, rent and fees come to). */
export function baseTotal(bill: { total_bill: number; adjustments?: BillAdjustment[] | null }): number {
    return (Number(bill.total_bill) || 0) - adjustmentsTotal(bill);
}

/**
 * Editor rows → clean adjustments, or a Thai message saying what to fix. Empty rows are dropped; amounts are whole
 * satang-safe baht (2 decimals); the bill may not go below zero.
 */
export function cleanAdjustments(
    rows: { id?: string; label: string; amount: number | string }[],
    base: number,
): { ok: true; adjustments: BillAdjustment[] } | { ok: false; error: string } {
    const out: BillAdjustment[] = [];
    for (const r of rows) {
        const label = (r.label ?? '').replace(/\s+/g, ' ').trim();
        const raw = typeof r.amount === 'string' ? r.amount.replace(/[,฿\s]/g, '') : r.amount;
        const amount = Math.round(Number(raw) * 100) / 100;
        if (!label && (raw === '' || amount === 0)) continue; // a blank row
        if (!label) return { ok: false, error: 'ใส่ชื่อรายการให้ครบทุกแถว' };
        if (label.length > 60) return { ok: false, error: `ชื่อรายการ "${label.slice(0, 20)}…" ยาวเกินไป` };
        if (!Number.isFinite(amount) || amount === 0) return { ok: false, error: `ใส่จำนวนเงินของ "${label}"` };
        if (Math.abs(amount) > MAX_ADJUSTMENT_BAHT) return { ok: false, error: `จำนวนเงินของ "${label}" มากเกินไป` };
        out.push({ id: r.id || `adj_${Date.now().toString(36)}${out.length}`, label, amount });
    }
    if (out.length > MAX_ADJUSTMENTS) return { ok: false, error: `เพิ่มได้สูงสุด ${MAX_ADJUSTMENTS} รายการต่อบิล` };
    const total = base + out.reduce((s, a) => s + a.amount, 0);
    if (total < 0) return { ok: false, error: 'ส่วนลดมากกว่ายอดบิล' };
    return { ok: true, adjustments: out };
}
