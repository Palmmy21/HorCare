/**
 * Turns bills, fines and payments (Firestore) into the inputs of the posting rules (src/shared/accounting.ts).
 * Kept apart from api/_accounting.ts so the ledger can use it without loading the XLSX library.
 */
import { db } from './_firebase.js';
import { supabase, SupabaseNotConfigured } from './_supabase.js';
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

// ── daily / weekly collection charges (Supabase) ─────────────────────────────

export interface ChargeRow {
    id: string; kind: 'stay' | 'stall_week' | 'stall_day' | 'walk_in' | 'extra'; room_id: string | null; room_number: string | null;
    party_name: string; party_phone: string | null; period_start: string; amount_satang: number; status: 'open' | 'paid' | 'void'; created_at: string;
}
export interface ChargePaymentRow {
    id: string; charge_id: string; amount_satang: number; method: 'cash' | 'transfer'; kind: 'payment' | 'deposit' | 'refund';
    bank_account_id: string | null; verification: 'n/a' | 'unverified' | 'verified' | 'rejected'; received_at: string;
}

const CHARGE_CATEGORY: Record<ChargeRow['kind'], ReceivableDoc['lines'][number]['category']> = {
    stay: 'stay', stall_week: 'stall', stall_day: 'stall', walk_in: 'walk_in', extra: 'other_income',
};
const roomKey = (c: Pick<ChargeRow, 'id' | 'room_id'>) => c.room_id || `charge-${c.id}`;

export function chargeToDoc(c: ChargeRow, propertyCode?: string): ReceivableDoc {
    const doc: ReceivableDoc = {
        kind: 'charge', id: c.id, room_id: roomKey(c), room_number: c.room_number || c.party_name, period: c.period_start.slice(0, 7), issued_at: c.created_at,
        status: c.status === 'void' ? 'cancelled' : 'issued',
        lines: c.amount_satang > 0 ? [{ category: CHARGE_CATEGORY[c.kind], amount_satang: c.amount_satang }] : [],
        total_satang: c.amount_satang, revision: '', property_code: propertyCode, customer_name: c.party_name,
    };
    doc.revision = docRevision(doc);
    return doc;
}

/** Money in (payments and deposits) as payment records. Refunds are not receipts, and a voided charge's money nets to nothing. */
export function chargePaymentToRec(p: ChargePaymentRow, charge: ChargeRow): PaymentRec | null {
    if (p.kind === 'refund' || p.amount_satang <= 0 || charge.status === 'void') return null;
    const method: PaymentRec['method'] = p.method === 'cash' ? 'cash' : 'bank_transfer';
    const channel = channelOf(method, p.bank_account_id);
    return {
        id: p.id, room_id: roomKey(charge), channel, method, paid_at: p.received_at, gross_satang: p.amount_satang,
        verification: method === 'cash' ? 'n/a' : p.verification, status: 'active',
        allocations: [{ target_kind: 'charge', target_id: charge.id, amount_satang: p.amount_satang }],
        revision: `${p.amount_satang}|${p.received_at}|${channel}`,
    };
}

/** Charges are optional: a property without the Supabase module simply has none. */
export async function loadCharges(owner: string, bld: string, code?: string): Promise<{ docs: ReceivableDoc[]; payments: PaymentRec[] }> {
    try {
        const sb = supabase();
        const [c, p] = await Promise.all([
            sb.from('charges').select('*').eq('owner_uid', owner).eq('building_id', bld).limit(20000),
            sb.from('charge_payments').select('*').eq('owner_uid', owner).eq('building_id', bld).limit(50000),
        ]);
        if (c.error || p.error) return { docs: [], payments: [] };
        const charges = (c.data ?? []) as ChargeRow[];
        const byId = new Map(charges.map(x => [x.id, x]));
        const payments = ((p.data ?? []) as ChargePaymentRow[]).map(x => { const ch = byId.get(x.charge_id); return ch ? chargePaymentToRec(x, ch) : null; }).filter((x): x is PaymentRec => !!x);
        return { docs: charges.map(x => chargeToDoc(x, code)), payments };
    } catch (e) {
        if (e instanceof SupabaseNotConfigured) return { docs: [], payments: [] };
        throw e;
    }
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
    const col = await loadCharges(owner, bld, code);
    docs.push(...col.docs); payments.push(...col.payments);
    for (const d of docs) { const t = tenantOf.get(d.room_id); if (t) { d.customer_name = t.full_name; d.customer_tel = t.phone; } }
    return { docs, payments };
}

