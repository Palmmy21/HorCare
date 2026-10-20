/**
 * R1 migration — mapping legacy Firestore records to the core schema (supabase/migrations/20261020000000_core_billing.sql).
 *
 * Pure functions only: no database access, so a dry run, the real run and the tests all use the same mapping.
 * What cannot be converted without guessing is returned as an `issue` for a person to resolve (Migration §12.3);
 * nothing here invents history. See docs/MIGRATION_R1.md for the run procedure.
 */
import type { MonthlyBill } from '../src/types/index.js';

export interface MigrationIssue {
    entity: 'bill' | 'tenant' | 'payment';
    legacy_ref: string;
    problem: string;
    details?: Record<string, unknown>;
}

export interface InvoiceRow {
    owner_uid: string; building_id: string; room_id: string; room_number: string; period: string;
    status: 'draft' | 'issued'; dedupe_key: string; legacy_ref: string;
    issue_date: string | null; snapshot: Record<string, unknown>; created_by: string;
}
export interface InvoiceLineRow {
    kind: 'rent' | 'electricity' | 'water' | 'common_fee' | 'adjustment';
    description: string; quantity: number | null; amount_satang: number; sort: number;
}
export interface PaymentRow {
    owner_uid: string; building_id: string; method: 'cash' | 'transfer' | 'gateway' | 'other';
    amount_satang: number; received_on: string; reference: string | null; bank_account_id: string | null;
    status: 'pending_verification' | 'confirmed'; received_by: string; legacy_ref: string;
    /** how much of it goes to this bill; any rest stays unallocated (credit) */
    allocate_satang: number;
}

export interface MappedBill {
    invoice: InvoiceRow | null;
    lines: InvoiceLineRow[];
    payment: PaymentRow | null;
    issues: MigrationIssue[];
}

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const BANGKOK_OFFSET_MS = 7 * 3600_000;

/** Baht (possibly fractional) → integer satang, rounding half away from zero. null when not a finite number. */
export function bahtToSatang(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    // the EPSILON nudge keeps 0.285 * 100 = 28.499999… from rounding down
    const s = Math.round(Math.abs(value) * 100 + Number.EPSILON * 100);
    return value < 0 ? -s : s;
}

/** The Thai calendar day of an instant (business days are Asia/Bangkok, DATA-05). */
export function bangkokDate(iso: string | undefined | null): string | null {
    if (!iso) return null;
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) return null;
    return new Date(ms + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
}

const METHOD: Record<string, PaymentRow['method']> = { cash: 'cash', bank_transfer: 'transfer', qr_gateway: 'gateway', other: 'other' };

/**
 * One legacy bill → an invoice with itemised lines (+ the payment recorded on the bill itself, if any).
 * - A saved bill was shown to the tenant, so it becomes `issued` with its original total; unsaved bills become drafts.
 * - Lines come from the bill's own components. If they do not add up to the total the tenant saw, an `adjustment`
 *   line keeps the issued total and an issue is raised so the difference is looked at, not hidden.
 * - Bills whose payments live in the `payments` collection (`payments_recorded`) are left to that collection's mapping.
 */
export function mapLegacyBill(bill: MonthlyBill & { payments_recorded?: boolean; payment_date?: string }, ctx: { ownerUid: string; buildingId: string; by: string }): MappedBill {
    const ref = `firestore:users/${ctx.ownerUid}/buildings/${ctx.buildingId}/bills/${bill.id}`;
    const issues: MigrationIssue[] = [];
    const issue = (problem: string, details?: Record<string, unknown>) => issues.push({ entity: 'bill', legacy_ref: ref, problem, details });

    if (!bill.room_id || !PERIOD_RE.test(bill.month ?? '')) {
        issue('missing_room_or_period', { room_id: bill.room_id ?? null, month: bill.month ?? null });
        return { invoice: null, lines: [], payment: null, issues };
    }
    const total = bahtToSatang(bill.total_bill);
    if (total === null || total < 0) {
        issue('invalid_total', { total_bill: bill.total_bill ?? null });
        return { invoice: null, lines: [], payment: null, issues };
    }

    const lines: InvoiceLineRow[] = [];
    const add = (kind: InvoiceLineRow['kind'], description: string, baht: unknown, quantity: number | null = null) => {
        const s = bahtToSatang(baht);
        if (s === null || s === 0) return;
        lines.push({ kind, description, quantity, amount_satang: s, sort: lines.length });
    };
    add('rent', 'ค่าเช่า', bill.room_rent);
    add('electricity', `ค่าไฟ ${bill.prev_elec ?? '-'} → ${bill.curr_elec ?? '-'}`, bill.elec_bill, bill.elec_units ?? null);
    add('water', `ค่าน้ำ ${bill.prev_water ?? '-'} → ${bill.curr_water ?? '-'}`, bill.water_bill, bill.water_units ?? null);
    if (bill.applied_common_fees?.length) for (const f of bill.applied_common_fees) add('common_fee', f.name || 'ค่าส่วนกลาง', f.amount);
    else add('common_fee', 'ค่าส่วนกลาง', bill.common_fee);

    const sum = lines.reduce((s, l) => s + l.amount_satang, 0);
    if (sum !== total) {
        lines.push({ kind: 'adjustment', description: 'ปรับให้ตรงยอดในบิลเดิม', quantity: null, amount_satang: total - sum, sort: lines.length });
        issue('total_mismatch', { lines_satang: sum, total_satang: total });
    }

    const status: InvoiceRow['status'] = bill.is_saved ? 'issued' : 'draft';
    const invoice: InvoiceRow = {
        owner_uid: ctx.ownerUid, building_id: ctx.buildingId, room_id: bill.room_id, room_number: bill.room_number ?? bill.room_id,
        period: bill.month, status, dedupe_key: `regular:${bill.room_id}:${bill.month}`, legacy_ref: ref,
        issue_date: status === 'issued' ? bangkokDate(bill.created_at) : null,
        // what the tenant saw, kept as issued (DATA-04)
        snapshot: {
            source: 'firestore', room_number: bill.room_number, tenant_count: bill.tenant_count ?? null,
            readings: { prev_elec: bill.prev_elec, curr_elec: bill.curr_elec, prev_water: bill.prev_water, curr_water: bill.curr_water },
            total_baht: bill.total_bill, locked: !!bill.is_locked,
        },
        created_by: ctx.by,
    };

    let payment: PaymentRow | null = null;
    const ps = bill.payment_status ?? 'unpaid';
    if ((ps === 'paid' || ps === 'pending') && !bill.payments_recorded) {
        let method = METHOD[bill.payment_method ?? ''] ?? (bill.slip_image || bill.slip_ref ? 'transfer' : 'other');
        if (method === 'transfer' && !bill.bank_account_id) {
            // the core schema requires the receiving account for transfers; keep the money, flag the gap
            method = 'other';
            issue('transfer_without_account');
        }
        const amount = bahtToSatang(bill.paid_amount ?? bill.slip_amount ?? bill.total_bill) ?? total;
        const receivedOn = bangkokDate(bill.paid_at) ?? bangkokDate(bill.slip_submitted_at) ?? bill.payment_date ?? null;
        if (!receivedOn) issue('payment_without_date');
        if (amount <= 0) {
            issue('payment_without_amount');
        } else {
            payment = {
                owner_uid: ctx.ownerUid, building_id: ctx.buildingId, method, amount_satang: amount,
                received_on: receivedOn ?? bangkokDate(bill.updated_at) ?? `${bill.month}-01`,
                reference: bill.transaction_ref || bill.slip_ref || null, bank_account_id: method === 'transfer' ? bill.bank_account_id ?? null : null,
                // a bill the owner marked paid was accepted then; a slip still waiting stays waiting (PAY-01)
                status: ps === 'paid' ? 'confirmed' : 'pending_verification',
                received_by: bill.received_by || 'legacy', legacy_ref: `${ref}#payment`,
                allocate_satang: ps === 'paid' ? Math.min(amount, total) : 0,
            };
            if (ps === 'paid' && amount !== total) issue(amount < total ? 'paid_less_than_total' : 'paid_more_than_total', { amount_satang: amount, total_satang: total });
        }
    }
    if (status === 'draft' && payment) issue('payment_on_unsaved_bill');

    return { invoice, lines, payment, issues };
}
