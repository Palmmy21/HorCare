import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import webhook from './line-webhook.js';
import roomQr from './_room-qr.js';
import { addAuthUser, fakeReq, fakeRes, read, resetFake, seed } from './_fake-firestore.js';

const OWNER = 'owner-1';
const BLD = 'bld-A';
const ROOM = `users/${OWNER}/buildings/${BLD}/rooms/r101`;
const SECRET = 'tenant-secret';
const LINE_USER = 'U' + 'a'.repeat(32);
const OA = '@horcare';

const fetchMock = vi.fn();
/** What LINE answers the profile lookup with. */
let profile: { ok: boolean; status: number } | Error;

beforeEach(() => {
    resetFake();
    profile = { ok: true, status: 200 };
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => {
        if (String(url).includes('/v2/bot/profile/')) {
            if (profile instanceof Error) throw profile;
            return profile;
        }
        return { ok: true, status: 200, text: async () => '', headers: new Headers() };
    });
    vi.stubGlobal('fetch', fetchMock);
    process.env.LINE_CHANNEL_SECRET = SECRET;
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'tenant-token';
    process.env.VITE_LINE_OA_ID = OA;
    addAuthUser(OWNER, 'o@x.com', 'Owner');
    seed(`users/${OWNER}`, { uid: OWNER });
    seed(`users/${OWNER}/buildings/${BLD}`, { id: BLD });
    seed(`users/${OWNER}/buildings/${BLD}/data/config`, { bill_customization: { dorm_name: 'Dorm A' } });
    seed(ROOM, { room_number: '101', is_active: true });
});

afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LINE_CHANNEL_SECRET;
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    delete process.env.VITE_LINE_OA_ID;
});

async function post(events: object[]) {
    const raw = Buffer.from(JSON.stringify({ events }));
    const req = Readable.from([raw]) as never as { method: string; headers: object };
    req.method = 'POST';
    req.headers = { 'x-line-signature': createHmac('sha256', SECRET).update(raw).digest('base64') };
    const res = fakeRes();
    await webhook(req as never, res as never);
    expect(res.statusCode).toBe(200);
}

async function scanCard() {
    const res = fakeRes();
    await roomQr(fakeReq({ action: 'codes', owner_uid: OWNER, building_id: BLD, room_ids: ['r101'] }, OWNER), res as never);
    const { codes } = res.body as { codes: { code: string }[] };
    await post([{ type: 'message', replyToken: 'rt', source: { userId: LINE_USER }, message: { type: 'text', text: codes[0].code } }]);
}

const replyText = () => {
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/v2/bot/message/reply'));
    return (JSON.parse(call![1].body) as { messages: { text: string }[] }).messages[0].text;
};

describe('registering from a room QR', () => {
    it('a friend of the OA is simply registered', async () => {
        await scanCard();
        expect(read(ROOM)?.line_user_id).toBe(LINE_USER);
        expect(read(ROOM)?.line_unreachable).toBeUndefined();
        expect(replyText()).not.toContain('เพิ่มเพื่อน');
    });

    it('someone who never added the OA is registered, flagged, and told how to fix it', async () => {
        profile = { ok: false, status: 404 };
        await scanCard();
        expect(read(ROOM)).toMatchObject({ line_user_id: LINE_USER, line_unreachable: true });
        expect(replyText()).toContain('https://line.me/R/ti/p/%40horcare');
    });

    it('a LINE outage is not blamed on the tenant', async () => {
        profile = { ok: false, status: 500 };
        await scanCard();
        expect(read(ROOM)?.line_unreachable).toBeUndefined();
        expect(replyText()).not.toContain('เพิ่มเพื่อน');

        resetProfileToNetworkError();
        await post([{ type: 'unfollow', source: { userId: 'U' + 'f'.repeat(32) } }]); // unknown account: nothing to do
        expect(read(ROOM)?.line_unreachable).toBeUndefined();
    });
});

function resetProfileToNetworkError() { profile = new Error('network'); }

describe('a second person scans a taken room', () => {
    it('is told it went to an admin, and the room stays as it is', async () => {
        await scanCard();
        const res = fakeRes();
        await roomQr(fakeReq({ action: 'codes', owner_uid: OWNER, building_id: BLD, room_ids: ['r101'] }, OWNER), res as never);
        fetchMock.mockClear();
        const other = 'U' + 'b'.repeat(32);
        await post([{ type: 'message', replyToken: 'rt', source: { userId: other }, message: { type: 'text', text: (res.body as { codes: { code: string }[] }).codes[0].code } }]);
        expect(read(ROOM)?.line_user_id).toBe(LINE_USER);
        expect(replyText()).toContain('แอดมิน');
    });
});

describe('friendship follows LINE', () => {
    it('blocking flags the room, adding back clears it', async () => {
        await scanCard();
        await post([{ type: 'unfollow', source: { userId: LINE_USER } }]); // LINE sends no reply token here
        expect(read(ROOM)?.line_unreachable).toBe(true);
        await post([{ type: 'follow', replyToken: 'rt2', source: { userId: LINE_USER } }]);
        expect(read(ROOM)?.line_unreachable).toBeUndefined();
    });

    it('adding the OA after registering clears the flag set at registration', async () => {
        profile = { ok: false, status: 404 };
        await scanCard();
        await post([{ type: 'follow', replyToken: 'rt2', source: { userId: LINE_USER } }]);
        expect(read(ROOM)?.line_unreachable).toBeUndefined();
    });
});
