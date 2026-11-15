// When a bill is due, and the note at the foot of the bill that says so. Pure: the invoice, the LINE card, the
// reminders, the late fee and the overdue count all read the due date from here.
//
// The due day (e.g. the 5th) is the latest day to pay, counted from the day the bill was issued: a bill issued on or
// before the 5th is due on the 5th of that month, one issued after it is due on the 5th of the next month.

export type DueNoteMode = 'auto' | 'fixed' | 'manual';

/** The property's settings (bill_customization). */
export interface DueSettings {
    due_day?: number;
    /** auto = date worked out per bill; fixed = one date the owner set; manual = the owner's own text. */
    due_note_mode?: DueNoteMode;
    /** 'YYYY-MM-DD', for mode 'fixed'. Bills issued after it fall back to the automatic date. */
    due_fixed_date?: string;
    footer_text?: string;
}

/** One room's own terms; empty = the property's. */
export interface DueRoom {
    due_day?: number | null;
    bill_footer?: string | null;
}

export interface DueBill {
    month?: string;
    created_at?: string;
    /** A due date set on this bill by hand. */
    due_date?: string | null;
}

export const DEFAULT_DUE_DAY = 5;
/** Written in a note where the due date should appear. */
export const DUE_TOKEN = '{วันครบกำหนด}';
const DUE_TOKENS = /\{\s*(วันครบกำหนด|due_date)\s*\}/gi;

const pad = (n: number) => String(n).padStart(2, '0');
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function isIsoDay(s: unknown): s is string {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

export function validDueDay(n: unknown): number | null {
    const d = Math.floor(Number(n));
    return Number.isFinite(d) && d >= 1 && d <= 31 ? d : null;
}

/** The Thai calendar day of a timestamp ('' when it is not one). */
export function thaiDayOf(iso: string | undefined | null): string {
    const t = iso ? Date.parse(iso) : NaN;
    return Number.isNaN(t) ? '' : new Date(t + 7 * 3600_000).toISOString().slice(0, 10);
}

/** The first `dueDay` on or after `issuedOn` (clamped to short months). */
export function autoDueDate(issuedOn: string, dueDay: number): string {
    const [y, m, d] = issuedOn.split('-').map(Number);
    const day = validDueDay(dueDay) ?? DEFAULT_DUE_DAY;
    const inMonth = Math.min(day, daysInMonth(y, m));
    if (d <= inMonth) return `${y}-${pad(m)}-${pad(inMonth)}`;
    const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
    return `${ny}-${pad(nm)}-${pad(Math.min(day, daysInMonth(ny, nm)))}`;
}

/** The day the bill counts as issued: when it was created, but never before its own month starts (bills made ahead). */
export function billIssuedOn(bill: DueBill): string {
    const monthStart = /^\d{4}-\d{2}$/.test(bill.month ?? '') ? `${bill.month}-01` : '';
    const created = thaiDayOf(bill.created_at);
    return created > monthStart ? created : monthStart || created;
}

/**
 * The bill's due date: the one set on the bill by hand, else the room's own due day, else the property's fixed date
 * (while the bill was issued by then), else the property's due day — each counted from the day the bill was issued.
 */
export function resolveDueDate(bill: DueBill, settings?: DueSettings | null, room?: DueRoom | null): string {
    if (isIsoDay(bill.due_date)) return bill.due_date;
    const issued = billIssuedOn(bill);
    if (!issued) return '';
    const roomDay = validDueDay(room?.due_day);
    if (roomDay) return autoDueDate(issued, roomDay);
    if (settings?.due_note_mode === 'fixed' && isIsoDay(settings.due_fixed_date) && settings.due_fixed_date >= issued) {
        return settings.due_fixed_date;
    }
    return autoDueDate(issued, validDueDay(settings?.due_day) ?? DEFAULT_DUE_DAY);
}

/** Notes the app itself wrote as a default: they name no real date, so the automatic note replaces them. */
const STOCK_NOTE = /^กรุณาชำระภายในวันที่\s*(\d{1,2}\s*ของทุกเดือน|กำหนด\s*ขอบคุณ(ครับ|ค่ะ)?)$/;

/** The mode in force; settings saved before modes existed keep a note the owner wrote and drop a stock one. */
export function dueNoteMode(settings?: DueSettings | null): DueNoteMode {
    if (settings?.due_note_mode) return settings.due_note_mode;
    const text = (settings?.footer_text ?? '').trim();
    return !text || STOCK_NOTE.test(text) ? 'auto' : 'manual';
}

/**
 * The owner's wording for the note, or '' when the standard sentence with the due date applies: the room's own note
 * first, then the property's text in manual mode.
 */
export function dueNoteTemplate(settings?: DueSettings | null, room?: DueRoom | null): string {
    const own = (room?.bill_footer ?? '').trim();
    if (own) return own;
    return dueNoteMode(settings) === 'manual' ? (settings?.footer_text ?? '').trim() : '';
}

/** Puts the due date where the note asks for it. */
export function fillDueNote(template: string, dateText: string): string {
    return template.replace(DUE_TOKENS, dateText);
}
