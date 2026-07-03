import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { db, admin } from './_firebase.js';

function getStripe(): Stripe {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY not set');
    return new Stripe(key);
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

        const { plan, cycle, promoCode } = req.body.data || req.body;
        if (!plan || !cycle) {
            res.status(400).json({ error: 'Missing plan or cycle' });
            return;
        }

        const licenseKey = `${cycle}_${plan}`;

        // PromptPay (QR) รองรับเฉพาะจ่ายครั้งเดียว จึงคิดราคาเป็นยอดต่อรอบแบบ one-time
        // (ไม่ใช้ recurring Price ID เพราะ payment mode ใช้ราคาแบบ subscription ไม่ได้)
        const PLAN_NAMES_TH: Record<string, string> = {
            small: 'หอเล็ก', medium: 'หอกลาง', large: 'หอใหญ่',
        };
        const AMOUNTS: Record<string, number> = {
            monthly_small:  79,  yearly_small:  790,
            monthly_medium: 259, yearly_medium: 1590,
            monthly_large:  399, yearly_large:  2590,
        };

        const amount = AMOUNTS[licenseKey];
        if (!amount) {
            res.status(400).json({ error: `ไม่พบราคาสำหรับ ${licenseKey}` });
            return;
        }

        const stripe = getStripe();
        const appUrl = process.env.APP_URL ?? 'https://horcare.app';

        // Fetch or create Stripe customer
        const userDoc = await db.collection('users').doc(uid).get();
        const userData = userDoc.data() ?? {};
        let customerId: string = userData.stripe_customer_id ?? '';

        // Verify existing customer is valid in current mode (test vs live IDs differ).
        // Only reset on 404/resource_missing — re-throw network errors, rate-limits, etc.
        if (customerId) {
            try {
                await stripe.customers.retrieve(customerId);
            } catch (err: any) {
                if (err?.statusCode === 404 || err?.code === 'resource_missing') {
                    customerId = '';
                } else {
                    throw err;
                }
            }
        }

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

        const cycleLabel = cycle === 'monthly' ? 'รายเดือน' : 'รายปี';

        // ── Promo code validation & apply ──────────────────────────────────
        // Only allow promo codes on Plus (medium) and Pro (large) plans.
        // Stripe enforces max_redemptions_per_customer=1 at the promotion-code level.
        let discounts: { promotion_code: string }[] | undefined;
        if (promoCode && typeof promoCode === 'string') {
            const code = promoCode.trim().toUpperCase();
            // Reject promo codes on Start (small) plan
            if (plan === 'small') {
                res.status(400).json({ error: 'โปรโมชันนี้ไม่สามารถใช้กับแพ็กเกจ Start ได้' });
                return;
            }
            // Look up active promotion codes matching the code string
            const promoCodes = await stripe.promotionCodes.list({
                code,
                active: true,
                limit: 1,
            });
            if (promoCodes.data.length === 0) {
                res.status(400).json({ error: 'โค้ดส่วนลดไม่ถูกต้องหรือหมดอายุแล้ว' });
                return;
            }
            discounts = [{ promotion_code: promoCodes.data[0].id }];
        }
        // ────────────────────────────────────────────────────────────────────

        const sessionParams: Stripe.Checkout.SessionCreateParams = {
            customer: customerId,
            mode: 'payment',
            payment_method_types: ['promptpay', 'card'],
            line_items: [{
                price_data: {
                    currency: 'thb',
                    product_data: {
                        name: `HorCare ${PLAN_NAMES_TH[plan]} (${cycleLabel})`,
                    },
                    unit_amount: amount * 100, // satang
                },
                quantity: 1,
            }],
            success_url: `${appUrl}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${appUrl}?payment=cancel`,
            metadata: { uid, plan, cycle },
            locale: 'th',
            // If promo code was supplied, apply it directly (no manual input field needed).
            // Otherwise show the promotion code input box on the Stripe page.
            ...(discounts ? { discounts } : { allow_promotion_codes: true }),
        };

        const session = await stripe.checkout.sessions.create(sessionParams);

        res.status(200).json({ data: { url: session.url } });
    } catch (error: any) {
        console.error('Create checkout error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}
