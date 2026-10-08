import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import handler from './_market.js';
import { honeypotTripped, rateLimit, verifyCaptcha } from './_abuse-guard.js';
import { fakeReq, fakeRes, listPaths, resetFake, seed } from './_fake-firestore.js';
import { addDays, todayTh } from '../src/shared/market.js';

const OWNER = 'owner-1';
const BLD = 'bld-1';
const B = `users/${OWNER}/buildings/${BLD}`;
const d = (n: number) => addDays(todayTh(), n);

beforeEach(() => {
    resetFake();
    delete process.env.TURNSTILE_SECRET;
    seed(`users/${OWNER}`, { uid: OWNER });
    seed(B, { id: BLD });
    seed(`${B}/data/config`, { building_type: 'market' });
    seed(`${B}/rooms/s1`, { id: 's1', room_number: 'A01' });
});

async function call(body: Record<string, unknown>) {
    const res = fakeRes();
    await handler(fakeReq({ owner_uid: OWNER, building_id: BLD, ...body }), res as never);
    return res as { statusCode: number; body: any };
}
const walkin = (i: number, over: Record<string, unknown> = {}) =>
    call({ action: 'walkin_submit', date: d(1), name: `ผู้ขาย ${i}`, phone: `08123456${String(10 + i).padStart(2, '0')}`, goods: 'ผลไม้', ...over });

describe('rateLimit', () => {
    const req = (ip: string) => ({ headers: { 'x-forwarded-for': ip }, socket: {} }) as never;

    it('lets a visitor through up to the limit, then says how long to wait', async () => {
        const t0 = Date.UTC(2026, 9, 8, 10, 0, 0);
        for (let i = 0; i < 3; i++) expect((await rateLimit(req('1.1.1.1'), 'x', 3, 3600, t0)).ok).toBe(true);
        const blocked = await rateLimit(req('1.1.1.1'), 'x', 3, 3600, t0 + 1000);
        expect(blocked.ok).toBe(false);
        expect(blocked.retryAfterSec).toBeGreaterThan(0);
        expect(blocked.retryAfterSec).toBeLessThanOrEqual(3600);
    });

    it('counts visitors and buckets separately, and starts over in the next window', async () => {
        const t0 = Date.UTC(2026, 9, 8, 10, 0, 0);
        await rateLimit(req('1.1.1.1'), 'x', 1, 3600, t0);
        expect((await rateLimit(req('2.2.2.2'), 'x', 1, 3600, t0)).ok).toBe(true);
        expect((await rateLimit(req('1.1.1.1'), 'y', 1, 3600, t0)).ok).toBe(true);
        expect((await rateLimit(req('1.1.1.1'), 'x', 1, 3600, t0)).ok).toBe(false);
        expect((await rateLimit(req('1.1.1.1'), 'x', 1, 3600, t0 + 3_600_000)).ok).toBe(true);
    });

    it('stores a hash of the address, never the address, and an expiry for cleanup', async () => {
        await rateLimit(req('9.9.9.9'), 'x', 5, 60, Date.UTC(2026, 9, 8));
        const paths = listPaths('rate_limits/');
        expect(paths).toHaveLength(1);
        expect(paths[0]).not.toContain('9.9.9.9');
    });
});

describe('the public market forms', () => {
    it('stop one visitor flooding walk-in requests, with a 429 and a wait time', async () => {
        for (let i = 0; i < 5; i++) expect((await walkin(i)).statusCode).toBe(200);
        const r = await walkin(6);
        expect(r.statusCode).toBe(429);
        expect(r.body.error).toBe('too_many_requests');
        expect(r.body.retry_after_sec).toBeGreaterThan(0);
        expect(listPaths(`${B}/walk_ins/`)).toHaveLength(5);
    });

    it('a filled hidden field looks like success but stores nothing', async () => {
        const r = await walkin(1, { website: 'http://spam.example' });
        expect(r.statusCode).toBe(200);
        expect(listPaths(`${B}/walk_ins/`)).toHaveLength(0);
        expect(honeypotTripped('')).toBe(false);
        expect(honeypotTripped(undefined)).toBe(false);
        expect(honeypotTripped(' x ')).toBe(true);
    });

    it('reading is looser than writing, and a closure request is limited too', async () => {
        for (let i = 0; i < 20; i++) expect((await call({ action: 'closure_list', room_id: 's1' })).statusCode).toBe(200);
        let last = 200;
        for (let i = 0; i < 11; i++) last = (await call({ action: 'closure_submit', room_id: 's1', from_date: d(1), to_date: d(1), reason: 'sick' })).statusCode;
        expect(last).toBe(429); // the 11th write within the hour (earlier ones were refused for other reasons, but all counted)
    });

    it('staff calls are never rate limited', async () => {
        for (let i = 0; i < 12; i++) expect((await call({ action: 'closure_ack', closure_id: 'x' })).statusCode).toBe(401);
    });
});

describe('captcha (Cloudflare Turnstile)', () => {
    it('is skipped until a secret is configured, then demands a valid token', async () => {
        const req = fakeReq({});
        expect(await verifyCaptcha(undefined, req)).toBe(true);
        process.env.TURNSTILE_SECRET = 'secret';
        expect(await verifyCaptcha(undefined, req)).toBe(false);
        expect(await verifyCaptcha('short', req)).toBe(false);
        const ok = vi.fn(async () => ({ json: async () => ({ success: true }) })) as never;
        const bad = vi.fn(async () => ({ json: async () => ({ success: false }) })) as never;
        const boom = vi.fn(async () => { throw new Error('network'); }) as never;
        expect(await verifyCaptcha('t'.repeat(30), req, ok)).toBe(true);
        expect(await verifyCaptcha('t'.repeat(30), req, bad)).toBe(false);
        expect(await verifyCaptcha('t'.repeat(30), req, boom)).toBe(false); // when in doubt, refuse
    });

    it('the walk-in form is refused without a token once the secret is set', async () => {
        process.env.TURNSTILE_SECRET = 'secret';
        const r = await walkin(1);
        expect(r.statusCode).toBe(400);
        expect(r.body.error).toBe('captcha_failed');
        expect(listPaths(`${B}/walk_ins/`)).toHaveLength(0);
    });
});