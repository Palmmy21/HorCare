import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);
// the signature check is Stripe's job; here the raw body is the event itself
vi.mock('stripe', () => ({
    default: class {
        webhooks = { constructEvent: (body: Buffer) => JSON.parse(body.toString()) };
    },
}));

import webhook, { addCycle, handleCheckoutPaid, nextAccessUntil } from './stripe-webhook.js';
import { fakeRes, read, resetFake, seed } from './_fake-firestore.js';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 20); // 20 Oct 2026

function session(over: Record<string, unknown> = {}) {
    return { id: 'cs_1', payment_status: 'paid', payment_intent: 'pi_1', amount_total: 49900, currency: 'thb', metadata: { uid: 'u1', plan: 'pro', cycle: 'monthly' }, ...over } as never;
}

function post(event: object) {
    const req = Readable.from([Buffer.from(JSON.stringify(event))]) as unknown as Record<string, unknown>;
    req.method = 'POST';
    req.headers = { 'stripe-signature': 'sig' };
    return req as never;
}

beforeEach(() => {
    resetFake();
    process.env.STRIPE_SECRET_KEY = 'sk_test';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec';
});

describe('addCycle', () => {
    it('keeps the day of month, clamping to the last day', () => {
        expect(new Date(addCycle(Date.UTC(2026, 0, 31), 'monthly')).toISOString().slice(0, 10)).toBe('2026-02-28');
        expect(new Date(addCycle(Date.UTC(2028, 0, 31), 'monthly')).toISOString().slice(0, 10)).toBe('2028-02-29');
        expect(new Date(addCycle(Date.UTC(2028, 1, 29), 'yearly')).toISOString().slice(0, 10)).toBe('2029-02-28');
        expect(new Date(addCycle(Date.UTC(2026, 11, 15), 'monthly')).toISOString().slice(0, 10)).toBe('2027-01-15');
    });
});

describe('nextAccessUntil', () => {
    it('renewing early extends from the current expiry, not from today', () => {
        const oct30 = Date.UTC(2026, 9, 30);
        expect(new Date(nextAccessUntil(oct30, NOW, 'monthly')).toISOString().slice(0, 10)).toBe('2026-11-30');
    });
    it('an expired or free plan starts from today', () => {
        expect(nextAccessUntil(NOW - 5 * DAY, NOW, 'monthly')).toBe(Date.UTC(2026, 10, 20));
        expect(nextAccessUntil(0, NOW, 'yearly')).toBe(Date.UTC(2027, 9, 20));
        expect(nextAccessUntil(undefined, NOW, 'monthly')).toBe(Date.UTC(2026, 10, 20));
    });
});

describe('handleCheckoutPaid', () => {
    it('grants once per checkout session, extending the existing period', async () => {
        seed('users/u1', { license: 'monthly_pro', access_until: Date.UTC(2026, 9, 30) });
        await handleCheckoutPaid(session(), 'evt_1', NOW);
        expect(read('users/u1')?.access_until).toBe(Date.UTC(2026, 10, 30));
        expect(read('stripe_checkouts/cs_1')?.event_id).toBe('evt_1');

        // the same payment delivered again (retry, or the async event) must not add another month
        await handleCheckoutPaid(session(), 'evt_2', NOW + 3 * DAY);
        expect(read('users/u1')?.access_until).toBe(Date.UTC(2026, 10, 30));
    });

    it('waits for the money when the session is not paid yet', async () => {
        seed('users/u1', { license: 'free', access_until: 0 });
        await handleCheckoutPaid(session({ payment_status: 'unpaid' }), 'evt_1', NOW);
        expect(read('users/u1')?.access_until).toBe(0);
        expect(read('stripe_checkouts/cs_1')).toBeUndefined();
    });

    it('never downgrades a lifetime licence', async () => {
        seed('users/u1', { license: 'active', access_until: 0 });
        await handleCheckoutPaid(session(), 'evt_1', NOW);
        expect(read('users/u1')?.license).toBe('active');
        expect(read('stripe_checkouts/cs_1')?.note).toBe('lifetime licence kept');
    });
});

describe('webhook handler', () => {
    it('acknowledges a handled event', async () => {
        seed('users/u1', { license: 'free', access_until: 0 });
        const res = fakeRes();
        await webhook(post({ id: 'evt_1', type: 'checkout.session.completed', data: { object: session() } }), res as never);
        expect(res.statusCode).toBe(0); // res.json without status → 200
        expect(res.body).toEqual({ received: true });
        expect(read('users/u1')?.license).toBe('monthly_pro');
    });

    it('answers 500 when access could not be granted, so Stripe retries', async () => {
        // no users/u1 document: the grant fails
        const res = fakeRes();
        await webhook(post({ id: 'evt_1', type: 'checkout.session.completed', data: { object: session() } }), res as never);
        expect(res.statusCode).toBe(500);
        expect(res.body).toEqual({ received: false });
        expect(read('stripe_checkouts/cs_1')).toBeUndefined();
    });
});
