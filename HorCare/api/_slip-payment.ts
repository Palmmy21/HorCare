/**
 * Records money from a slip as a payment + allocation on a bill / fine — the same shape as
 * /api/accounting record_payment — so a bill can be paid in parts. Used when a tenant chooses to
 * split a payment, and for any slip on a bill that already has part payments.
 *
 * Idempotent per slip: the payment id comes from the slip fingerprint, so pressing the button twice
 * (or a LINE redelivery) never deducts twice.
 */
import { db, admin } from './_firebase.js';
import { billToDoc, fineToDoc, legacyPayment, type PaidItem } from './_accounting-data.js';
import { channelOf, type PaymentRec } from '../src/shared/accounting.js';
import type { Fine, MonthlyBill } from '../src/types/index.js';

const FieldValue = admin.firestore.FieldValue;

export class SlipPaymentError extends Error {
    constructor(public code: 'not_found' | 'already_paid' | 'exceeds_outstanding' | 'not_issued') { super(code); }
}

export interface SlipPaymentResult {
    /** true when this slip had already been recorded — nothing changed. */
    duplicate: boolean;
    paid_satang: number;
    total_satang: number;
    outstanding_satang: number;
    fully_paid: boolean;
}

/** What is still owed on a bill / fine, in satang. */
export function outstandingSatang(kind: 'bill' | 'fine', item: PaidItem): number {
    const total = kind === 'bill' ? billToDoc(item as MonthlyBill).total_satang : fineToDoc(item as Fine).total_satang;
    if (legacyPayment(kind, item)) return 0;
    return Math.max(0, total - (item.allocated_satang ?? 0));
}

export async function recordSlipPayment(input: {
    ownerUid: string;
    buildingId: string;
    kind: 'bill' | 'fine';
    itemId: string;
    amountSatang: number;
    bankAccountId: string;
    /** Slip fingerprint (as stored in slip_ref); makes the payment id. */
    slipRef: string;
    paidAt: string;
    transactionRef?: string | null;
    note: string;
}): Promise<SlipPaymentResult> {
    const base = `users/${input.ownerUid}/buildings/${input.buildingId}`;
    const itemRef = db.doc(`${base}/${input.kind === 'bill' ? 'bills' : 'fines'}/${input.itemId}`);
    const paymentId = `slip-${input.slipRef}`;
    const payRef = db.doc(`${base}/payments/${paymentId}`);
    const accSnap = await db.doc(`${base}/bank_accounts/${input.bankAccountId}`).get();
    const bankName = accSnap.exists ? ((accSnap.data() as { bank_short?: string }).bank_short ?? null) : null;

    return db.runTransaction(async tx => {
        const [itemSnap, paySnap] = await Promise.all([tx.get(itemRef), tx.get(payRef)]);
        if (!itemSnap.exists) throw new SlipPaymentError('not_found');
        const item = itemSnap.data() as PaidItem;
        const doc = input.kind === 'bill' ? billToDoc(item as MonthlyBill) : fineToDoc(item as Fine);
        const already = item.allocated_satang ?? 0;
        if (paySnap.exists) {
            const left = Math.max(0, doc.total_satang - already);
            return { duplicate: true, paid_satang: (paySnap.data() as PaymentRec).gross_satang, total_satang: doc.total_satang, outstanding_satang: left, fully_paid: left === 0 };
        }
        if (doc.status !== 'issued') throw new SlipPaymentError('not_issued');
        if (legacyPayment(input.kind, item)) throw new SlipPaymentError('already_paid');
        if (input.amountSatang <= 0 || input.amountSatang > doc.total_satang - already) throw new SlipPaymentError('exceeds_outstanding');

        const now = new Date().toISOString();
        const allocated = already + input.amountSatang;
        const fully = allocated >= doc.total_satang;
        const statusField = input.kind === 'bill' ? 'payment_status' : 'status';
        const data: Record<string, unknown> = {
            allocated_satang: allocated, payments_recorded: true, updated_at: now,
            // a part payment leaves the rest owed; the slip that was "pending" is settled by this payment
            [statusField]: fully ? 'paid' : 'unpaid',
        };
        if (fully) {
            Object.assign(data, {
                paid_at: input.paidAt, paid_method: 'auto', payment_method: 'bank_transfer', paid_amount: doc.total_satang / 100,
                bank_account_id: input.bankAccountId, bank_account: bankName, verification_status: 'unverified',
            });
        }
        const payment: PaymentRec & Record<string, unknown> = {
            id: paymentId, room_id: item.room_id, channel: channelOf('bank_transfer', input.bankAccountId), method: 'bank_transfer',
            paid_at: input.paidAt, gross_satang: input.amountSatang, verification: 'unverified', status: 'active',
            allocations: [{ target_kind: input.kind, target_id: input.itemId, amount_satang: input.amountSatang }],
            revision: '', bank_account_id: input.bankAccountId, transaction_ref: input.transactionRef ?? null,
            room_number: String(item.room_number ?? ''), note: input.note, created_at: now, created_by: 'tenant-slip', received_by: 'สลิปผู้เช่า',
        };
        payment.revision = `${payment.gross_satang}|${payment.paid_at}|${payment.channel}|${input.kind}:${input.itemId}=${input.amountSatang}`;
        tx.set(payRef, payment);
        tx.update(itemRef, data);
        return { duplicate: false, paid_satang: input.amountSatang, total_satang: doc.total_satang, outstanding_satang: doc.total_satang - allocated, fully_paid: fully };
    });
}

export type SlipSplitResult =
    | { status: 'ok'; paid: number; total: number; outstanding: number; item: PaidItem }
    | { status: 'not_found' | 'stale' | 'refused' };

/**
 * The tenant chose "split payment" for the slip they just sent: record that slip's amount as a part
 * payment. Only the slip the offer was made for counts — same fingerprint still on the item, the
 * AI-read amount and the matched receiving account (all written by evaluateSlip). Pressing twice is safe.
 */
export async function applySlipSplit(input: {
    ownerUid: string; buildingId: string; kind: 'bill' | 'fine'; itemId: string; roomId: string; slipRef: string;
}): Promise<SlipSplitResult> {
    const base = `users/${input.ownerUid}/buildings/${input.buildingId}`;
    const itemRef = db.doc(`${base}/${input.kind === 'bill' ? 'bills' : 'fines'}/${input.itemId}`);
    const item = (await itemRef.get()).data() as (PaidItem & Record<string, unknown>) | undefined;
    if (!item || item.room_id !== input.roomId) return { status: 'not_found' };

    const paymentId = `slip-${input.slipRef}`;
    const existing = await db.doc(`${base}/payments/${paymentId}`).get();
    let paidSatang: number;
    if (existing.exists) {
        paidSatang = (existing.data() as PaymentRec).gross_satang;
    } else {
        const amount = Number(item.slip_split_amount);
        const account = item.slip_account_id;
        if (item.slip_ref !== input.slipRef || !(amount > 0) || typeof account !== 'string') return { status: 'stale' };
        try {
            const r = await recordSlipPayment({
                ownerUid: input.ownerUid, buildingId: input.buildingId, kind: input.kind, itemId: input.itemId,
                amountSatang: Math.round(amount * 100), bankAccountId: account, slipRef: input.slipRef,
                paidAt: typeof item.slip_datetime === 'string' ? item.slip_datetime : new Date().toISOString(),
                transactionRef: typeof item.transaction_ref === 'string' ? item.transaction_ref : null,
                note: 'แบ่งจ่ายจากสลิป (ผู้เช่ากดเลือก)',
            });
            paidSatang = r.paid_satang;
        } catch (e) {
            if (e instanceof SlipPaymentError) return { status: 'refused' };
            throw e;
        }
        await itemRef.update({
            slip_split_amount: FieldValue.delete(),
            verify_note: `แบ่งจ่าย ฿${amount.toLocaleString()} จากสลิป (ผู้เช่ากดเลือก, ยังไม่ยืนยันกับบัญชีธนาคาร)`,
        });
        // keep this part's slip image: the next slip replaces slip_images/<item id>
        const img = await db.doc(`${base}/slip_images/${input.itemId}`).get();
        if (img.exists) await db.doc(`${base}/slip_images/payment-${paymentId}`).set({ ...img.data(), payment_id: paymentId });
    }

    const after = (await itemRef.get()).data() as PaidItem;
    const total = input.kind === 'bill' ? billToDoc(after as MonthlyBill).total_satang : fineToDoc(after as Fine).total_satang;
    return { status: 'ok', paid: paidSatang / 100, total: total / 100, outstanding: outstandingSatang(input.kind, after) / 100, item: after };
}
