/**
 * Turns bills, fines and payments (Firestore) into the inputs of the posting rules (src/shared/accounting.ts).
 * Kept apart from api/_accounting.ts so the ledger can use it without loading the XLSX library.
 */
import { db } from './_firebase.js';
import { channelOf, toSatang, type PaymentRec, type ReceivableDoc } from '../src/shared/accounting.js';
import type { Fine, MonthlyBill } from '../src/types/index.js';

const bldBase = (o: string, b: string) => `users/${o}/buildings/${b}`;
// ── building documents → accounting inputs ───────────────────────────────────

const lineSatang = (category: ReceivableDoc['lines'][number]['category'], baht: number | undefined) => ({ category, amount_satang: toSatang(baht ?? 0) });

export function docRevision(d: Pick<ReceivableDoc, 'room_id' | 'period' | 'total_satang' | 'lines'>): string {
    return `${d.room_id}|${d.period}|${d.total_satang}|${d.lines.map(l => `${l.category}=${l.amount_satang}`).join(',')}`;
}

export function billToDoc(b: MonthlyBill, propertyCode?: string): ReceivableDoc {
    const lines = [
        lineSatang('rent', b.room_rent), lineSatang('electric', b.elec_bill), lineSatang('water', b.water_bill), lineSatang('common_fee', b.common_fee),
    ].filter(l => l.amount_satang !== 0);
    const doc: ReceivableDoc = {
        kind: 'bill', id: b.id, room_id: b.room_id, room_number: b.room_number, period: b.month, issued_at: b.created_at,
        status: b.is_saved ? 'issued' : 'draft', lines, total_satang: toSatang(b.total_bill), revision: '', property_code: propertyCode,
    };
    doc.revision = docRevision(doc);
    return doc;
}

export function fineToDoc(f: Fine, propertyCode?: string): ReceivableDoc {
    const amount = toSatang(f.amount);
    const doc: ReceivableDoc = {
        kind: 'fine', id: f.id, room_id: f.room_id, room_number: f.room_number, period: (f.date || f.created_at).slice(0, 7),
        issued_at: f.created_at, status: 'issued', lines: [{ category: 'fine', amount_satang: amount }], total_satang: amount,
        revision: '', property_code: propertyCode,
    };
    doc.revision = docRevision(doc);
    return doc;
}

export type PaidItem = (MonthlyBill | Fine) & { allocated_satang?: number; payments_recorded?: boolean };

/** A payment recorded the old way (marked paid on the bill itself) seen as a one-allocation payment. */
export function legacyPayment(kind: 'bill' | 'fine', item: PaidItem): PaymentRec | null {
    const paid = kind === 'bill' ? (item as MonthlyBill).payment_status === 'paid' : (item as Fine).status === 'paid';
    if (!paid || item.payments_recorded) return null;
    const total = kind === 'bill' ? (item as MonthlyBill).total_bill : (item as Fine).amount;
    const gross = toSatang(item.paid_amount ?? total);
    const method: PaymentRec['method'] = item.payment_method
        ?? (item.paid_method === 'auto' || item.slip_image || item.slip_ref ? 'bank_transfer' : 'other');
    const paidAt = item.paid_at ?? item.slip_submitted_at ?? item.updated_at ?? item.created_at;
    const channel = channelOf(method, item.bank_account_id ?? item.slip_account_id);
    return {
        id: `legacy-${kind}-${item.id}`, room_id: item.room_id, channel, method, paid_at: paidAt, gross_satang: gross,
        verification: method === 'cash' ? 'n/a' : (item.verification_status ?? 'unverified'), status: 'active',
        allocations: [{ target_kind: kind, target_id: item.id, amount_satang: gross }],
        revision: `${gross}|${paidAt}|${channel}`,
    };
}

export async function loadBuilding(owner: string, bld: string, code?: string) {
    const base = bldBase(owner, bld);
    const [bills, fines, pays, tenants] = await Promise.all([
        db.collection(`${base}/bills`).get(), db.collection(`${base}/fines`).get(), db.collection(`${base}/payments`).get(), db.collection(`${base}/tenants`).get(),
    ]);
    const tenantOf = new Map(tenants.docs.map(t => [t.id, t.data() as { full_name?: string; phone?: string }]));
    const docs: ReceivableDoc[] = [];
    const payments: PaymentRec[] = [];
    for (const d of bills.docs) { const b = d.data() as PaidItem & MonthlyBill; docs.push(billToDoc(b, code)); const l = legacyPayment('bill', b); if (l) payments.push(l); }
    for (const d of fines.docs) { const f = d.data() as PaidItem & Fine; docs.push(fineToDoc(f, code)); const l = legacyPayment('fine', f); if (l) payments.push(l); }
    for (const d of pays.docs) payments.push(d.data() as PaymentRec);
    for (const d of docs) { const t = tenantOf.get(d.room_id); if (t) { d.customer_name = t.full_name; d.customer_tel = t.phone; } }
    return { docs, payments };
}

