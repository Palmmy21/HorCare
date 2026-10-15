/**
 * Protection for endpoints anyone on the internet can call (a stall's portal link, the market's walk-in link):
 *
 *  • rateLimit   – a per-visitor counter in Firestore (fixed window). Cheap, needs no extra service, and survives
 *                  serverless cold starts because the count lives in the database, not in memory.
 *  • honeypot    – a hidden form field that people never fill in and simple bots do.
 *  • verifyCaptcha – Cloudflare Turnstile, switched on by setting TURNSTILE_SECRET (and VITE_TURNSTILE_SITE_KEY for the
 *                  form). With no secret set it is skipped, so nothing breaks before it is configured.
 *
 * The visitor is identified by a hash of their IP, so no address is stored. Counter documents carry `expires_at`; add a
 * Firestore TTL policy on that field of the `rate_limits` collection group to have them cleaned up automatically.
 */
import { createHash } from 'node:crypto';
import type { VercelRequest } from '@vercel/node';
import { db } from './_firebase.js';
import { clientIp } from './_audit.js';

export interface LimitResult { ok: boolean; retryAfterSec: number }

/** Allow `limit` calls per `windowSec` for one visitor (by IP) and one named bucket. Fails open if the counter itself breaks. */
export function rateLimit(req: VercelRequest, bucket: string, limit: number, windowSec: number, now: number = Date.now()): Promise<LimitResult> {
    return rateLimitBy(clientIp(req) ?? 'unknown', bucket, limit, windowSec, now);
}

/** The same counter for any identity (an IP, a LINE user id…). The identity is hashed, never stored. */
export async function rateLimitBy(identity: string, bucket: string, limit: number, windowSec: number, now: number = Date.now()): Promise<LimitResult> {
    try {
        const windowMs = windowSec * 1000;
        const slot = Math.floor(now / windowMs);
        const who = createHash('sha256').update(`${identity}|${bucket}`).digest('hex').slice(0, 32);
        const ref = db.doc(`rate_limits/${who}_${slot}`);
        const count = await db.runTransaction(async tx => {
            const snap = await (tx as { get: (r: unknown) => Promise<{ exists: boolean; data: () => { count?: number } | undefined }> }).get(ref);
            const next = (snap.exists ? snap.data()?.count ?? 0 : 0) + 1;
            (tx as { set: (r: unknown, d: object) => void }).set(ref, { bucket, count: next, expires_at: new Date((slot + 2) * windowMs).toISOString() });
            return next;
        });
        return count > limit ? { ok: false, retryAfterSec: Math.max(1, Math.ceil(((slot + 1) * windowMs - now) / 1000)) } : { ok: true, retryAfterSec: 0 };
    } catch (e) {
        // a broken counter must not take the public form down; the per-day caps in the handlers still apply
        console.error('rateLimit failed open', e);
        return { ok: true, retryAfterSec: 0 };
    }
}

/** True when a hidden field that real people never see has been filled in. */
export const honeypotTripped = (value: unknown): boolean => typeof value === 'string' && value.trim() !== '';

/** Cloudflare Turnstile. Skipped (true) when no secret is configured. */
export async function verifyCaptcha(token: unknown, req: VercelRequest, fetchImpl: typeof fetch = fetch): Promise<boolean> {
    const secret = process.env.TURNSTILE_SECRET;
    if (!secret) return true;
    if (typeof token !== 'string' || token.length < 10 || token.length > 4096) return false;
    try {
        const r = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ secret, response: token, ...(clientIp(req) ? { remoteip: clientIp(req)! } : {}) }).toString(),
        });
        const data = (await r.json()) as { success?: boolean };
        return data.success === true;
    } catch {
        return false;
    }
}
