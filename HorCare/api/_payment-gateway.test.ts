import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import { FakeSupabase } from './_fake-supabase.js';
const sb = new FakeSupabase();
vi.mock('./_supabase.js', async () => {
    const real = await vi.importActual<typeof import('./_supabase.js')>('./_supabase.js');
    return { ...real, supabase: () => sb };
});

import api from './_payment-gateway.js';
import webhook from './payment-webhook.js';
import { signSandbox, SANDBOX_SIGNATURE_HEADER } from './_gateways/sandbox.js';
import { addAuthUser, fakeReq, fakeRes, listPaths, read, resetFake, seed } from './_fake-firestore.js';
import { permissionsForRole } from '../src/shared/permissions.js';
import { emptyLedger } from '../src/shared/ledger.js';

const OWNER = 'owner-1';
const B = 'bld-1';
const BASE = `users/${OWNER}/buildings/${B}`;
const SECRET = 'sandbox-secret';

beforeEach(() => {
    resetFake(); sb.reset();
    process.env.PAYMENT_GATEWAY_SANDBOX_SECRET = SECRET;
    process.env.PAYMENT_GATEWAY_PROVIDER = 'sandbox';
    for (const [u, n] of [[OWNER, 'Owner'], ['fin', 'Fin'], ['desk', 'Desk'], ['tech', 'Tech']]) addAuthUser(u, `${u}@x.com`, n);
    seed(`users/${OWNER}`, { uid: OWNER, license: 'active' });
    seed(`users/${OWNER}/buildings/${B}`, { id: B });
    seed(`${BASE}/data/config`, { bill_customization: { dorm_name: 'ONE9 LIFE' } });
    seed(`${BASE}/rooms/r1`, { room_number: '101', is_active: true });
    seed(`${BASE}/bills/b1`, { id: 'b1', room_id: 'r1', room_number: '101', month: '2026-10', room_rent: 3000, elec_bill: 400, water_bill: 100, common_fee: 0, total_bill: 3500, is_saved: true, created_at: '2026-10-01T00:00:00Z', payment_status: 'unpaid' });
    seed(`${BASE}/fines/f1`, { id: 'f1', room_id: 'r1', room_number: '101', amount: 200, date: '2026-10-05', created_at: '2026-10-05T00:00:00Z', status: 'unpaid', reason: 'x' });
    for (const [uid, role] of [['fin', 'finance'], ['desk', 'front_desk'], ['tech', 'technician']] as const)
        seed(`users/${OWNER}/members/${uid}`, { uid, role, permissions: permissionsForRole(role), property_ids: ['*'], status: 'active' });
});

async function call(uid: string | null, body: Record<string, unknown>) {
    const res = fakeRes();
    await api(fakeReq({ owner_uid: OWNER, building_id: B, ...body }, uid ?? undefined), res as never);
    return res as { statusCode: number; body: any };
}
const intentFor = async (kind = 'bill', id = 'b1', uid: string | null = OWNER) => (await call(uid, { action: 'create_intent', target_kind: kind, target_id: id })).body.intent as { id: string; reference: string; amount_satang: number; status: string };

/** A provider webhook as the provider would send it: raw body + signature. */
async function hook(event: Record<string, unknown>, opts: { secret?: string; provider?: string; raw?: string; sign?: boolean } = {}) {
    const raw = opts.raw ?? JSON.stringify(event);
    const req = Object.assign(Readable.from([Buffer.from(raw)]), {
        method: 'POST', query: { provider: opts.provider ?? 'sandbox' }, socket: { remoteAddress: '203.0.113.9' },
        headers: opts.sign === false ? {} : { [SANDBOX_SIGNATURE_HEADER]: signSandbox(opts.secret ?? SECRET, raw) },
    });
    const res = fakeRes();
    await webhook(req as never, res as never);
    return res as { statusCode: number; body: any };
}
const paid = (i: { reference: string; amount_satang: number }, over: Record<string, unknown> = {}) =>
    ({ event_id: `evt-${Math.random().toString(36).slice(2)}`, reference: i.reference, status: 'paid', amount_satang: i.amount_satang, paid_at: '2026-10-08T07:00:00Z', txn_id: 'TXN-1', fee_satang: 500, ...over });
const payments = () => listPaths(`${BASE}/payments/`).map(p => read(p)!);

describe('creating a payment request', () => {
    it('asks the provider for a QR for exactly what is owed, with a short reference', async () => {
        const i = await intentFor();
        expect(i).toMatchObject({ amount_satang: 350000, status: 'pending' });
        expect(i.reference).toMatch(/^HC[A-HJ-NP-Z2-9]{10}$/);
        const stored = read(`${BASE}/payment_intents/${i.id}`)!;
        expect(stored).toMatchObject({ provider: 'sandbox', target: { kind: 'bill', id: 'b1' }, room_id: 'r1', currency: 'THB', target_key: 'bill:b1', created_by: OWNER });
        expect(stored.qr_payload).toContain(i.reference);
        expect(read(`payment_intent_refs/${i.reference}`)).toMatchObject({ owner_uid: OWNER, building_id: B, intent_id: i.id });
    });

    it('a second click returns the same open request instead of making another', async () => {
        const a = await intentFor();
        const again = await call(OWNER, { action: 'create_intent', target_kind: 'bill', target_id: 'b1' });
        expect(again.body.reused).toBe(true);
        expect(again.body.intent.id).toBe(a.id);
        expect(listPaths(`${BASE}/payment_intents/`)).toHaveLength(1);
    });

    it('the amount is the outstanding balance, not something the caller can name', async () => {
        seed(`${BASE}/bills/b1`, { ...read(`${BASE}/bills/b1`)!, allocated_satang: 100000, payments_recorded: true });
        const r = await call(OWNER, { action: 'create_intent', target_kind: 'bill', target_id: 'b1', amount_satang: 1, amount: 1 });
        expect(r.body.intent.amount_satang).toBe(250000);
    });

    it('refuses what cannot be paid: paid, draft or unknown documents, bad input, no provider', async () => {
        seed(`${BASE}/bills/paid`, { id: 'paid', room_id: 'r1', room_number: '101', month: '2026-09', total_bill: 1000, is_saved: true, payment_status: 'paid', created_at: 'x' });
        seed(`${BASE}/bills/draft`, { id: 'draft', room_id: 'r1', room_number: '101', month: '2026-11', total_bill: 1000, is_saved: false, created_at: 'x' });
        expect((await call(OWNER, { action: 'create_intent', target_kind: 'bill', target_id: 'paid' })).body.error).toBe('target_not_payable');
        expect((await call(OWNER, { action: 'create_intent', target_kind: 'bill', target_id: 'draft' })).body.error).toBe('target_not_payable');
        expect((await call(OWNER, { action: 'create_intent', target_kind: 'bill', target_id: 'ghost' })).body.error).toBe('target_not_found');
        expect((await call(OWNER, { action: 'create_intent', target_kind: 'loan', target_id: 'b1' })).statusCode).toBe(400);
        expect((await call(OWNER, { action: 'create_intent', target_kind: 'bill' })).statusCode).toBe(400);
        delete process.env.PAYMENT_GATEWAY_PROVIDER;
        const off = await call(OWNER, { action: 'create_intent', target_kind: 'bill', target_id: 'b1' });
        expect([off.statusCode, off.body.error]).toEqual([503, 'gateway_not_configured']);
        expect((await call(OWNER, { action: 'status' })).body).toMatchObject({ enabled: false, provider: null });
    });

    it('who may do what: finance, front desk and owner create, a technician nothing, and the status shows the webhook URL', async () => {
        expect((await call('tech', { action: 'create_intent', target_kind: 'bill', target_id: 'b1' })).statusCode).toBe(403);
        expect((await call('desk', { action: 'create_intent', target_kind: 'bill', target_id: 'b1' })).statusCode).toBe(200);
        expect((await call('fin', { action: 'list_intents' })).body.intents).toHaveLength(1);
        expect((await call('tech', { action: 'list_intents' })).statusCode).toBe(403);
        expect((await call(null, { action: 'status' })).statusCode).toBe(401);
        const s = (await call('fin', { action: 'status' })).body;
        expect(s).toMatchObject({ enabled: true, provider: { id: 'sandbox' } });
        expect(s.webhook_url).toContain('/api/payment-webhook?provider=sandbox');
    });

    it('can be cancelled while open, not after payment', async () => {
        const i = await intentFor();
        expect((await call(OWNER, { action: 'cancel_intent', intent_id: i.id })).statusCode).toBe(200);
        expect(read(`${BASE}/payment_intents/${i.id}`)!.status).toBe('cancelled');
        const j = await intentFor('fine', 'f1');
        await hook(paid(j));
        expect((await call(OWNER, { action: 'cancel_intent', intent_id: j.id })).body.error).toBe('not_cancellable');
    });
});

describe('the webhook door', () => {
    it('refuses a wrong or missing signature and an unknown provider, and applies nothing', async () => {
        const i = await intentFor();
        expect((await hook(paid(i), { secret: 'not-the-secret' })).statusCode).toBe(401);
        expect((await hook(paid(i), { sign: false })).statusCode).toBe(401);
        expect((await hook(paid(i), { provider: 'nobody' })).statusCode).toBe(401);
        expect(read(`${BASE}/payment_intents/${i.id}`)!.status).toBe('pending');
        expect(payments()).toHaveLength(0);
    });

    it('malformed but correctly signed bodies are 400, heartbeats are accepted and ignored, other methods are refused', async () => {
        expect((await hook({}, { raw: 'not json' })).statusCode).toBe(400);
        expect((await hook({ event_id: 'e', reference: 'nope', status: 'paid', amount_satang: 1 })).statusCode).toBe(400);
        expect((await hook({ event_id: 'e', reference: 'HCABCDEFGHJK', status: 'paid', amount_satang: -5 })).statusCode).toBe(400);
        expect((await hook({ event_id: 'heartbeat' })).statusCode).toBe(200);
        const res = fakeRes();
        await webhook({ method: 'GET', query: {}, headers: {}, socket: {} } as never, res as never);
        expect(res.statusCode).toBe(405);
    });

    it('a signed event for a reference nobody issued is acknowledged without effect', async () => {
        const r = await hook({ event_id: 'e1', reference: 'HCABCDEFGHJK', status: 'paid', amount_satang: 100 });
        expect(r.statusCode).toBe(200);
        expect(r.body.outcome).toBe('ignored');
    });
});

describe('a verified payment', () => {
    it('marks the bill paid, records a VERIFIED gateway payment with its fee and reference, and closes the intent', async () => {
        const i = await intentFor();
        const r = await hook(paid(i));
        expect(r.body).toMatchObject({ ok: true, outcome: 'settled' });

        expect(read(`${BASE}/bills/b1`)).toMatchObject({ payment_status: 'paid', allocated_satang: 350000, payments_recorded: true, payment_method: 'qr_gateway', paid_amount: 3500, verification_status: 'verified' });
        const [p] = payments();
        expect(p).toMatchObject({
            method: 'qr_gateway', channel: 'qr_gateway', verification: 'verified', status: 'active', gross_satang: 350000, room_id: 'r1', transaction_ref: 'TXN-1',
            allocations: [{ target_kind: 'bill', target_id: 'b1', amount_satang: 350000 }], gateway: { provider: 'sandbox', reference: i.reference, fee_satang: 500 },
        });
        expect(read(`${BASE}/payment_intents/${i.id}`)).toMatchObject({ status: 'paid', payment_id: p.id, provider_txn_id: 'TXN-1', fee_satang: 500, paid_at: '2026-10-08T07:00:00.000Z' });
    });

    it('fines settle the same way', async () => {
        const i = await intentFor('fine', 'f1');
        await hook(paid(i));
        expect(read(`${BASE}/fines/f1`)).toMatchObject({ status: 'paid', allocated_satang: 20000 });
        expect(payments()[0].allocations).toEqual([{ target_kind: 'fine', target_id: 'f1', amount_satang: 20000 }]);
    });

    it('the same webhook delivered again, or the same payment under a new event id, is applied once', async () => {
        const i = await intentFor();
        const ev = paid(i, { event_id: 'evt-fixed' });
        await hook(ev);
        const again = await hook(ev);
        expect(again.body.outcome).toBe('ignored');
        const renamed = await hook(paid(i, { event_id: 'evt-other' }));
        expect(renamed.body).toMatchObject({ outcome: 'ignored' });
        expect(payments()).toHaveLength(1);
        expect(read(`${BASE}/bills/b1`)!.allocated_satang).toBe(350000);
    });

    it('a wrong amount is never applied: short or over goes to review and the owner is told', async () => {
        const i = await intentFor();
        for (const amount of [300000, 400000]) {
            const r = await hook(paid(i, { amount_satang: amount }));
            expect(r.body.outcome).toBe('review');
            expect(read(`${BASE}/payment_intents/${i.id}`)).toMatchObject({ status: 'needs_review', received_satang: amount, failure_reason: 'amount_mismatch' });
            seed(`${BASE}/payment_intents/${i.id}`, { ...read(`${BASE}/payment_intents/${i.id}`)!, status: 'pending' }); // reset for the next amount
        }
        expect(read(`${BASE}/bills/b1`)!.payment_status).toBe('unpaid');
        expect(payments()).toHaveLength(0);
        const notes = listPaths(`${BASE}/notifications/`).map(p => read(p)!);
        expect(notes.some(n => n.event === 'payment.needs_review')).toBe(true);
    });

    it('money that arrives after the QR expired still settles; after cancellation it goes to review', async () => {
        const late = await intentFor();
        seed(`${BASE}/payment_intents/${late.id}`, { ...read(`${BASE}/payment_intents/${late.id}`)!, status: 'expired' });
        expect((await hook(paid(late))).body.outcome).toBe('settled');

        const gone = await intentFor('fine', 'f1');
        await call(OWNER, { action: 'cancel_intent', intent_id: gone.id });
        const r = await hook(paid(gone));
        expect(r.body.outcome).toBe('review');
        expect(read(`${BASE}/fines/f1`)!.status).toBe('unpaid');
    });

    it('if the document was paid another way in the meantime, nothing is applied twice — the owner reviews it', async () => {
        const i = await intentFor();
        seed(`${BASE}/bills/b1`, { ...read(`${BASE}/bills/b1`)!, allocated_satang: 100000, payments_recorded: true }); // 1,000 baht paid by cash meanwhile
        const r = await hook(paid(i));
        expect(r.body).toMatchObject({ outcome: 'review', reason: 'target_changed' });
        expect(payments()).toHaveLength(0);
        expect(read(`${BASE}/bills/b1`)!.allocated_satang).toBe(100000);
    });

    it('failed and expired events close the request; a refund after payment marks it refunded', async () => {
        const a = await intentFor();
        expect((await hook(paid(a, { status: 'failed', amount_satang: 0 }))).body).toMatchObject({ outcome: 'marked', status: 'failed' });
        const b = await intentFor('fine', 'f1');
        expect((await hook(paid(b, { status: 'expired', amount_satang: 0 }))).body).toMatchObject({ outcome: 'marked', status: 'expired' });
        await hook(paid(b)); // paid late
        expect((await hook(paid(b, { status: 'refunded', amount_satang: 20000 }))).body).toMatchObject({ outcome: 'marked', status: 'refunded' });
    });

    it('an event for another provider\'s intent is ignored', async () => {
        const i = await intentFor();
        seed(`${BASE}/payment_intents/${i.id}`, { ...read(`${BASE}/payment_intents/${i.id}`)!, provider: 'someone-else' });
        expect((await hook(paid(i))).body).toMatchObject({ outcome: 'ignored' });
        expect(payments()).toHaveLength(0);
    });

    it('a failure after verification is a 500 (so the provider retries) and the retry then succeeds', async () => {
        const i = await intentFor();
        seed(`${BASE}/bills/b1`, { ...read(`${BASE}/bills/b1`)!, room_id: 'r1' });
        const realRun = (await import('./_fake-firestore.js')).db.runTransaction;
        const dbMod = (await import('./_fake-firestore.js')).db as { runTransaction: unknown };
        dbMod.runTransaction = async () => { throw new Error('firestore down'); };
        const ev = paid(i, { event_id: 'evt-retry' });
        try {
            expect((await hook(ev)).statusCode).toBe(500);
        } finally { dbMod.runTransaction = realRun; }
        expect((await hook(ev)).body.outcome).toBe('settled'); // the claim was released, so the retry is not mistaken for a duplicate
    });
});

describe('collection charges (hotel / market)', () => {
    const makeCharge = () => {
        sb.seed('charges', { id: 'c1', owner_uid: OWNER, building_id: B, kind: 'stay', room_id: 'r1', room_number: '101', party_name: 'สมชาย', period_start: '2026-10-10', period_end: '2026-10-11', description: 'ค่าห้อง 101', amount_satang: 200000, paid_satang: 50000, dedupe_key: 'stay:x', created_at: '2026-10-01T00:00:00Z', status: 'open' });
    };
    it('settles through the same atomic payment as cash, as a verified gateway payment', async () => {
        makeCharge();
        const i = await intentFor('charge', 'c1');
        expect(i.amount_satang).toBe(150000);
        const r = await hook(paid(i, { txn_id: 'TXN-C1' }));
        expect(r.body.outcome).toBe('settled');
        expect(sb.rows('charges')[0]).toMatchObject({ paid_satang: 200000, status: 'paid' });
        expect(sb.rows('charge_payments')[0]).toMatchObject({ amount_satang: 150000, method: 'transfer', bank_account_id: 'gateway:sandbox', verification: 'verified', slip_ref: 'gw:sandbox:TXN-C1' });
        expect((await hook(paid(i, { txn_id: 'TXN-C1' }))).body.outcome).toBe('ignored');
        expect(sb.rows('charge_payments')).toHaveLength(1);
    });

    it('is booked to the ledger\'s gateway account as soon as it is settled', async () => {
        makeCharge();
        const l = emptyLedger('L1');
        l.name = 'Resort'; l.legal_entity_name = 'Resort Co'; l.property_ids = [B];
        seed(`users/${OWNER}/ledgers/L1`, { ...l, created_at: 'x', updated_at: 'x' });
        const i = await intentFor('charge', 'c1');
        await hook(paid(i));
        const entries = listPaths(`users/${OWNER}/ledgers/L1/entries/`).map(p => read(p)!);
        const receipt = entries.find(e => e.kind === 'receipt') as { lines: { account: string; dr_satang: number }[] } | undefined;
        expect(receipt).toBeTruthy();
        expect(receipt!.lines.some(x => x.account === '1103' && x.dr_satang === 150000)).toBe(true);
    });

    it('a charge that was voided meanwhile goes to review', async () => {
        makeCharge();
        const i = await intentFor('charge', 'c1');
        sb.rows('charges')[0].status = 'void';
        expect((await hook(paid(i))).body.outcome).toBe('review');
        expect(sb.rows('charge_payments')).toHaveLength(0);
    });
});
