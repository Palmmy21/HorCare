import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { db } from './_firebase.js';
import { errorInfo } from '../src/shared/errorInfo.js';

export const config = {
    api: {
        bodyParser: false,
    },
};

async function getRawBody(req: VercelRequest): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks);
}

function getStripe(): Stripe {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY not set');
    return new Stripe(key);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
        console.error('STRIPE_WEBHOOK_SECRET not set');
        res.status(500).send('Webhook secret not configured');
        return;
    }

    const stripe = getStripe();
    const sig = req.headers['stripe-signature'] as string;
    
    let event: Stripe.Event;
    try {
        const rawBody = await getRawBody(req);
        event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch (errRaw) {
        const err = errorInfo(errRaw);
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error('Webhook signature verification failed:', message);
        res.status(400).send(`Webhook Error: ${message}`);
        return;
    }

    console.log(`Received Stripe event: ${event.type}`);

    try {
        switch (event.type) {
            // PromptPay can confirm after the session completes: the grant happens on whichever event sees it paid.
            case 'checkout.session.completed':
            case 'checkout.session.async_payment_succeeded': {
                const session = event.data.object as Stripe.Checkout.Session;
                await handleCheckoutPaid(session, event.id);
                break;
            }
            default:
                console.log(`Unhandled event type: ${event.type}`);
        }
    } catch (err) {
        // Not granted yet: answer with an error so Stripe retries the event (the grant is idempotent per session).
        console.error('Error handling event', event.id, err);
        res.status(500).json({ received: false });
        return;
    }

    res.json({ received: true });
}

/** Adds one billing cycle to `fromMs`, keeping the day of month where it exists (Jan 31 → Feb 28/29, never Mar 3). */
export function addCycle(fromMs: number, cycle: string): number {
    const d = new Date(fromMs);
    const day = d.getUTCDate();
    const months = cycle === 'yearly' ? 12 : 1;
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + months);
    const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, lastDay));
    return d.getTime();
}

/**
 * New expiry after paying for one cycle: renewing early keeps the days already paid for, so the cycle is added to
 * whichever is later — now or the current expiry.
 */
export function nextAccessUntil(currentAccessUntil: unknown, now: number, cycle: string): number {
    const current = typeof currentAccessUntil === 'number' && Number.isFinite(currentAccessUntil) ? currentAccessUntil : 0;
    return addCycle(Math.max(now, current), cycle);
}

export async function handleCheckoutPaid(session: Stripe.Checkout.Session, eventId: string, now = Date.now()) {
    const uid   = session.metadata?.uid;
    const plan  = session.metadata?.plan;
    const cycle = session.metadata?.cycle;

    if (!uid || !plan || !cycle) {
        // retrying can't fix missing metadata — log it and acknowledge
        console.error('Missing metadata in checkout session', session.id);
        return;
    }
    if (session.payment_status !== 'paid') {
        console.log(`Checkout ${session.id} not paid yet (${session.payment_status}); waiting for async_payment_succeeded`);
        return;
    }

    const licenseType = `${cycle}_${plan}`;
    const paymentIntentId = typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id ?? '';

    const userRef = db.collection('users').doc(uid);
    // One record per checkout session: a redelivered or second event for the same payment never extends access again.
    const grantRef = db.collection('stripe_checkouts').doc(session.id);

    await db.runTransaction(async tx => {
        const grantSnap = await tx.get(grantRef);
        if (grantSnap.exists) {
            console.log(`Checkout ${session.id} already granted; ignoring event ${eventId}`);
            return;
        }
        const userSnap = await tx.get(userRef);
        if (!userSnap.exists) throw new Error(`user ${uid} not found for checkout ${session.id}`);
        const user = userSnap.data() ?? {};

        const record = {
            uid, plan, cycle, event_id: eventId, payment_intent: paymentIntentId,
            amount_total: session.amount_total ?? null, currency: session.currency ?? null,
            access_until_before: user.access_until ?? null,
            processed_at: new Date(now).toISOString(),
        };

        // A lifetime licence is never downgraded by a later one-time purchase; the payment is still recorded.
        if (user.license === 'active') {
            tx.set(grantRef, { ...record, access_until_after: null, note: 'lifetime licence kept' });
            return;
        }

        const accessUntil = nextAccessUntil(user.access_until, now, cycle);
        tx.update(userRef, {
            license: licenseType,
            plan_name: plan,
            billing_cycle: cycle,
            subscription_status: 'active',
            current_period_end: new Date(accessUntil).toISOString(),
            access_until: accessUntil, // server-enforced expiry (Firestore rules)
            last_payment_intent: paymentIntentId,
        });
        tx.set(grantRef, { ...record, access_until_after: accessUntil });
    });
}

