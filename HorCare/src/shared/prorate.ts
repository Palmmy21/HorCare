// Rent for a month the tenant only partly lived in (moved in or out mid-month). Pure.
import type { RentProrate } from '../types/index.js';

export interface Stay {
    /** move-in date 'YYYY-MM-DD' */
    from?: string | null;
    /** move-out date 'YYYY-MM-DD' (the last night stayed) */
    to?: string | null;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Prorated rent for `month` ('YYYY-MM'), counting days stayed inclusively. Returns null when the full month is billed:
 * no dates, dates outside this month, or a stay that covers it. A move-in after the move-out, or a stay that does
 * not touch the month, is ignored (full rent) rather than billing zero by mistake.
 */
export function prorateRent(fullRent: number, month: string, stay: Stay | null | undefined): RentProrate | null {
    if (!stay || !(fullRent > 0)) return null;
    const [y, m] = month.split('-').map(Number);
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const first = `${month}-01`;
    const last = `${month}-${String(dim).padStart(2, '0')}`;

    const from = stay.from && ISO.test(stay.from) && stay.from > first && stay.from <= last ? stay.from : first;
    const to = stay.to && ISO.test(stay.to) && stay.to >= first && stay.to < last ? stay.to : last;
    if (from === first && to === last) return null;
    if (from > to) return null;

    const days = Number(to.slice(8)) - Number(from.slice(8)) + 1;
    return { days, days_in_month: dim, full_rent: fullRent, from, to };
}

/** Rent to bill: the prorated amount (rounded to whole baht) when it applies, otherwise the full rent. */
export function proratedAmount(fullRent: number, p: RentProrate | null): number {
    return p ? Math.round((fullRent * p.days) / p.days_in_month) : fullRent;
}
