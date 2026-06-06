import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { db, admin } from './_firebase';

function getStripe(): Stripe {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY not set');
    return new Stripe(key, { apiVersion: '2024-06-20' });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // CORS configuration
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');
    
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            res.status(401).json({ error: 'unauthenticated' });
            return;
        }
        
        const idToken = authHeader.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const uid = decodedToken.uid;

        const { plan, cycle } = req.body.data || req.body;
        if (!plan || !cycle) {
            res.status(400).json({ error: 'Missing plan or cycle' });
            return;
        }

        const licenseKey = `${cycle}_${plan}`;
        
        const PRICE_IDS: Record<string, string> = {
            monthly_small:  process.env.STRIPE_PRICE_MONTHLY_SMALL  ?? '',
            monthly_medium: process.env.STRIPE_PRICE_MONTHLY_MEDIUM ?? '',
            monthly_large:  process.env.STRIPE_PRICE_MONTHLY_LARGE  ?? '',
            yearly_small:   process.env.STRIPE_PRICE_YEARLY_SMALL   ?? '',
            yearly_medium:  process.env.STRIPE_PRICE_YEARLY_MEDIUM  ?? '',
            yearly_large:   process.env.STRIPE_PRICE_YEARLY_LARGE   ?? '',
        };

        const priceId = PRICE_IDS[licenseKey];
        if (!priceId) {
            res.status(400).json({ error: `ไม่พบ Price ID สำหรับ ${licenseKey}` });
            return;
        }

        const stripe = getStripe();
        const appUrl = process.env.APP_URL ?? 'https://horcare.app';

        // Fetch or create Stripe customer
        const userDoc = await db.collection('users').doc(uid).get();
        const userData = userDoc.data() ?? {};
        let customerId: string = userData.stripe_customer_id ?? '';

        if (!customerId) {
            const customer = await stripe.customers.create({
                email: userData.email,
                name: userData.display_name,
                metadata: { uid },
            });
            customerId = customer.id;
            await db.collection('users').doc(uid).update({
                stripe_customer_id: customerId,
            });
        }

        const session = await stripe.checkout.sessions.create({
            customer: customerId,
            mode: 'subscription',
            line_items: [{ price: priceId, quantity: 1 }],
            success_url: `${appUrl}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${appUrl}?payment=cancel`,
            metadata: { uid, plan, cycle },
            subscription_data: {
                metadata: { uid, plan, cycle },
            },
            currency: 'thb',
            locale: 'th',
            allow_promotion_codes: true,
        });

        res.status(200).json({ data: { url: session.url } });
    } catch (error: any) {
        console.error('Create checkout error:', error);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
}
