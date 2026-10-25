/**
 * /api/accounting — recording payments that need allocations (partial / several bills), and confirming a
 * recorded transfer against a real bank transaction. Both post to HorCare's own books (api/_ledger-auto.ts).
 *
 * (The Mango export that used to live here was removed: the books are HorCare's own ledger.)
 *
 * Actions: record_payment | verify_payment
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import { db } from './_firebase.js';
import { authorize, buildingExists } from './_rbac.js';
import { writeAudit } from './_audit.js';
import { billToDoc, fineToDoc, legacyPayment, type PaidItem } from './_accounting-data.js';

// the data helpers live in _accounting-data.ts; re-exported for existing importers
export { billToDoc, fineToDoc, legacyPayment, loadBuilding, docRevision } from './_accounting-data.js';
import { channelOf, thDate, toSatang, type PaymentRec } from '../src/shared/accounting.js';
import type { Fine, MonthlyBill } from '../src/types/index.js';
import type { Permission } from '../src/shared/permissions.js';
import { autoPostSafe } from './_ledger-auto.js';

export const config = { maxDuration: 60 };

type Action = 'record_payment' | 'verify_payment';
const ACTIONS: Action[] = ['record_payment', 'verify_payment'];

interface Body {
    action?: Action;
    owner_uid?: string;
    building_id?: string;
    note?: unknown;
    room_id?: string;
    method?: string;
    bank_account_id?: string;
    paid_at?: string;
    allocations?: { kind?: string; id?: string; amount?: number }[];
    transaction_ref?: unknown;
    payment_id?: string;
    bank_transaction_id?: string;
}

class HttpError extends Error {
    constructor(public status: number, public code: string, public detail?: unknown) { super(code); }
}

const MAX_MONEY_BAHT = 10_000_000;
const bldBase = (o: string, b: string) => `users/${o}/buildings/${b}`;

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim().length <= max ? v.trim() : null);
const optStr = (v: unknown, max: number): string | null | undefined => (v === undefined || v === null || v === '' ? null : str(v, max) ?? undefined);

// ── handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const body = (req.body ?? {}) as Body;
    const action = body.action;
    if (!action || !ACTIONS.includes(action)) { res.status(400).json({ error: 'unknown_action' }); return; }
    if (typeof body.owner_uid !== 'string' || !body.owner_uid) { res.status(400).json({ error: 'invalid_input' }); return; }
    if (typeof body.building_id !== 'string' || !body.building_id) { res.status(400).json({ error: 'invalid_input' }); return; }
    const owner = body.owner_uid;
    const properties = [body.building_id];

    const permission: Permission = action === 'record_payment' ? 'payment.create' : 'payment.reconcile';
    const ctx = await authorize(req, res, { ownerUid: owner, buildingId: body.building_id, permission });
    if (!ctx) return;
    const who = ctx; // non-null for the nested handlers below
    if (!(await buildingExists(owner, body.building_id))) { res.status(404).json({ error: 'property_not_found' }); return; }
    const audit = (act: 'CREATE' | 'UPDATE', type: 'payment', id: string, label: string, extra: object = {}) =>
        writeAudit({
            ownerUid: owner, propertyId: properties[0], userId: who.uid, userName: who.displayName, role: who.role,
            action: act, resourceType: type, resourceId: id, resourceLabel: label, req, ...extra,
        });

    try {
        if (action === 'record_payment') return await recordPayment();
        return await verifyPayment();
    } catch (e) {
        if (e instanceof HttpError) { res.status(e.status).json({ error: e.code, ...(e.detail ? { detail: e.detail } : {}) }); return; }
        throw e;
    }

    // ── record_payment ───────────────────────────────────────────────────────
    async function recordPayment() {
        const bld = properties[0];
        const base = bldBase(owner, bld);
        const method = body.method;
        if (method !== 'cash' && method !== 'bank_transfer' && method !== 'qr_gateway' && method !== 'other') throw new HttpError(400, 'invalid_input');
        if (typeof body.room_id !== 'string' || !body.room_id) throw new HttpError(400, 'invalid_input');
        const paidAt = typeof body.paid_at === 'string' ? new Date(body.paid_at) : null;
        if (!paidAt || Number.isNaN(paidAt.getTime()) || paidAt.getTime() > Date.now() + 5 * 60_000) throw new HttpError(400, 'invalid_input');
        const allocs = body.allocations;
        if (!Array.isArray(allocs) || allocs.length === 0 || allocs.length > 50) throw new HttpError(400, 'invalid_input');
        const cleaned = allocs.map(a => ({
            kind: a.kind, id: a.id, satang: typeof a.amount === 'number' && a.amount > 0 && a.amount <= MAX_MONEY_BAHT ? toSatang(a.amount) : NaN,
        }));
        if (cleaned.some(a => (a.kind !== 'bill' && a.kind !== 'fine') || typeof a.id !== 'string' || !a.id || !Number.isInteger(a.satang) || a.satang <= 0)) throw new HttpError(400, 'invalid_input');
        if (new Set(cleaned.map(a => `${a.kind}:${a.id}`)).size !== cleaned.length) throw new HttpError(400, 'invalid_input');
        const note = optStr(body.note, 200); const ref = optStr(body.transaction_ref, 80);
        if (note === undefined || ref === undefined) throw new HttpError(400, 'invalid_input');

        let bankName: string | null = null;
        if (method === 'bank_transfer') {
            if (typeof body.bank_account_id !== 'string' || !body.bank_account_id) throw new HttpError(400, 'bank_account_required');
            const acc = await db.doc(`${base}/bank_accounts/${body.bank_account_id}`).get();
            if (!acc.exists || (acc.data() as { status?: string }).status !== 'active') throw new HttpError(400, 'bank_account_invalid');
            bankName = (acc.data() as { bank_short?: string }).bank_short ?? null;
        }
        const roomSnap = await db.doc(`${base}/rooms/${body.room_id}`).get();
        if (!roomSnap.exists) throw new HttpError(404, 'room_not_found');

        const paymentId = randomUUID();
        const now = new Date().toISOString();
        const gross = cleaned.reduce((s, a) => s + a.satang, 0);
        const result = await db.runTransaction(async tx => {
            const refs = cleaned.map(a => db.doc(`${base}/${a.kind === 'bill' ? 'bills' : 'fines'}/${a.id}`));
            const snaps = await Promise.all(refs.map(r => tx.get(r)));
            const updates: { ref: (typeof refs)[number]; data: Record<string, unknown> }[] = [];
            snaps.forEach((s, i) => {
                const a = cleaned[i];
                if (!s.exists) throw new HttpError(404, 'target_not_found');
                const item = s.data() as PaidItem;
                if (item.room_id !== body.room_id) throw new HttpError(400, 'target_wrong_room');
                const doc = a.kind === 'bill' ? billToDoc(item as MonthlyBill) : fineToDoc(item as Fine);
                if (doc.status !== 'issued') throw new HttpError(409, 'target_not_issued');
                const legacyPaid = !!legacyPayment(a.kind as 'bill' | 'fine', item);
                const already = legacyPaid ? doc.total_satang : (item.allocated_satang ?? 0);
                if (a.satang > doc.total_satang - already) throw new HttpError(409, 'exceeds_outstanding', { id: a.id, outstanding_satang: doc.total_satang - already });
                const nowAllocated = already + a.satang;
                const data: Record<string, unknown> = { allocated_satang: nowAllocated, payments_recorded: true, updated_at: now };
                if (nowAllocated >= doc.total_satang) {
                    // fully paid: keep the fields the rest of the app reads in step
                    Object.assign(data, {
                        paid_at: paidAt.toISOString(), paid_method: 'manual', payment_method: method, paid_amount: doc.total_satang / 100,
                        ...(a.kind === 'bill' ? { payment_status: 'paid' } : { status: 'paid' }),
                        ...(method === 'bank_transfer' ? { bank_account_id: body.bank_account_id, bank_account: bankName, verification_status: 'unverified' } : {}),
                    });
                }
                updates.push({ ref: refs[i], data });
            });
            const payment: PaymentRec & Record<string, unknown> = {
                id: paymentId, room_id: body.room_id!, channel: channelOf(method, body.bank_account_id), method, paid_at: paidAt.toISOString(),
                gross_satang: gross, verification: method === 'cash' ? 'n/a' : 'unverified', status: 'active',
                allocations: cleaned.map(a => ({ target_kind: a.kind as 'bill' | 'fine', target_id: a.id as string, amount_satang: a.satang })),
                revision: '', bank_account_id: method === 'bank_transfer' ? body.bank_account_id : null, transaction_ref: ref,
                room_number: String((roomSnap.data() as { room_number?: string }).room_number ?? ''),
                note, created_at: now, created_by: who.uid, received_by: who.displayName,
            };
            payment.revision = `${gross}|${payment.paid_at}|${payment.channel}|${payment.allocations.map(x => `${x.target_kind}:${x.target_id}=${x.amount_satang}`).join(',')}`;
            tx.set(db.doc(`${base}/payments/${paymentId}`), payment);
            for (const u of updates) tx.update(u.ref, u.data);
            return payment;
        });
        await audit('CREATE', 'payment', paymentId, `Room ${(roomSnap.data() as { room_number?: string }).room_number} ${gross / 100} THB`, {
            note: `${method}, ${cleaned.length} allocation(s), date ${thDate(result.paid_at)}`,
        });
        await autoPostSafe(owner, bld);
        res.status(200).json({ payment: result });
    }

    // ── verify_payment: confirm a recorded transfer against a real bank transaction ──
    async function verifyPayment() {
        const base = bldBase(owner, properties[0]);
        if (typeof body.payment_id !== 'string' || !body.payment_id || typeof body.bank_transaction_id !== 'string' || !body.bank_transaction_id) throw new HttpError(400, 'invalid_input');
        const payRef = db.doc(`${base}/payments/${body.payment_id}`);
        const txRef = db.doc(`${base}/bank_transactions/${body.bank_transaction_id}`);
        const [paySnap, txSnap] = await Promise.all([payRef.get(), txRef.get()]);
        if (!paySnap.exists || !txSnap.exists) throw new HttpError(404, 'not_found');
        const pay = paySnap.data() as PaymentRec & { bank_account_id?: string };
        const bt = txSnap.data() as { amount: number; bank_account_id: string; status: string; payment_id?: string };
        if (pay.method !== 'bank_transfer' || pay.status !== 'active') throw new HttpError(409, 'not_a_transfer');
        if (toSatang(bt.amount) !== pay.gross_satang) throw new HttpError(400, 'amount_mismatch');
        if (bt.bank_account_id !== pay.bank_account_id) throw new HttpError(400, 'account_mismatch');
        if (bt.status === 'reconciled' || bt.payment_id) throw new HttpError(409, 'transaction_already_used');
        const taken = await db.collection(`${base}/payments`).where('bank_transaction_id', '==', body.bank_transaction_id).get();
        if (taken.docs.length) throw new HttpError(409, 'transaction_already_used');
        const now = new Date().toISOString();
        await payRef.update({ verification: 'verified', bank_transaction_id: body.bank_transaction_id, verified_at: now, verified_by: who.uid });
        await txRef.update({ status: 'reconciled', payment_id: pay.id, matched: null, reconciled_at: now, reconciled_by: who.uid });
        await audit('UPDATE', 'payment', pay.id, `verified ${pay.gross_satang / 100} THB`, { note: `bank transaction ${body.bank_transaction_id}` });
        await autoPostSafe(owner, properties[0]);
        res.status(200).json({ ok: true });
    }
}
