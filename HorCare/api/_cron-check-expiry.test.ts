import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import handler from './cron-check-expiry.js';
import { addAuthUser, fakeRes, listPaths, resetFake, seed } from './_fake-firestore.js';

const DAY = 86_400_000;
const pushes: string[] = [];

function req(authorization?: string) {
    return { method: 'GET', headers: authorization ? { authorization } : {}, query: {}, body: {} } as never;
}

beforeEach(() => {
    resetFake();
    pushes.length = 0;
    process.env.CRON_SECRET = 'cron-secret';
    process.env.LINE_SUPPORT_ACCESS_TOKEN = 'line-token';
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
        pushes.push(JSON.parse(init.body).to);
        return new Response('{}', { status: 200 });
    }));
    seed('users/u1', { access_until: Date.now() + 2.5 * DAY, line_support_user_id: 'L1' });
});

describe('cron-check-expiry', () => {
    it('rejects a signed-in user token — the job is for Vercel Cron only', async () => {
        addAuthUser('u1', 'u1@x.com');
        const res = fakeRes();
        await handler(req('Bearer tok:u1'), res as never);
        expect(res.statusCode).toBe(401);
        expect(pushes).toEqual([]);
    });

    it('fails closed when CRON_SECRET is not set', async () => {
        delete process.env.CRON_SECRET;
        const res = fakeRes();
        await handler(req('Bearer undefined'), res as never);
        expect(res.statusCode).toBe(401);
    });

    it('sends each notice once, even when the job runs again', async () => {
        await handler(req('Bearer cron-secret'), fakeRes() as never);
        await handler(req('Bearer cron-secret'), fakeRes() as never);
        expect(pushes).toEqual(['L1']);
        expect(listPaths('expiry_notices/')).toHaveLength(1);
    });

    it('a failed push is retried on the next run', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('bad', { status: 400 })));
        await handler(req('Bearer cron-secret'), fakeRes() as never);
        expect(listPaths('expiry_notices/')).toHaveLength(0);
    });
});
