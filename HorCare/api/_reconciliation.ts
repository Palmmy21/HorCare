/**
 * /api/reconciliation — match real bank transactions to bills / fines.
 *
 * A bank transaction is evidence; a slip is only a claim. Only `confirm` (a person, with
 * `payment.reconcile`) marks a payment `verified`, and only against a transaction whose amount
 * equals the item's. The matching itself is src/shared/reconciliation.ts (pure, tested).
 *
 * Writes only — reading goes straight to Firestore under rules requiring `finance.read`.
 * Actions: import | confirm | confirm_matched | reject | rematch
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'node:crypto';
import { db } from './_firebase.js';
import { authorize, buildingExists } from './_rbac.js';
import { writeAudit } from './_audit.js';
import {
    matchTransaction, sameAmount, transactionKey,
    type BankTransaction, type ReconItem, type ReconTarget,
} from '../src/shared/reconciliation.js';
import type { MonthlyBill, Fine } from '../src/types/index.js';

export const config = { maxDuration: 30 };

const MAX_ROWS = 500;
const MAX_AMOUNT = 10_000_000;

interface Row { occurred_at?: unknown; amount?: unknown; reference?: unknown; description?: unknown }
interface Body {
    action?: 'import' | 'confirm' | 'confirm_matched' | 'reject' | 'rematch';
    owner_uid?: string;
    building_id?: string;
    bank_account_id?: string;
    rows?: Row[];
    tx_id?: string;
    item_kind?: string;
    item_id?: string;
    source?: string;
}

class HttpError extends Error {
    constructor(public status: number, public code: string) { super(code); }
}

const baseOf = (owner: string, bld: string) => `users/${owner}/buildings/${bld}`;
const itemCol = (kind: 'bill' | 'fine') => (kind === 'bill' ? 'bills' : 'fines');

function optText(v: unknown, max: number): string | null | undefined {
    if (v === undefined || v === null || v === '') return null;
    if (typeof v !== 'string') return undefined;
    const t = v.trim();
    return t.length <= max ? (t || null) : undefined;
}

function toItem(kind: 'bill' | 'fine', data: MonthlyBill | Fine): ReconItem {
    const d = data as MonthlyBill & Fine;
    return {
        kind, id: d.id, room_id: d.room_id, room_number: d.room_number,
        amount: kind === 'bill' ? d.total_bill : d.amount,
        payment_status: d.payment_status ?? (kind === 'fine' ? (d.status ?? 'unpaid') : 'unpaid'),
        verification_status: d.verification_status,
        transaction_ref: d.transaction_ref ?? d.slip_ref,
        bank_account_id: d.bank_account_id ?? d.slip_account_id,
        paid_time: d.slip_datetime ?? d.paid_at,
        bank_transaction_id: (d as { bank_transaction_id?: string }).bank_transaction_id,
    };
}

async function loadItems(owner: string, bld: string): Promise<ReconItem[]> {
    const base = baseOf(owner, bld);
    const [bills, fines] = await Promise.all([db.collection(`${base}/bills`).get(), db.collection(`${base}/fines`).get()]);
    return [
        ...bills.docs.map(d => toItem('bill', d.data() as MonthlyBill)),
        ...fines.docs.map(d => toItem('fine', d.data() as Fine)),
    ].filter(i => Number.isFinite(i.amount) && i.amount > 0);
}

/** Apply a confirmation atomically: transaction → reconciled, item → verified paid. */
async function confirmMatch(
    owner: string, bld: string, txId: string, target: { kind: 'bill' | 'fine'; id: string },
    actor: { uid: string; name: string },
): Promise<{ tx: BankTransaction; item: ReconTarget }> {
    const base = baseOf(owner, bld);
    const txRef = db.doc(`${base}/bank_transactions/${txId}`);
    const itemRef = db.doc(`${base}/${itemCol(target.kind)}/${target.id}`);
    return db.runTransaction(async t => {
        const [txSnap, itemSnap] = await Promise.all([t.get(txRef), t.get(itemRef)]);
        if (!txSnap.exists) throw new HttpError(404, 'transaction_not_found');
        if (!itemSnap.exists) throw new HttpError(404, 'item_not_found');
        const tx = txSnap.data() as BankTransaction;
        const item = toItem(target.kind, itemSnap.data() as MonthlyBill | Fine);
        if (tx.status === 'reconciled') throw new HttpError(409, 'already_reconciled');
        if (!sameAmount(tx.amount, item.amount)) throw new HttpError(400, 'amount_mismatch');
        if (item.bank_transaction_id && item.bank_transaction_id !== tx.id) throw new HttpError(409, 'item_already_reconciled');

        const now = new Date().toISOString();
        const wasPaid = item.payment_status === 'paid';
        const itemUpdate: Record<string, unknown> = {
            bank_transaction_id: tx.id,
            verification_status: 'verified',
            payment_status: 'paid',
            paid_amount: tx.amount,
            bank_account_id: tx.bank_account_id,
            updated_at: now,
        };
        if (!wasPaid) {
            itemUpdate.paid_at = tx.occurred_at;
            itemUpdate.paid_method = 'manual';
            itemUpdate.payment_method = 'bank_transfer';
        }
        // fines track state in `status`; bills in `payment_status`
        if (target.kind === 'fine') itemUpdate.status = 'paid';
        if (!wasPaid && tx.reference) itemUpdate.transaction_ref = tx.reference;

        const matched: ReconTarget = { kind: target.kind, id: item.id, room_id: item.room_id, room_number: item.room_number };
        const txUpdate = {
            status: 'reconciled', matched, conflict_reason: null,
            reconciled_at: now, reconciled_by: actor.uid,
        };
        t.update(itemRef, itemUpdate);
        t.update(txRef, txUpdate);
        return { tx: { ...tx, ...txUpdate } as BankTransaction, item: matched };
    });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const body = (req.body ?? {}) as Body;
    const buildingId = body.building_id;
    if (!buildingId || typeof buildingId !== 'string') { res.status(400).json({ error: 'building_id is required' }); return; }
    const action = body.action;
    if (action !== 'import' && action !== 'confirm' && action !== 'confirm_matched' && action !== 'reject' && action !== 'rematch') {
        res.status(400).json({ error: 'unknown_action' });
        return;
    }

    const ctx = await authorize(req, res, { ownerUid: body.owner_uid, buildingId, permission: 'payment.reconcile' });
    if (!ctx) return;
    if (!(await buildingExists(ctx.ownerUid, buildingId))) { res.status(404).json({ error: 'property_not_found' }); return; }

    const base = baseOf(ctx.ownerUid, buildingId);
    const txCol = `${base}/bank_transactions`;
    const audit = (act: 'CREATE' | 'UPDATE', id: string, label: string, extra: object = {}) => writeAudit({
        ownerUid: ctx.ownerUid, propertyId: buildingId, userId: ctx.uid, userName: ctx.displayName, role: ctx.role,
        action: act, resourceType: 'bank_transaction', resourceId: id, resourceLabel: label, req, ...extra,
    });
    const actor = { uid: ctx.uid, name: ctx.displayName };

    try {
        // ── import ────────────────────────────────────────────────────────────
        if (action === 'import') {
            const accountId = body.bank_account_id;
            const rows = body.rows;
            if (typeof accountId !== 'string' || !accountId || !Array.isArray(rows) || rows.length === 0 || rows.length > MAX_ROWS) {
                res.status(400).json({ error: 'invalid_input' });
                return;
            }
            if (!(await db.doc(`${base}/bank_accounts/${accountId}`).get()).exists) { res.status(404).json({ error: 'account_not_found' }); return; }
            const source = body.source === 'csv' ? 'csv' : 'manual';

            const parsed: { occurred_at: string; amount: number; reference: string | null; description: string | null }[] = [];
            for (const r of rows) {
                const when = typeof r.occurred_at === 'string' ? new Date(r.occurred_at) : null;
                const amount = typeof r.amount === 'number' ? Math.round(r.amount * 100) / 100 : NaN;
                const reference = optText(r.reference, 80);
                const description = optText(r.description, 200);
                if (!when || Number.isNaN(when.getTime()) || !Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT
                    || reference === undefined || description === undefined) {
                    res.status(400).json({ error: 'invalid_input' });
                    return;
                }
                // a statement can't contain the future
                if (when.getTime() > Date.now() + 24 * 3600_000) { res.status(400).json({ error: 'invalid_input' }); return; }
                parsed.push({ occurred_at: when.toISOString(), amount, reference, description });
            }

            const items = await loadItems(ctx.ownerUid, buildingId);
            const now = new Date().toISOString();
            let created = 0;
            let skipped = 0;
            const counts: Record<string, number> = {};
            for (const p of parsed) {
                const id = createHash('sha1').update(transactionKey({ bank_account_id: accountId, ...p })).digest('hex').slice(0, 24);
                const ref = db.doc(`${txCol}/${id}`);
                if ((await ref.get()).exists) { skipped++; continue; }
                const m = matchTransaction({ id, amount: p.amount, bank_account_id: accountId, occurred_at: p.occurred_at, reference: p.reference }, items);
                const tx: BankTransaction = {
                    id, bank_account_id: accountId, amount: p.amount, occurred_at: p.occurred_at,
                    reference: p.reference, description: p.description,
                    status: m.status, matched: m.matched, candidates: m.candidates, conflict_reason: m.conflict_reason,
                    source, created_at: now, created_by: ctx.uid,
                };
                await ref.set(tx);
                created++;
                counts[m.status] = (counts[m.status] ?? 0) + 1;
            }
            await audit('CREATE', accountId, `นำเข้า ${created} รายการ`, { after: { created, skipped, source } });
            res.status(200).json({ created, skipped, counts });
            return;
        }

        // ── rematch: re-run the engine over everything not yet reconciled ────────
        if (action === 'rematch') {
            const items = await loadItems(ctx.ownerUid, buildingId);
            const snap = await db.collection(txCol).get();
            let changed = 0;
            for (const d of snap.docs) {
                const tx = d.data() as BankTransaction;
                if (tx.status === 'reconciled') continue;
                const m = matchTransaction(tx, items);
                if (m.status !== tx.status || m.matched?.id !== tx.matched?.id) {
                    await db.doc(`${txCol}/${tx.id}`).update({ status: m.status, matched: m.matched, candidates: m.candidates, conflict_reason: m.conflict_reason });
                    changed++;
                }
            }
            res.status(200).json({ changed });
            return;
        }

        // ── reject: a human says the suggested item is wrong ──────────────────────
        if (action === 'reject') {
            if (typeof body.tx_id !== 'string' || !body.tx_id) { res.status(400).json({ error: 'invalid_input' }); return; }
            const ref = db.doc(`${txCol}/${body.tx_id}`);
            const snap = await ref.get();
            if (!snap.exists) { res.status(404).json({ error: 'transaction_not_found' }); return; }
            const tx = snap.data() as BankTransaction;
            if (tx.status === 'reconciled') { res.status(409).json({ error: 'already_reconciled' }); return; }
            const rejected = [...new Set([...(tx.rejected_item_ids ?? []), ...(tx.matched ? [tx.matched.id] : []), ...(typeof body.item_id === 'string' ? [body.item_id] : [])])];
            const items = await loadItems(ctx.ownerUid, buildingId);
            const m = matchTransaction({ ...tx, rejected_item_ids: rejected }, items);
            await ref.update({ rejected_item_ids: rejected, status: m.status, matched: m.matched, candidates: m.candidates, conflict_reason: m.conflict_reason });
            await audit('UPDATE', tx.id, `ปฏิเสธการจับคู่ ${tx.amount} บาท`, { note: 'match rejected' });
            res.status(200).json({ status: m.status });
            return;
        }

        // ── confirm one ───────────────────────────────────────────────────────
        if (action === 'confirm') {
            if (typeof body.tx_id !== 'string' || !body.tx_id || (body.item_kind !== 'bill' && body.item_kind !== 'fine')
                || typeof body.item_id !== 'string' || !body.item_id) {
                res.status(400).json({ error: 'invalid_input' });
                return;
            }
            const out = await confirmMatch(ctx.ownerUid, buildingId, body.tx_id, { kind: body.item_kind, id: body.item_id }, actor);
            await audit('UPDATE', out.tx.id, `ยืนยัน ${out.tx.amount} บาท ↔ ห้อง ${out.item.room_number}`, {
                after: { item: `${out.item.kind}:${out.item.id}`, verification_status: 'verified' },
            });
            res.status(200).json({ ok: true });
            return;
        }

        // ── confirm every system-matched (reference-backed) transaction ───────────
        const snap = await db.collection(txCol).get();
        let confirmed = 0;
        let failed = 0;
        for (const d of snap.docs) {
            const tx = d.data() as BankTransaction;
            if (tx.status !== 'matched' || !tx.matched) continue;
            try {
                const out = await confirmMatch(ctx.ownerUid, buildingId, tx.id, { kind: tx.matched.kind, id: tx.matched.id }, actor);
                await audit('UPDATE', out.tx.id, `ยืนยัน ${out.tx.amount} บาท ↔ ห้อง ${out.item.room_number}`, { note: 'bulk confirm of reference matches' });
                confirmed++;
            } catch (e) {
                if (e instanceof HttpError) failed++; else throw e;
            }
        }
        res.status(200).json({ confirmed, failed });
    } catch (e) {
        if (e instanceof HttpError) { res.status(e.status).json({ error: e.code }); return; }
        throw e;
    }
}
