import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import { currentLineChannel, residentLineToken, roomLineToken, runInLineChannel } from './_line.js';
import marketWebhook from './line-market-webhook.js';
import tenantWebhook from './line-webhook.js';

beforeEach(() => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'tenant-token';
    process.env.LINE_MARKET_CHANNEL_ACCESS_TOKEN = 'market-token';
    process.env.LINE_CHANNEL_SECRET = 'tenant-secret';
    process.env.LINE_MARKET_CHANNEL_SECRET = 'market-secret';
});
afterEach(() => {
    for (const k of ['LINE_CHANNEL_ACCESS_TOKEN', 'LINE_MARKET_CHANNEL_ACCESS_TOKEN', 'LINE_CHANNEL_SECRET', 'LINE_MARKET_CHANNEL_SECRET']) delete process.env[k];
});

describe('which OA a resident message goes through', () => {
    it('defaults to the tenant OA, and to the vendor OA inside a vendor-webhook request', async () => {
        expect(currentLineChannel()).toBe('tenant');
        expect(residentLineToken()).toBe('tenant-token');
        await runInLineChannel('market', async () => {
            await Promise.resolve(); // survives awaits
            expect(currentLineChannel()).toBe('market');
            expect(residentLineToken()).toBe('market-token');
        });
        expect(currentLineChannel()).toBe('tenant');
    });

    it('pushes to a room through the OA it linked through; older links stay on the tenant OA', () => {
        expect(roomLineToken({ line_channel: 'market' })).toBe('market-token');
        expect(roomLineToken({ line_channel: 'tenant' })).toBe('tenant-token');
        expect(roomLineToken({})).toBe('tenant-token');
        expect(roomLineToken(undefined)).toBe('tenant-token');
    });
});

describe('vendor OA webhook', () => {
    const body = JSON.stringify({ events: [] });
    const sign = (secret: string) => createHmac('sha256', secret).update(body).digest('base64');
    const call = async (handler: (req: never, res: never) => unknown, signature: string) => {
        const req = Object.assign(Readable.from([Buffer.from(body)]), { method: 'POST', headers: { 'x-line-signature': signature } });
        const res = { statusCode: 0, body: '' as unknown, status(c: number) { this.statusCode = c; return this; }, send(b: unknown) { this.body = b; return this; }, json(b: unknown) { this.body = b; return this; } };
        await handler(req as never, res as never);
        return res;
    };

    it('accepts events signed by the vendor channel and refuses ones signed by the tenant channel', async () => {
        expect((await call(marketWebhook, sign('market-secret'))).statusCode).toBe(200);
        expect((await call(marketWebhook, sign('tenant-secret'))).statusCode).toBe(401);
        // and the tenant endpoint the other way round
        expect((await call(tenantWebhook, sign('tenant-secret'))).statusCode).toBe(200);
        expect((await call(tenantWebhook, sign('market-secret'))).statusCode).toBe(401);
    });

    it('says what is missing when the vendor channel is not set up', async () => {
        delete process.env.LINE_MARKET_CHANNEL_SECRET;
        const r = await call(marketWebhook, sign('market-secret'));
        expect(r.statusCode).toBe(500);
        expect(r.body).toBe('LINE_MARKET_CHANNEL_SECRET not set');
    });
});
