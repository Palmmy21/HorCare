import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { db } from './_firebase.js';

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

    // จ่ายแบบ one-time (PromptPay/บัตร) — คำนวณวันหมดอายุจากรอบบิลเอง
    const periodEnd = new Date();
    if (cycle === 'yearly') {
        periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    } else {
        periodEnd.setMonth(periodEnd.getMonth() + 1);
    }

    const paymentIntentId = typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id ?? '';

    await db.collection('users').doc(uid).update({
        license: licenseType,
        plan_name: plan,
        billing_cycle: cycle,
        subscription_status: 'active',
        current_period_end: periodEnd.toISOString(),
        last_payment_intent: paymentIntentId,
    });
}

