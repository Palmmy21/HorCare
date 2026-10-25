/**
 * /api/payment-gateway (staff) and the settlement logic the provider webhook uses.
 *
 * HorCare asks the active provider for a QR / pay link for a specific bill, fine or collection charge (an "intent"). When
 * the provider reports the money arrived (a signed webhook, api/payment-webhook.ts) the payment is recorded as VERIFIED
 * (the gateway, unlike a slip photo, is bank-grade proof) and the document is marked paid, exactly once.
 *
 * Safety rules:
 *   • the amount is always computed here from the document, never taken from the caller;
 *   • a webhook is applied once (event claim + intent state), and a wrong amount is never applied — it goes to review;
 *   • every payment for a document is recorded with the same allocation fields the manual "record payment" uses,
 *     so the ledger and reconciliation see gateway money like any other.
 *
 * Actions: status | create_intent | get_intent | list_intents | cancel_intent
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomBytes, randomUUID } from 'node:crypto';
import { db } from './_firebase.js';
import { authorize, buildingExists } from './_rbac.js';
import { writeAudit } from './_audit.js';
import { appBaseUrl, notify } from './_notify.js';
import { dbError, supabase, SupabaseNotConfigured } from './_supabase.js';
import { autoPostCharges } from './_ledger-auto.js';
import { billToDoc, fineToDoc, legacyPayment, type PaidItem } from './_accounting-data.js';
import { activeProvider, configuredProviders } from './_gateway-registry.js';
import { channelOf, type PaymentRec } from '../src/shared/accounting.js';
import {
    TARGET_KINDS, canTransition, decideSettlement, effectiveStatus, intentExpiry, isOpen, makeReference,
    type PaymentIntent, type PaymentProvider, type ProviderEvent, type TargetKind,
} from '../src/shared/paymentGateway.js';
import type { Fine, MonthlyBill } from '../src/types/index.js';
import type { Permission } from '../src/shared/permissions.js';

export const config = { maxDuration: 30 };

export class GatewayError extends Error {
    constructor(public status: number, public code: string, public detail?: unknown) { super(code); }
}

const baseOf = (o: string, b: string) => `users/${o}/buildings/${b}`;
const intentRef = (o: string, b: string, id: string) => db.doc(`${baseOf(o, b)}/payment_intents/${id}`);

// ── the thing being paid ─────────────────────────────────────────────────────

export interface Target { kind: TargetKind; id: string; room_id: string | null; room_number: string | null; outstanding_satang: number; label: string }

/** What is still owed on a document right now, and whether it may be paid at all. */
export async function loadTarget(owner: string, bld: string, kind: TargetKind, id: string): Promise<Target> {
    if (kind === 'charge') {
        const { data, error } = await supabase().from('charges').select('*').eq('id', id).eq('owner_uid', owner).eq('building_id', bld).maybeSingle();
        if (error) { const e = dbError(error); throw new GatewayError(e.status, e.code); }
        const c = data as { room_id: string | null; room_number: string | null; amount_satang: number; paid_satang: number; status: string; description: string; party_name: string } | null;
        if (!c) throw new GatewayError(404, 'target_not_found');
        if (c.status !== 'open') throw new GatewayError(409, 'target_not_payable');
        return { kind, id, room_id: c.room_id, room_number: c.room_number, outstanding_satang: c.amount_satang - c.paid_satang, label: c.description || c.party_name };
    }
    const snap = await db.doc(`${baseOf(owner, bld)}/${kind === 'bill' ? 'bills' : 'fines'}/${id}`).get();
    if (!snap.exists) throw new GatewayError(404, 'target_not_found');
    const item = snap.data() as PaidItem;
    const doc = kind === 'bill' ? billToDoc(item as MonthlyBill) : fineToDoc(item as Fine);
    if (doc.status !== 'issued') throw new GatewayError(409, 'target_not_payable');
    const already = legacyPayment(kind, item) ? doc.total_satang : (item.allocated_satang ?? 0);
    const outstanding = doc.total_satang - already;
    if (outstanding <= 0) throw new GatewayError(409, 'target_not_payable');
    return { kind, id, room_id: item.room_id, room_number: item.room_number, outstanding_satang: outstanding, label: kind === 'bill' ? `บิล ${item.room_number} ${(item as MonthlyBill).month}` : `ค่าปรับ ${item.room_number}` };
}

// ── creating an intent ───────────────────────────────────────────────────────

export async function createIntent(opts: { owner: string; building: string; kind: TargetKind; targetId: string; by: string; provider: PaymentProvider; ttlMinutes?: number }): Promise<{ intent: PaymentIntent; reused: boolean }> {
    const { owner, building, kind, targetId, provider } = opts;
    const target = await loadTarget(owner, building, kind, targetId);
    const key = `${kind}:${targetId}`;

    // the same open request for the same document and amount is returned, not duplicated (a double click, a retry)
    const existing = (await db.collection(`${baseOf(owner, building)}/payment_intents`).where('target_key', '==', key).get()).docs.map(d => d.data() as PaymentIntent);
    const open = existing.find(i => i.provider === provider.id && isOpen(effectiveStatus(i)) && i.amount_satang === target.outstanding_satang);
    if (open) return { intent: open, reused: true };

    // a reference nobody has used; the claim doc is what makes it unique across all properties
    let reference = '';
    const id = randomUUID();
    for (let attempt = 0; attempt < 5 && !reference; attempt++) {
        const candidate = makeReference(randomBytes(10));
        try {
            await db.doc(`payment_intent_refs/${candidate}`).create({ owner_uid: owner, building_id: building, intent_id: id });
            reference = candidate;
        } catch (e) {
            const code = (e as { code?: unknown } | null)?.code;
            if (code !== 6 && code !== 'already-exists') throw e;
        }
    }
    if (!reference) throw new GatewayError(503, 'reference_unavailable');

    const now = new Date().toISOString();
    const expires_at = intentExpiry(opts.ttlMinutes);
    let charge;
    try {
        charge = await provider.createCharge({ intent_id: id, reference, amount_satang: target.outstanding_satang, expires_at, description: target.label });
    } catch (e) {
        await db.doc(`payment_intent_refs/${reference}`).delete();
        console.error('provider createCharge failed', e);
        throw new GatewayError(502, 'provider_error');
    }
    const intent: PaymentIntent & { target_key: string } = {
        id, owner_uid: owner, building_id: building, room_id: target.room_id, target: { kind, id: targetId }, target_key: key,
        amount_satang: target.outstanding_satang, currency: 'THB', status: 'pending', provider: provider.id, reference,
        provider_ref: charge.provider_ref, qr_payload: charge.qr_payload, pay_url: charge.pay_url, created_at: now, created_by: opts.by, expires_at,
    };
    await intentRef(owner, building, id).set(intent);
    return { intent, reused: false };
}

// ── settling (called by the webhook after the signature is verified) ─────────

export type SettleOutcome =
    | { outcome: 'settled'; intent_id: string }
    | { outcome: 'review'; intent_id: string; reason: string }
    | { outcome: 'marked'; intent_id: string; status: string }
    | { outcome: 'ignored'; intent_id?: string; reason: string };

const SYSTEM = (p: PaymentProvider) => ({ uid: `gateway:${p.id}`, displayName: p.label });

async function sendToReview(owner: string, building: string, intent: PaymentIntent, received: number, reason: string, provider: PaymentProvider) {
    await intentRef(owner, building, intent.id).update({ status: 'needs_review', received_satang: received, failure_reason: reason });
    await notify({
        event: 'payment.needs_review', ownerUid: owner, buildingId: building,
        data: { reference: intent.reference, expected: intent.amount_satang / 100, received: received / 100, reason, provider: provider.label },
    });
}

/** Apply one verified provider event. Safe to call twice with the same event: the second call changes nothing. */
export async function settleEvent(provider: PaymentProvider, ev: ProviderEvent): Promise<SettleOutcome> {
    const refSnap = await db.doc(`payment_intent_refs/${ev.reference}`).get();
    if (!refSnap.exists) return { outcome: 'ignored', reason: 'unknown_reference' };
    const { owner_uid: owner, building_id: building, intent_id } = refSnap.data() as { owner_uid: string; building_id: string; intent_id: string };
    const iRef = intentRef(owner, building, intent_id);
    const iSnap = await iRef.get();
    if (!iSnap.exists) return { outcome: 'ignored', reason: 'unknown_intent' };
    const intent = iSnap.data() as PaymentIntent;
    if (intent.provider !== provider.id) return { outcome: 'ignored', intent_id, reason: 'wrong_provider' };

    const decision = decideSettlement(intent, ev);
    if (decision.action === 'ignore') return { outcome: 'ignored', intent_id, reason: decision.reason };

    // one delivery of one event is applied once; a failure below releases the claim so the provider's retry can succeed
    const claim = db.doc(`gateway_events/${provider.id}__${ev.event_id}`);
    try {
        await claim.create({ intent_id, at: new Date().toISOString(), status: ev.status });
    } catch (e) {
        const code = (e as { code?: unknown } | null)?.code;
        if (code === 6 || code === 'already-exists') return { outcome: 'ignored', intent_id, reason: 'duplicate_event' };
        throw e;
    }
    try {
        if (decision.action === 'review') {
            await sendToReview(owner, building, intent, decision.received_satang, decision.reason, provider);
            return { outcome: 'review', intent_id, reason: decision.reason };
        }
        if (decision.action === 'mark') {
            await iRef.update({ status: decision.status, ...(ev.status === 'failed' ? { failure_reason: 'provider_failed' } : {}) });
            return { outcome: 'marked', intent_id, status: decision.status };
        }
        const settled = intent.target.kind === 'charge' ? await settleCharge(owner, building, intent, ev, provider) : await settleDocument(owner, building, intent, ev, provider);
        if (settled !== 'ok') {
            await sendToReview(owner, building, intent, ev.amount_satang, settled, provider);
            return { outcome: 'review', intent_id, reason: settled };
        }
        return { outcome: 'settled', intent_id };
    } catch (e) {
        await claim.delete();
        throw e;
    }
}

/** Bill or fine: payment record + document update + intent, in one transaction. 'ok', or why it needs a human. */
async function settleDocument(owner: string, building: string, intent: PaymentIntent, ev: ProviderEvent, provider: PaymentProvider): Promise<'ok' | 'target_changed'> {
    const base = baseOf(owner, building);
    const kind = intent.target.kind as 'bill' | 'fine';
    const tRef = db.doc(`${base}/${kind === 'bill' ? 'bills' : 'fines'}/${intent.target.id}`);
    const iRef = intentRef(owner, building, intent.id);
    const paidAt = ev.paid_at ?? new Date().toISOString();
    const now = new Date().toISOString();

    return db.runTransaction<'ok' | 'target_changed'>(async tx => {
        const [tSnap, iSnap] = await Promise.all([tx.get(tRef), tx.get(iRef)]);
        if (!tSnap.exists || !iSnap.exists) return 'target_changed';
        const live = iSnap.data() as PaymentIntent;
        if (live.status === 'paid') return 'ok'; // lost a race with another delivery: already applied
        const item = tSnap.data() as PaidItem;
        const doc = kind === 'bill' ? billToDoc(item as MonthlyBill) : fineToDoc(item as Fine);
        const already = legacyPayment(kind, item) ? doc.total_satang : (item.allocated_satang ?? 0);
        // the document must still owe exactly what the intent asked for (it may have been paid another way meanwhile)
        if (doc.status !== 'issued' || doc.total_satang - already !== intent.amount_satang) return 'target_changed';

        const paymentId = randomUUID();
        const allocated = already + intent.amount_satang;
        const channel = channelOf('qr_gateway', null);
        const payment: PaymentRec & Record<string, unknown> = {
            id: paymentId, room_id: item.room_id, channel, method: 'qr_gateway', paid_at: paidAt, gross_satang: intent.amount_satang,
            // the provider confirmed the money: this is not "a picture of a slip"
            verification: 'verified', status: 'active',
            allocations: [{ target_kind: kind, target_id: intent.target.id, amount_satang: intent.amount_satang }], revision: '',
            bank_account_id: null, transaction_ref: ev.provider_txn_id ?? intent.reference, room_number: item.room_number, note: `${provider.label} ${intent.reference}`,
            created_at: now, created_by: `gateway:${provider.id}`, received_by: provider.label,
            gateway: { provider: provider.id, intent_id: intent.id, reference: intent.reference, provider_txn_id: ev.provider_txn_id ?? null, fee_satang: ev.fee_satang ?? 0 },
        };
        payment.revision = `${intent.amount_satang}|${paidAt}|${channel}|${kind}:${intent.target.id}=${intent.amount_satang}`;
        tx.set(db.doc(`${base}/payments/${paymentId}`), payment);
        tx.update(tRef, {
            allocated_satang: allocated, payments_recorded: true, updated_at: now,
            ...(allocated >= doc.total_satang ? {
                paid_at: paidAt, paid_method: 'auto', payment_method: 'qr_gateway', paid_amount: doc.total_satang / 100, verification_status: 'verified',
                ...(kind === 'bill' ? { payment_status: 'paid' } : { status: 'paid' }),
            } : {}),
        });
        tx.update(iRef, {
            status: 'paid', paid_at: paidAt, payment_id: paymentId,
            ...(ev.provider_txn_id ? { provider_txn_id: ev.provider_txn_id } : {}), ...(ev.fee_satang !== undefined ? { fee_satang: ev.fee_satang } : {}),
        });
        return 'ok';
    });
}

/** A collection charge (Supabase): atomic payment through the same function every other payment uses. */
async function settleCharge(owner: string, building: string, intent: PaymentIntent, ev: ProviderEvent, provider: PaymentProvider): Promise<'ok' | 'target_changed'> {
    const sb = supabase();
    const paidAt = ev.paid_at ?? new Date().toISOString();
    const { data, error } = await sb.rpc('collections_pay', {
        p_owner: owner, p_building: building, p_charge: intent.target.id, p_amount: intent.amount_satang, p_method: 'transfer', p_kind: 'payment',
        p_bank: `gateway:${provider.id}`, p_note: `${provider.label} ${intent.reference}`, p_by: `gateway:${provider.id}`, p_by_name: provider.label,
    });
    if (error) {
        if (error.message === 'exceeds_outstanding' || error.message === 'charge_void') return 'target_changed';
        const e = dbError(error);
        throw new GatewayError(e.status, e.code);
    }
    const pay = data as { id: string };
    // provider-confirmed, and unique per provider transaction so the same payment can never be recorded twice
    const stamp = await sb.from('charge_payments').update({
        verification: 'verified', slip_ref: `gw:${provider.id}:${ev.provider_txn_id ?? ev.event_id}`,
        slip_details: { gateway: provider.id, reference: intent.reference, provider_txn_id: ev.provider_txn_id ?? null, fee_satang: ev.fee_satang ?? 0 },
    }).eq('id', pay.id).eq('owner_uid', owner).eq('building_id', building);
    if (stamp.error) console.error('gateway evidence not stored', stamp.error);
    await intentRef(owner, building, intent.id).update({
        status: 'paid', paid_at: paidAt, payment_id: pay.id,
        ...(ev.provider_txn_id ? { provider_txn_id: ev.provider_txn_id } : {}), ...(ev.fee_satang !== undefined ? { fee_satang: ev.fee_satang } : {}),
    });
    await autoPostCharges(owner, building, SYSTEM(provider));
    return 'ok';
}

// ── the staff API ────────────────────────────────────────────────────────────

type Action = 'status' | 'create_intent' | 'get_intent' | 'list_intents' | 'cancel_intent';
const PERMISSION: Record<Action, Permission> = {
    status: 'finance.read', get_intent: 'finance.read', list_intents: 'finance.read', create_intent: 'payment.create', cancel_intent: 'payment.create',
};
interface Body { action?: Action; owner_uid?: string; building_id?: string; target_kind?: string; target_id?: string; intent_id?: string; ttl_minutes?: number }

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const body = (req.body ?? {}) as Body;
    const action = body.action;
    if (!action || !(action in PERMISSION)) { res.status(400).json({ error: 'unknown_action' }); return; }
    if (typeof body.building_id !== 'string' || !body.building_id) { res.status(400).json({ error: 'building_id is required' }); return; }
    const ctx = await authorize(req, res, { ownerUid: body.owner_uid, buildingId: body.building_id, permission: PERMISSION[action] });
    if (!ctx) return;
    if (!(await buildingExists(ctx.ownerUid, body.building_id))) { res.status(404).json({ error: 'property_not_found' }); return; }
    const owner = ctx.ownerUid, building = body.building_id;
    const audit = (id: string, label: string, note: string) => writeAudit({
        ownerUid: owner, propertyId: building, userId: ctx.uid, userName: ctx.displayName, role: ctx.role,
        action: 'CREATE', resourceType: 'payment', resourceId: id, resourceLabel: label, note, req,
    });

    try {
        if (action === 'status') {
            const p = activeProvider();
            res.status(200).json({
                enabled: !!p, provider: p ? { id: p.id, label: p.label } : null, configured: configuredProviders().map(x => ({ id: x.id, label: x.label })),
                webhook_url: `${appBaseUrl()}/api/payment-webhook?provider=${p?.id ?? '<provider>'}`,
            });
            return;
        }
        if (action === 'create_intent') {
            const provider = activeProvider();
            if (!provider) throw new GatewayError(503, 'gateway_not_configured');
            if (!(TARGET_KINDS as readonly string[]).includes(body.target_kind as string) || typeof body.target_id !== 'string' || !body.target_id) throw new GatewayError(400, 'invalid_input');
            const ttl = body.ttl_minutes === undefined ? undefined : Number(body.ttl_minutes);
            if (ttl !== undefined && !Number.isFinite(ttl)) throw new GatewayError(400, 'invalid_input');
            const r = await createIntent({ owner, building, kind: body.target_kind as TargetKind, targetId: body.target_id, by: ctx.uid, provider, ttlMinutes: ttl });
            if (!r.reused) await audit(r.intent.id, `${r.intent.target.kind} ${r.intent.amount_satang / 100} THB`, `payment intent ${r.intent.reference} via ${provider.id}`);
            res.status(200).json({ intent: { ...r.intent, status: effectiveStatus(r.intent) }, reused: r.reused });
            return;
        }
        if (action === 'list_intents') {
            const col = db.collection(`${baseOf(owner, building)}/payment_intents`);
            const all = (body.target_id ? await col.where('target_key', '==', `${body.target_kind ?? 'bill'}:${body.target_id}`).get() : await col.get()).docs.map(d => d.data() as PaymentIntent);
            res.status(200).json({ intents: all.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 100).map(i => ({ ...i, status: effectiveStatus(i) })) });
            return;
        }
        if (typeof body.intent_id !== 'string' || !body.intent_id) throw new GatewayError(400, 'invalid_input');
        const ref = intentRef(owner, building, body.intent_id);
        const snap = await ref.get();
        if (!snap.exists) throw new GatewayError(404, 'not_found');
        const intent = snap.data() as PaymentIntent;
        if (action === 'get_intent') { res.status(200).json({ intent: { ...intent, status: effectiveStatus(intent) } }); return; }

        // cancel_intent
        if (!canTransition(intent.status, 'cancelled')) throw new GatewayError(409, 'not_cancellable');
        await ref.update({ status: 'cancelled' });
        await audit(intent.id, `cancel ${intent.reference}`, 'payment intent cancelled');
        res.status(200).json({ ok: true });
    } catch (e) {
        if (e instanceof GatewayError) { res.status(e.status).json({ error: e.code }); return; }
        if (e instanceof SupabaseNotConfigured) { res.status(503).json({ error: 'supabase_not_configured' }); return; }
        console.error('payment-gateway error', e);
        res.status(500).json({ error: 'internal_error' });
    }
}
