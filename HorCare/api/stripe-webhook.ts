import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { db, admin } from './_firebase';

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
    return new Stripe(key, { apiVersion: '2024-06-20' });
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
    } catch (err: any) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error('Webhook signature verification failed:', message);
        res.status(400).send(`Webhook Error: ${message}`);
        return;
    }

    console.log(`Received Stripe event: ${event.type}`);

    try {
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object as Stripe.Checkout.Session;
                await handleCheckoutCompleted(session);
                break;
            }
            case 'customer.subscription.updated': {
                const sub = event.data.object as Stripe.Subscription;
                await handleSubscriptionUpdated(sub);
                break;
            }
            case 'customer.subscription.deleted': {
                const sub = event.data.object as Stripe.Subscription;
                await handleSubscriptionDeleted(sub);
                break;
            }
            case 'invoice.payment_failed': {
                const invoice = event.data.object as Stripe.Invoice;
                await handlePaymentFailed(invoice);
                break;
            }
            default:
                console.log(`Unhandled event type: ${event.type}`);
        }
    } catch(err) {
        console.error('Error handling event', err);
    }

    res.json({ received: true });
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
    const uid   = session.metadata?.uid;
    const plan  = session.metadata?.plan;
    const cycle = session.metadata?.cycle;

    if (!uid || !plan || !cycle) {
        console.error('Missing metadata in checkout session', session.id);
        return;
    }

    const licenseType = `${cycle}_${plan}`;
    const subId = typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription?.id ?? '';

    const stripe = getStripe();
    const sub = await stripe.subscriptions.retrieve(subId);
    const periodEnd = new Date(sub.current_period_end * 1000).toISOString();

    await db.collection('users').doc(uid).update({
        license: licenseType,
        plan_name: plan,
        billing_cycle: cycle,
        subscription_id: subId,
        subscription_status: 'active',
        current_period_end: periodEnd,
    });
}

async function handleSubscriptionUpdated(sub: Stripe.Subscription) {
    const uid = sub.metadata?.uid;
    if (!uid) return;

    const periodEnd = new Date(sub.current_period_end * 1000).toISOString();
    await db.collection('users').doc(uid).update({
        subscription_status: sub.status,
        current_period_end: periodEnd,
    });
}

async function handleSubscriptionDeleted(sub: Stripe.Subscription) {
    const uid = sub.metadata?.uid;
    if (!uid) return;

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    await db.collection('users').doc(uid).update({
        license: 'trial',
        plan_name: admin.firestore.FieldValue.delete(),
        billing_cycle: admin.firestore.FieldValue.delete(),
        subscription_id: admin.firestore.FieldValue.delete(),
        subscription_status: 'canceled',
        trial_expires_at: yesterday.toISOString(),
    });
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
    const customerId = typeof invoice.customer === 'string'
        ? invoice.customer
        : invoice.customer?.id;
    if (!customerId) return;

    const snap = await db.collection('users')
        .where('stripe_customer_id', '==', customerId)
        .limit(1)
        .get();

    if (snap.empty) return;
    const uid = snap.docs[0].id;

    await db.collection('users').doc(uid).update({
        subscription_status: 'past_due',
    });
}
