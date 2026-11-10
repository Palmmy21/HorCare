import { createHmac, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import handler, { decryptSecret, encryptSecret, propertyOaId } from './_line-oa.js';
import teamWebhook from './line-team-webhook.js';
import roomQr from './_room-qr.js';
import { roomLineToken, roomLineChannel } from './_line.js';
import { addAuthUser, fakeReq, fakeRes, listPaths, read, resetFake, seed } from './_fake-firestore.js';
import { permissionsForRole } from '../src/shared/permissions.js';

const OWNER = 'team-a';
const OTHER = 'team-b';
const BLD = 'bld-A';
const SECRET = 'a'.repeat(32);
const TOKEN = 'team-a-long-lived-token';
const LINE_USER = 'U' + 'a'.repeat(32);

const fetchMock = vi.fn();
let webhookTest: { success: boolean; statusCode: number };

const json = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data, text: async () => JSON.stringify(data), headers: new Headers() });

beforeEach(() => {
    resetFake();
    webhookTest = { success: true, statusCode: 200 };
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string, init?: { method?: string; headers?: Record<string, string> }) => {
        const u = String(url);
        if (u.endsWith('/v2/bot/info')) {
            return init?.headers?.Authorization === `Bearer ${TOKEN}`
                ? json({ userId: 'U' + 'b'.repeat(32), basicId: '@teama', displayName: 'Team A' })
                : json({}, 401);
        }
        if (u.endsWith('/channel/webhook/test')) return json(webhookTest);
        if (u.endsWith('/channel/webhook/endpoint')) return json({ active: false });
        return json({ displayName: 'Malee' });
    });
    vi.stubGlobal('fetch', fetchMock);
    process.env.LINE_OA_ENC_KEY = randomBytes(32).toString('base64');
    process.env.VITE_LINE_OA_ID = '@shared';
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'shared-token';
    for (const uid of [OWNER, OTHER]) {
        addAuthUser(uid, `${uid}@x.com`, uid);
        seed(`users/${uid}`, { uid });
        seed(`users/${uid}/buildings/${BLD}`, { id: BLD });
        seed(`users/${uid}/buildings/${BLD}/rooms/r1`, { room_number: '101', is_active: true });
    }
});

afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LINE_OA_ENC_KEY;
    delete process.env.VITE_LINE_OA_ID;
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
});

async function call(uid: string, body: Record<string, unknown>, owner = OWNER) {
    const res = fakeRes();
    await handler(fakeReq({ owner_uid: owner, building_id: BLD, ...body }, uid), res as never);
    return res as unknown as { statusCode: number; body: Record<string, any> };
}
const connect = (uid = OWNER, over: Record<string, unknown> = {}, owner = uid) =>
    call(uid, { action: 'connect', channel_secret: SECRET, access_token: TOKEN, ...over }, owner);
const oaId = () => listPaths('line_oas/')[0].split('/')[1];

async function deliver(id: string, events: object[], secret = SECRET) {
    const raw = Buffer.from(JSON.stringify({ events }));
    const req = Readable.from([raw]) as never as { method: string; headers: object; query: object };
    req.method = 'POST';
    req.query = { id };
    req.headers = { 'x-line-signature': createHmac('sha256', secret).update(raw).digest('base64') };
    const res = fakeRes();
    await teamWebhook(req as never, res as never);
    return res;
}
async function codeFor(owner: string) {
    const res = fakeRes();
    await roomQr(fakeReq({ action: 'codes', owner_uid: owner, building_id: BLD, room_ids: ['r1'] }, owner), res as never);
    return (res.body as { codes: { code: string }[] }).codes[0].code;
}
const scan = (id: string, code: string) => deliver(id, [{ type: 'message', replyToken: 'rt', source: { userId: LINE_USER }, message: { type: 'text', text: code } }]);

describe('credentials', () => {
    it('round-trips, and differs every time', () => {
        expect(decryptSecret(encryptSecret('x'))).toBe('x');
        expect(encryptSecret('x')).not.toBe(encryptSecret('x'));
    });

    it('a tampered value does not decrypt', () => {
        const parts = encryptSecret('secret').split('.');
        parts[3] = Buffer.from('tampered!').toString('base64');
        expect(() => decryptSecret(parts.join('.'))).toThrow();
    });

    it('never stores or returns them in the clear', async () => {
        const res = await connect();
        const stored = JSON.stringify(read(`line_oas/${oaId()}`));
        expect(stored).not.toContain(SECRET);
        expect(stored).not.toContain(TOKEN);
        expect(JSON.stringify(res.body)).not.toContain(TOKEN);
        expect(JSON.stringify((await call(OWNER, { action: 'status' })).body)).not.toContain(SECRET);
    });
});

describe('connecting', () => {
    it('saves the OA, points its webhook here, and says when Use webhook is still off', async () => {
        const res = await connect();
        expect(res.body).toMatchObject({ connected: true, oa_id: '@teama', webhook_active: false });
        expect(res.body.webhook_url).toContain(`/api/line-team-webhook/${oaId()}`);
        expect(await propertyOaId(OWNER, BLD)).toBe('@teama');
    });

    it('rejects a bad token before saving anything', async () => {
        const res = await connect(OWNER, { access_token: 'nope' });
        expect(res.body.error).toBe('invalid_token');
        expect(listPaths('line_oas/')).toHaveLength(0);
    });

    it('rejects a wrong secret, proven by LINE\'s signed test, and keeps nothing', async () => {
        webhookTest = { success: false, statusCode: 401 };
        expect((await connect()).body.error).toBe('invalid_secret');
        expect(listPaths('line_oas/')).toHaveLength(0);
    });

    it('a failed token update leaves the working connection in place', async () => {
        await connect();
        const before = read(`line_oas/${oaId()}`);
        webhookTest = { success: false, statusCode: 500 };
        await connect();
        expect(read(`line_oas/${oaId()}`)).toEqual(before);
    });

    it('one OA cannot serve two teams', async () => {
        await connect();
        expect((await connect(OTHER)).body.error).toBe('oa_taken');
    });

    it('the shared HorCare OA cannot be claimed by a team', async () => {
        process.env.VITE_LINE_OA_ID = '@teama';
        expect((await connect()).body.error).toBe('shared_oa');
    });

    it('is the owner\'s call: a manager and another team are refused', async () => {
        addAuthUser('mgr', 'm@x.com');
        seed(`users/${OWNER}/members/mgr`, { uid: 'mgr', role: 'property_manager', permissions: permissionsForRole('property_manager'), property_ids: ['*'], status: 'active' });
        expect((await connect('mgr', {}, OWNER)).statusCode).toBe(403);
        expect((await connect(OTHER, {}, OWNER)).statusCode).toBe(403);
        expect(listPaths('line_oas/')).toHaveLength(0);
    });
});

describe('a team\'s tenants', () => {
    it('without an OA, a team stays on the shared one', async () => {
        expect(await propertyOaId(OTHER, BLD)).toBe('@shared');
        expect(await roomLineToken({})).toBe('shared-token');
    });

    it('register on the team OA, and bills then go out with the team token', async () => {
        await connect();
        const id = oaId();
        expect((await scan(id, await codeFor(OWNER))).statusCode).toBe(200);
        const room = read(`users/${OWNER}/buildings/${BLD}/rooms/r1`)!;
        expect(room).toMatchObject({ line_user_id: LINE_USER, line_channel: `oa:${id}` });
        expect(roomLineChannel(room)).toBe(`oa:${id}`);
        expect(await roomLineToken(room)).toBe(TOKEN);
        const reply = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/message/reply'));
        expect(reply![1].headers.Authorization).toBe(`Bearer ${TOKEN}`);
    });

    it('a room of another team cannot be registered through this OA', async () => {
        await connect();
        await scan(oaId(), await codeFor(OTHER));
        expect(read(`users/${OTHER}/buildings/${BLD}/rooms/r1`)?.line_user_id).toBeUndefined();
        expect(read(`line_rooms/${LINE_USER}`)).toBeUndefined();
    });

    it('a delivery signed with another secret is refused', async () => {
        await connect();
        expect((await deliver(oaId(), [], 'b'.repeat(32))).statusCode).toBe(401);
    });

    it('an unknown webhook address is a 404', async () => {
        expect((await deliver('f'.repeat(32), [])).statusCode).toBe(404);
    });

    it('a disconnected OA does not strand tenants', async () => {
        await connect();
        const id = oaId();
        await scan(id, await codeFor(OWNER));
        const res = await call(OWNER, { action: 'disconnect' });
        expect(res.statusCode).toBe(409);
        expect(res.body).toMatchObject({ error: 'rooms_linked', rooms: 1 });
        expect(read(`line_oas/${id}`)).toBeDefined();
    });

    it('disconnects cleanly once no room depends on it', async () => {
        await connect();
        expect((await call(OWNER, { action: 'disconnect' })).statusCode).toBe(200);
        expect(listPaths('line_oas/')).toHaveLength(0);
        expect(await propertyOaId(OWNER, BLD)).toBe('@shared');
    });
});

describe('status says what is left to do in LINE', () => {
    let endpoint: { status: number; body: object };
    beforeEach(async () => {
        await connect();
        const base = fetchMock.getMockImplementation()!;
        endpoint = { status: 200, body: { active: true, endpoint: `https://hor-care.vercel.app/api/line-team-webhook/${oaId()}` } };
        fetchMock.mockImplementation(async (url: string, init?: object) =>
            String(url).endsWith('/channel/webhook/endpoint') ? json(endpoint.body, endpoint.status) : base(url, init));
    });
    const status = async () => (await call(OWNER, { action: 'status' })).body;

    it('all good: webhook on, still pointing here, token alive', async () => {
        expect(await status()).toMatchObject({ connected: true, oa_id: '@teama', webhook_active: true, webhook_matches: true, token_valid: true });
    });

    it('"Use webhook" still off', async () => {
        endpoint.body = { active: false, endpoint: `https://hor-care.vercel.app/api/line-team-webhook/${oaId()}/` };
        expect(await status()).toMatchObject({ webhook_active: false, webhook_matches: true });
    });

    it('someone pointed the webhook at another system', async () => {
        endpoint.body = { active: true, endpoint: 'https://other-bot.example/hook' };
        expect(await status()).toMatchObject({ webhook_active: true, webhook_matches: false });
    });

    it('the token was reissued in the console', async () => {
        endpoint = { status: 401, body: {} };
        expect(await status()).toMatchObject({ connected: true, token_valid: false, webhook_active: null });
    });

    it('LINE not answering is "unknown", never "broken"', async () => {
        endpoint = { status: 500, body: {} };
        expect(await status()).toMatchObject({ connected: true, webhook_active: null, webhook_matches: null, token_valid: null });
    });

    it('accepts values pasted with stray spaces and upper case', async () => {
        const res = await connect(OWNER, { channel_secret: ` ${SECRET.toUpperCase().slice(0, 16)} ${SECRET.slice(16)}\n`, access_token: ` ${TOKEN}\n` });
        expect(res.statusCode).toBe(200);
    });
});
