import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);
vi.mock('./_abuse-guard.js', async () => ({ ...(await vi.importActual<typeof import('./_abuse-guard.js')>('./_abuse-guard.js')), rateLimit: async () => ({ ok: true, retryAfterSec: 0 }) }));

import marketWebhook from './line-market-webhook.js';
import tenantWebhook from './line-webhook.js';
import market from './_market.js';
import inbox from './_line-inbox.js';
import { addAuthUser, fakeReq, fakeRes, listPaths, read, resetFake, seed } from './_fake-firestore.js';
import { permissionsForRole } from '../src/shared/permissions.js';
import { addDays, todayTh, WALKIN_LOT_NOTE } from '../src/shared/market.js';

const OWNER = 'owner-1';
const MKT = 'mkt-1';
const B = `users/${OWNER}/buildings/${MKT}`;
const SECRET = 'market-secret';
const VENDOR = 'U' + 'e'.repeat(32);
const MENU_ID = 'richmenu-walkin-1';

const fetchMock = vi.fn();
const calls = (suffix: RegExp) => fetchMock.mock.calls.filter(([url]) => suffix.test(String(url)));
const sent = () => calls(/message\/(reply|push)$/).map(c => ({ url: String(c[0]), auth: c[1].headers.Authorization, body: JSON.parse(c[1].body) }));
const textsSent = () => JSON.stringify(sent().map(s => s.body.messages));

beforeEach(() => {
    resetFake();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => {
        if (String(url).includes('/richmenu/alias/')) return { ok: true, status: 200, json: async () => ({ richMenuId: MENU_ID }), text: async () => '', headers: new Headers() };
        return { ok: true, status: 200, json: async () => ({}), text: async () => '', headers: new Headers() };
    });
    vi.stubGlobal('fetch', fetchMock);
    process.env.LINE_MARKET_CHANNEL_SECRET = SECRET;
    process.env.LINE_MARKET_CHANNEL_ACCESS_TOKEN = 'market-token';
    process.env.LINE_CHANNEL_SECRET = 'tenant-secret';
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'tenant-token';
    process.env.VITE_LINE_MARKET_OA_ID = '@market';
    process.env.VITE_LINE_OA_ID = '@tenant';
    addAuthUser(OWNER, 'o@x.com', 'Owner');
    addAuthUser('mkt', 'm@x.com', 'Market admin');
    seed(`users/${OWNER}`, { uid: OWNER });
    seed(B, { id: MKT, building_type: 'market' });
    seed(`${B}/data/config`, { building_type: 'market', bill_customization: { dorm_name: 'ตลาดนัดทดสอบ' } });
    seed(`${B}/rooms/s1`, { room_number: 'A01', zone: 'โซน A', is_active: true });
    seed(`${B}/rooms/s2`, { room_number: 'A02', zone: 'โซน A', is_active: true });
    seed(`users/${OWNER}/members/mkt`, { uid: 'mkt', role: 'market_admin', permissions: permissionsForRole('market_admin'), property_ids: ['*'], status: 'active' });
});

afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of ['LINE_MARKET_CHANNEL_SECRET', 'LINE_MARKET_CHANNEL_ACCESS_TOKEN', 'LINE_CHANNEL_SECRET', 'LINE_CHANNEL_ACCESS_TOKEN', 'VITE_LINE_MARKET_OA_ID', 'VITE_LINE_OA_ID']) delete process.env[k];
});

async function post(handler: typeof marketWebhook, secret: string, events: object[]) {
    const raw = Buffer.from(JSON.stringify({ events }));
    const req = Readable.from([raw]) as never as { method: string; headers: object };
    req.method = 'POST';
    req.headers = { 'x-line-signature': createHmac('sha256', secret).update(raw).digest('base64') };
    const res = fakeRes();
    await handler(req as never, res as never);
    expect(res.statusCode).toBe(200);
}
const text = (t: string) => ({ type: 'message', replyToken: 'rt', source: { userId: VENDOR }, message: { type: 'text', id: String(Date.now()), text: t } });
const toMarket = (t: string) => post(marketWebhook, SECRET, [text(t)]);

/** A walk-in asks for a day and a lot on the public form; returns what the confirmation page gets. */
async function request(over: Record<string, unknown> = {}) {
    const res = fakeRes();
    await market(fakeReq({ action: 'walkin_submit', owner_uid: OWNER, building_id: MKT, date: addDays(todayTh(), 1), name: 'ป้าแดง', phone: '0812345678', goods: 'ผลไม้', preferred_room_id: 's1', ...over }), res as never);
    expect(res.statusCode).toBe(200);
    return res.body as { line_code: string; line_url: string };
}
const walkIn = () => listPaths(`${B}/walk_ins/`).map(p => read(p)!)[0];
const thread = () => read(`${B}/line_threads/${VENDOR}`);
const threadTexts = () => listPaths(`${B}/line_threads/${VENDOR}/messages/`).map(p => read(p)?.text as string);

describe('walk-in vendors on LINE', () => {
    it('the confirmation opens the request\'s own registration link (LIFF, else the market\'s chat)', async () => {
        const r = await request();
        expect(r.line_url).toBe(`https://hor-care.vercel.app/j/${r.line_code}`);
        expect((await request({ phone: '0812345679' })).line_code).not.toBe(r.line_code);
    });

    it('sending the code links the request, gives the walk-in menu, and says the lot is a wish', async () => {
        const { line_code } = await request();
        fetchMock.mockClear();
        await toMarket(line_code);
        expect(walkIn()).toMatchObject({ line_user_id: VENDOR, line_channel: 'market' });
        expect(read(`line_walkins/${VENDOR}`)).toMatchObject({ owner_uid: OWNER, building_id: MKT, name: 'ป้าแดง', menu: true });
        const link = calls(new RegExp(`/user/${VENDOR}/richmenu/${MENU_ID}$`));
        expect(link).toHaveLength(1);
        expect(link[0][1].headers.Authorization).toBe('Bearer market-token');
        expect(textsSent()).toContain(WALKIN_LOT_NOTE);
        expect(textsSent()).toContain('A01');
        // the code is for one person
        const other = 'U' + 'f'.repeat(32);
        fetchMock.mockClear();
        await post(marketWebhook, SECRET, [{ ...text(line_code), source: { userId: other } }]);
        expect(textsSent()).toContain('LINE บัญชีอื่น');
        expect(walkIn().line_user_id).toBe(VENDOR);
    });

    it('their messages go to that market\'s inbox, and staff answer through the market OA', async () => {
        const { line_code } = await request();
        await toMarket(line_code);
        await toMarket('ขอเปลี่ยนเป็นล็อกริมทางเดินได้ไหมคะ');
        const t = thread();
        expect(t).toMatchObject({ room_number: 'ขาจร', tenant_name: 'ป้าแดง (ขาจร)', unread_count: 1 });
        expect(threadTexts()).toContain('ขอเปลี่ยนเป็นล็อกริมทางเดินได้ไหมคะ');
        const alerts = listPaths(`users/${OWNER}/inbox/`).map(p => read(p));
        expect(alerts.some(a => a?.type === 'chat' && String(a.title).includes('ป้าแดง'))).toBe(true);

        fetchMock.mockClear();
        const res = fakeRes();
        await inbox(fakeReq({ action: 'send', owner_uid: OWNER, building_id: MKT, line_user_id: VENDOR, text: 'ได้ค่ะ จัดให้ล็อก A02' }, OWNER), res as never);
        expect(res.statusCode).toBe(200);
        const push = sent().find(s => s.url.endsWith('/push'))!;
        expect(push.auth).toBe('Bearer market-token');
        expect(push.body.to).toBe(VENDOR);
    });

    it('"ขอความช่วยเหลือ" from a walk-in alerts the market with their name', async () => {
        const { line_code } = await request();
        await toMarket(line_code);
        await toMarket('ขอความช่วยเหลือ');
        const help = listPaths(`users/${OWNER}/inbox/`).map(p => read(p)).filter(a => a?.type === 'help_request');
        expect(help).toHaveLength(1);
        expect(help[0]?.title).toContain('ป้าแดง (ขาจร)');
        expect(thread()?.help_requested_at).toBeTruthy();
    });

    it('the decision, with the lot given, is sent in the same chat', async () => {
        const { line_code } = await request();
        await toMarket(line_code);
        fetchMock.mockClear();
        const res = fakeRes();
        await market(fakeReq({ action: 'walkin_decide', owner_uid: OWNER, building_id: MKT, walkin_id: walkIn().id, status: 'approved', lot_room_id: 's2' }, 'mkt'), res as never);
        expect(res.body).toMatchObject({ ok: true, line_notified: true });
        const push = sent().find(s => s.url.endsWith('/push'))!;
        expect(push.auth).toBe('Bearer market-token');
        const said = JSON.stringify(push.body.messages);
        expect(said).toContain('อนุมัติ');
        expect(said).toContain('A02');
        expect(said).toContain('ไม่ว่าง');   // they asked for A01: told why they got another lot
        expect(walkIn().line_notified_at).toBeTruthy();
    });

    it('"สถานะขาจร" lists their upcoming requests; the code means nothing on the tenant OA\'s inbox of another place', async () => {
        const { line_code } = await request();
        await toMarket(line_code);
        fetchMock.mockClear();
        await toMarket('สถานะขาจร');
        expect(textsSent()).toContain('รอพิจารณา');
        // on the tenant OA the same person is not a walk-in of anything: told how to register
        fetchMock.mockClear();
        await post(tenantWebhook, 'tenant-secret', [text('สวัสดีค่ะ')]);
        expect(textsSent()).toContain('ยังไม่ได้ลงทะเบียน');
    });

    it('once they register a stall, the walk-in menu is taken away', async () => {
        const { line_code } = await request();
        await toMarket(line_code);
        seed(`${B}/rooms/s1`, { room_number: 'A01', is_active: true, line_user_id: VENDOR, line_channel: 'market' });
        seed(`line_rooms/${VENDOR}`, { uid: OWNER, building_id: MKT, room_id: 's1', room_number: 'A01' });
        fetchMock.mockClear();
        await toMarket('บิล');
        expect(calls(new RegExp(`/user/${VENDOR}/richmenu$`)).filter(c => c[1].method === 'DELETE')).toHaveLength(1);
        expect(read(`line_walkins/${VENDOR}`)?.menu).toBe(false);
    });
});
