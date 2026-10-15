/**
 * Payment-gateway webhook: /api/payment-webhook?provider=<id>
 *
 * Providers call this when money moves. The body is read RAW (the signature covers the exact bytes), handed to the
 * provider's own verifier, and only a verified event is applied (api/_payment-gateway.ts, settleEvent).
 *
 *   401  signature wrong / provider unknown or not configured   → the provider must not retry blindly
 *   400  body malformed
 *   200  verified: applied, ignored as already done, or sent to review — retries are pointless either way
 *   500  something broke on our side after verification         → the provider should retry; the event claim is released
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getProvider } from './_gateway-registry.js';
import { settleEvent } from './_payment-gateway.js';
import { rateLimit } from './_abuse-guard.js';

export const config = {
    api: { bodyParser: false },
    maxDuration: 30,
};

const MAX_BODY = 64 * 1024;

async function rawBody(req: VercelRequest): Promise<Buffer | null> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
        const b = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
        size += b.length;
        if (size > MAX_BODY) return null;
        chunks.push(b);
    }
    return Buffer.concat(chunks);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const q = req.query?.provider;
    const provider = getProvider(Array.isArray(q) ? q[0] : q);
    if (!provider) { res.status(401).json({ error: 'unknown_provider' }); return; }

    // bad signatures are the only thing worth guessing at, so a flood of them is cut off early
    if (!(await rateLimit(req, `payment-webhook:${provider.id}`, 600, 60)).ok) { res.status(429).json({ error: 'too_many_requests' }); return; }

    const raw = await rawBody(req);
    if (!raw) { res.status(413).json({ error: 'too_large' }); return; }

    let event;
    try {
        event = provider.verifyWebhook(raw, req.headers);
    } catch (e) {
        const bad = (e as Error).message === 'malformed';
        res.status(bad ? 400 : 401).json({ error: bad ? 'malformed' : 'bad_signature' });
        return;
    }
    if (!event) { res.status(200).json({ ok: true }); return; }

    try {
        const result = await settleEvent(provider, event);
        res.status(200).json({ ok: true, ...result });
    } catch (e) {
        console.error('[payment-webhook] settle failed', (e as Error).message);
        res.status(500).json({ error: 'internal_error' });
    }
}