/**
 * A pretend payment provider, for developing and testing the gateway plumbing end to end without any real money.
 * Switched on by setting PAYMENT_GATEWAY_SANDBOX_SECRET; never registered otherwise, so it cannot exist in production
 * unless someone deliberately configures it.
 *
 * Webhook format (also what tests send):
 *   header  x-sandbox-signature: hex HMAC-SHA256(secret, rawBody)
 *   body    {"event_id","reference","status":"paid|failed|expired|refunded","amount_satang","paid_at?","txn_id?","fee_satang?"}
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { REFERENCE_RE, type PaymentProvider, type ProviderEvent } from '../../src/shared/paymentGateway.js';

export const SANDBOX_SIGNATURE_HEADER = 'x-sandbox-signature';

export function signSandbox(secret: string, rawBody: Uint8Array | string): string {
    return createHmac('sha256', secret).update(rawBody).digest('hex');
}

const header = (h: Record<string, string | string[] | undefined>, name: string): string => {
    const v = h[name];
    return (Array.isArray(v) ? v[0] : v) ?? '';
};

export function sandboxProvider(secret: string): PaymentProvider {
    return {
        id: 'sandbox',
        label: 'Sandbox (ทดสอบ ไม่มีเงินจริง)',
        async createCharge(req) {
            return { provider_ref: `sbx_${req.intent_id}`, qr_payload: `SANDBOX|${req.reference}|${req.amount_satang}`, pay_url: null };
        },
        verifyWebhook(rawBody, headers) {
            const given = header(headers, SANDBOX_SIGNATURE_HEADER);
            const expected = signSandbox(secret, rawBody);
            const a = Buffer.from(given, 'utf8'), b = Buffer.from(expected, 'utf8');
            if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('bad_signature');

            let body: Record<string, unknown>;
            try { body = JSON.parse(Buffer.from(rawBody).toString('utf8')) as Record<string, unknown>; } catch { throw new Error('malformed'); }
            if (body.event_id === 'heartbeat') return null;
            const status = body.status;
            if (typeof body.event_id !== 'string' || !body.event_id || body.event_id.length > 100
                || typeof body.reference !== 'string' || !REFERENCE_RE.test(body.reference)
                || (status !== 'paid' && status !== 'failed' && status !== 'expired' && status !== 'refunded')
                || !Number.isInteger(body.amount_satang) || (body.amount_satang as number) < 0) throw new Error('malformed');
            const ev: ProviderEvent = { event_id: body.event_id, reference: body.reference, status, amount_satang: body.amount_satang as number };
            if (typeof body.paid_at === 'string' && !Number.isNaN(Date.parse(body.paid_at))) ev.paid_at = new Date(body.paid_at).toISOString();
            if (typeof body.txn_id === 'string' && body.txn_id.length <= 100) ev.provider_txn_id = body.txn_id;
            if (Number.isInteger(body.fee_satang) && (body.fee_satang as number) >= 0) ev.fee_satang = body.fee_satang as number;
            return ev;
        },
    };
}
