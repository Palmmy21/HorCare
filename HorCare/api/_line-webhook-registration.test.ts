import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import webhook from './line-webhook.js';
import roomQr from './_room-qr.js';
import { addAuthUser, fakeReq, fakeRes, listPaths, read, resetFake, seed } from './_fake-firestore.js';

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

describe('what the bot says', () => {
    const text = (t: string, user = LINE_USER) => ({ type: 'message', replyToken: 'rt', source: { userId: user }, message: { type: 'text', text: t } });
    const reply = () => {
        const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/v2/bot/message/reply'));
        return call ? (JSON.parse(call[1].body) as { messages: { type: string; text?: string; quickReply?: { items: { action: { text: string } }[] } }[] }).messages : null;
    };
    const STRANGER = 'U' + 'c'.repeat(32);

    it('one LINE account with a market stall and a dorm room: each OA files the message with its own place', async () => {
        const MKT = 'bld-M';
        seed(`users/${OWNER}/buildings/${MKT}`, { id: MKT, building_type: 'market' });
        seed(`users/${OWNER}/buildings/${MKT}/rooms/A22`, { room_number: 'A22', line_user_id: LINE_USER, line_channel: 'market' });
        seed(ROOM, { room_number: '101', is_active: true, line_user_id: LINE_USER });
        const stall = { uid: OWNER, building_id: MKT, room_id: 'A22', room_number: 'A22' };
        const dorm = { uid: OWNER, building_id: BLD, room_id: 'r101', room_number: '101' };
        seed(`line_rooms/${LINE_USER}`, { ...stall, rooms: [stall, dorm] });   // the stall is the primary
        const thread = (b: string) => listPaths(`users/${OWNER}/buildings/${b}/line_threads/${LINE_USER}/messages/`).map(p => read(p)?.text);

        await post([text('น้ำไม่ไหลค่ะ')]);   // to the tenant OA
        expect(thread(BLD)).toContain('น้ำไม่ไหลค่ะ');
        expect(thread(MKT)).not.toContain('น้ำไม่ไหลค่ะ');

        process.env.LINE_MARKET_CHANNEL_SECRET = SECRET;
        const market = (await import('./line-market-webhook.js')).default;
        const raw = Buffer.from(JSON.stringify({ events: [text('พรุ่งนี้หยุดขาย')] }));
        const req = Readable.from([raw]) as never as { method: string; headers: object };
        req.method = 'POST';
        req.headers = { 'x-line-signature': createHmac('sha256', SECRET).update(raw).digest('base64') };
        const res = fakeRes();
        await market(req as never, res as never);
        delete process.env.LINE_MARKET_CHANNEL_SECRET;
        expect(res.statusCode).toBe(200);
        expect(thread(MKT)).toContain('พรุ่งนี้หยุดขาย');
        expect(thread(BLD)).not.toContain('พรุ่งนี้หยุดขาย');
    });

    it('an answer LINE turns down (reply token expired) is pushed instead, and kept in the inbox', async () => {
        await scanCard();
        fetchMock.mockClear();
        fetchMock.mockImplementation(async (url: string) => String(url).endsWith('/v2/bot/message/reply')
            ? { ok: false, status: 400, text: async () => '{"message":"Invalid reply token"}', headers: new Headers() }
            : { ok: true, status: 200, text: async () => '', headers: new Headers() });
        const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await post([text('บิล')]);
        const push = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/v2/bot/message/push'));
        expect(push).toBeTruthy();
        expect(JSON.parse(push![1].body).to).toBe(LINE_USER);
        expect(errors.mock.calls.some(c => String(c[0]).includes('Invalid reply token'))).toBe(true);
        errors.mockRestore();
        const thread = listPaths(`users/${OWNER}/buildings/${BLD}/line_threads/${LINE_USER}/messages/`).map(p => read(p));
        expect(thread.some(m => m?.direction === 'out')).toBe(true);
    });

    it('greets a new friend with how to register', async () => {
        await post([{ type: 'follow', replyToken: 'rt', source: { userId: STRANGER } }]);
        expect(reply()![0].text).toContain('ยังไม่ได้ลงทะเบียน');
        expect(reply()![0].quickReply!.items.map(i => i.action.text)).toEqual(['ลงทะเบียน']);
    });

    it('greets a registered friend by room, with the menu one tap away', async () => {
        await scanCard();
        fetchMock.mockClear();
        await post([{ type: 'follow', replyToken: 'rt', source: { userId: LINE_USER } }]);
        expect(reply()![0].text).toContain('ห้อง 101');
        expect(reply()![0].quickReply!.items.map(i => i.action.text)).toEqual(['บิล', 'ส่งสลิป', 'พอร์ทัล', 'ประกาศ']);
    });

    it('understands a politely worded command', async () => {
        await scanCard();
        fetchMock.mockClear();
        await post([text('ขอดูบิลหน่อยครับ')]);
        expect(reply()![0].text).toContain('ยังไม่มีบิล');
    });

    it('answers "เมนู" with what the chat can do; the command and the answer are kept in the inbox without ringing anyone', async () => {
        await scanCard();
        fetchMock.mockClear();
        await post([text('เมนู')]);
        expect(reply()![0].text).toContain('"ส่งสลิป"');
        const thread = `users/${OWNER}/buildings/${BLD}/line_threads/${LINE_USER}`;
        expect(read(thread)).toMatchObject({ unread_count: 0 });
        const msgs = listPaths(`${thread}/messages/`).map(p => read(p) as { direction: string; text: string; by: string | null });
        expect(msgs.some(m => m.direction === 'in' && m.text === 'เมนู')).toBe(true);
        expect(msgs.some(m => m.direction === 'out' && m.by === 'ตอบอัตโนมัติ' && m.text.includes('"ส่งสลิป"'))).toBe(true);
    });

    it('lets the property\'s own Q&A answer "แจ้งซ่อม" when it has one, else opens the portal', async () => {
        process.env.APP_URL = 'https://app.example';
        process.env.PORTAL_TOKEN_SECRET = 'portal-secret';
        await scanCard();
        fetchMock.mockClear();
        await post([text('แจ้งซ่อม')]);
        expect(reply()!.map(m => m.type)).toEqual(['text', 'flex']);

        seed(`users/${OWNER}/buildings/${BLD}/faqs/f1`, { id: 'f1', title: 'ซ่อม', keywords: ['แจ้งซ่อม'], answer: 'โทรหาช่าง 081-000-0000', enabled: true, hit_count: 0, created_at: '2026-01-01', updated_at: '2026-01-01' });
        fetchMock.mockClear();
        await post([text('แจ้งซ่อม')]);
        expect(reply()![0].text).toBe('โทรหาช่าง 081-000-0000');
        expect(read(`users/${OWNER}/buildings/${BLD}/faqs/f1`)?.hit_count).toBe(1);
        delete process.env.APP_URL;
        delete process.env.PORTAL_TOKEN_SECRET;
    });

    it('still passes real conversation to the owner, acknowledged once', async () => {
        await scanCard();
        fetchMock.mockClear();
        await post([text('บิลเดือนที่แล้วผิดค่ะ ช่วยดูหน่อย')]);
        expect(reply()![0].text).toContain('ได้รับข้อความแล้ว');
        expect(read(`users/${OWNER}/buildings/${BLD}/line_threads/${LINE_USER}`)?.unread_count).toBe(1);
        fetchMock.mockClear();
        await post([text('ขอบคุณค่ะ')]);
        expect(reply()).toBeNull();
    });

    it('tells a stranger how to register instead of showing a menu', async () => {
        await post([text('เมนู', STRANGER)]);
        expect(reply()![0].text).toContain('ยังไม่ได้ลงทะเบียน');
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
