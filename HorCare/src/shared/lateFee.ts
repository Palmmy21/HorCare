// Automatic late fee for an unpaid bill. Pure: the daily cron (api/_late-fees.ts) turns the result into a fine.
import type { LateFeeConfig } from '../types/index.js';

function daysInMonth(y: number, m: number): number {
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Due date of a bill month ('YYYY-MM') as 'YYYY-MM-DD'; the due day is clamped to short months. */
export function dueDateOf(month: string, dueDay: number): string {
    const [y, m] = month.split('-').map(Number);
    const d = Math.min(Math.max(1, Math.floor(dueDay) || 5), daysInMonth(y, m));
    return `${month}-${String(d).padStart(2, '0')}`;
}

function dayNumber(isoDate: string): number {
    const [y, m, d] = isoDate.split('-').map(Number);
    return Date.UTC(y, m - 1, d) / 86_400_000;
}

/** Days the bill is late beyond the grace period (0 = not late yet). */
export function chargeableLateDays(dueDate: string, today: string, graceDays: number): number {
    return Math.max(0, dayNumber(today) - dayNumber(dueDate) - Math.max(0, Math.floor(graceDays) || 0));
}

export function isLateFeeActive(cfg: LateFeeConfig | null | undefined): cfg is LateFeeConfig {
    return !!cfg?.enabled && Number(cfg.amount) > 0;
}

/** Late fee owed today for a bill of `month`, in whole baht (0 when not late, or late fees are off). */
export function lateFeeAmount(cfg: LateFeeConfig | null | undefined, month: string, dueDay: number, today: string): number {
    if (!isLateFeeActive(cfg)) return 0;
    const days = chargeableLateDays(dueDateOf(month, dueDay), today, cfg.grace_days);
    if (days <= 0) return 0;
    const amount = Math.round(Number(cfg.amount));
    if (cfg.mode === 'flat') return amount;
    const total = amount * days;
    const cap = Number(cfg.max_amount) || 0;
    return cap > 0 ? Math.min(total, Math.round(cap)) : total;
}

/** Document id of the late-fee fine that belongs to a bill (one per bill, updated in place). */
export function lateFeeFineId(billId: string): string {
    return `late_${billId}`;
}
