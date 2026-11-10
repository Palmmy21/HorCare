import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import webhook from './line-staff-webhook.js';
import workOrders from './_work-orders.js';
import { resetStaffMenuCache } from './_staff-menu.js';
import { addAuthUser, fakeReq, fakeRes, read, resetFake, seed } from './_fake-firestore.js';

const OWNER = 'owner-1';
const BLD = 'bld-A';
const B = `users/${OWNER}/buildings/${BLD}`;
const STAFF_TOKEN = 'staff-access-token';
const TENANT_TOKEN = 'tenant-access-token';
const SECRET = 'staff-secret';
const LINE_USER = 'U' + 's'.repeat(32);

const fetchMock = vi.fn();

beforeEach(() => {
    resetFake();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '', headers: new Headers() });
    vi.stubGlobal('fetch', fetchMock);
    process.env.LINE_STAFF_CHANNEL_ACCESS_TOKEN = STAFF_TOKEN;
    process.env.LINE_STAFF_CHANNEL_SECRET = SECRET;
    process.env.LINE_CHANNEL_ACCESS_TOKEN = TENANT_TOKEN;
    addAuthUser(OWNER, 'o@x.com', 'Owner');
    seed(`users/${OWNER}`, { uid: OWNER });
    seed(B, { id: BLD });
    seed(`${B}/data/config`, { bill_customization: { dorm_name: 'Dorm A' } });
    seed(`${B}/rooms/r101`, { room_number: '101', is_active: true });
});

afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LINE_STAFF_CHANNEL_ACCESS_TOKEN;
    delete process.env.LINE_STAFF_CHANNEL_SECRET;
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
});

async function manager(body: Record<string, unknown>) {
    const res = fakeRes();
    await workOrders(fakeReq({ owner_uid: OWNER, building_id: BLD, ...body }, OWNER), res as never);
    return res as { statusCode: number; body: any };
}

function signedReq(payload: object, secret = SECRET, method = 'POST') {
    const raw = Buffer.from(JSON.stringify(payload));
    const req = Readable.from([raw]) as any;
    req.method = method;
    req.headers = { 'x-line-signature': createHmac('sha256', secret).update(raw).digest('base64') };
    return req;
}
const textEvent = (text: string) => ({ events: [{ type: 'message', replyToken: 'rt', source: { userId: LINE_USER }, message: { type: 'text', text } }] });

describe('staff LINE channel is separate from the tenant channel', () => {
    it('pushes job cards with the STAFF token, never the tenant token', async () => {
        const staff = (await manager({ action: 'staff_create', name: 'Somsak', role: 'technician' })).body.staff;
        seed(`${B}/staff/${staff.id}`, { ...read(`${B}/staff/${staff.id}`)!, line_user_id: LINE_USER });
        const res = await manager({ action: 'create', room_id: 'r101', work_type: 'repair', description: 'Leak', assign_staff_id: staff.id });
        expect(res.body.notify).toEqual({ line: 'sent', in_app: 'sent' });

        const push = fetchMock.mock.calls.find(c => String(c[0]).endsWith('/message/push'))!;
        expect(push[1].headers.Authorization).toBe(`Bearer ${STAFF_TOKEN}`);
        const sent = JSON.parse(push[1].body);
        expect(sent.to).toBe(LINE_USER);
        expect(sent.messages[0].type).toBe('flex');
        expect(JSON.stringify(sent)).not.toContain(TENANT_TOKEN);
    });

    it('is reported as skipped (not sent) when the staff channel token is missing, even if the tenant token exists', async () => {
        delete process.env.LINE_STAFF_CHANNEL_ACCESS_TOKEN;
        const staff = (await manager({ action: 'staff_create', name: 'Somsak', role: 'technician' })).body.staff;
        seed(`${B}/staff/${staff.id}`, { ...read(`${B}/staff/${staff.id}`)!, line_user_id: LINE_USER });
        const res = await manager({ action: 'create', room_id: 'r101', work_type: 'repair', description: 'Leak', assign_staff_id: staff.id });
        expect(res.body.notify.line).toBe('skipped');
        expect(fetchMock.mock.calls.some(c => String(c[0]).endsWith('/message/push'))).toBe(false);
    });
});

describe('/api/line-staff-webhook', () => {
    async function run(req: any) {
        const res = fakeRes();
        await webhook(req, res as never);
        return res as { statusCode: number; body: unknown };
    }
    async function issueCode() {
        const staff = (await manager({ action: 'staff_create', name: 'Somsak', role: 'technician' })).body.staff;
        const { code } = (await manager({ action: 'staff_link_code', staff_id: staff.id })).body;
        return { staffId: staff.id as string, code: code as string };
    }
    const replyText = () => JSON.parse(fetchMock.mock.calls.find(c => String(c[0]).endsWith('/message/reply'))![1].body).messages[0].text as string;

    it('rejects anything but a correctly signed POST', async () => {
        expect((await run(signedReq(textEvent('hi'), SECRET, 'GET'))).statusCode).toBe(405);
        expect((await run(signedReq(textEvent('hi'), 'wrong-secret'))).statusCode).toBe(401);
        const unsigned = Readable.from([Buffer.from('{}')]) as any;
        unsigned.method = 'POST'; unsigned.headers = {};
        expect((await run(unsigned)).statusCode).toBe(401);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fails closed when the secret is not configured', async () => {
        delete process.env.LINE_STAFF_CHANNEL_SECRET;
        expect((await run(signedReq(textEvent('hi')))).statusCode).toBe(500);
    });

    it('a valid code connects the sender and the reply uses the staff token', async () => {
        const { staffId, code } = await issueCode();
        const res = await run(signedReq(textEvent(code)));
        expect(res.statusCode).toBe(200);
        expect(read(`${B}/staff/${staffId}`)?.line_user_id).toBe(LINE_USER);
        expect(replyText()).toContain('ลงทะเบียนสำเร็จ');
        const reply = fetchMock.mock.calls.find(c => String(c[0]).endsWith('/message/reply'))!;
        expect(reply[1].headers.Authorization).toBe(`Bearer ${STAFF_TOKEN}`);
    });

    it('a used or unknown code is refused with a clear message and nothing changes', async () => {
        const { staffId, code } = await issueCode();
        await run(signedReq(textEvent(code)));
        fetchMock.mockClear();
        const other = 'U' + 'z'.repeat(32);
        const ev = textEvent(code); ev.events[0].source.userId = other;
        await run(signedReq(ev));
        expect(replyText()).toContain('ถูกใช้ไปแล้ว');
        expect(read(`${B}/staff/${staffId}`)?.line_user_id).toBe(LINE_USER);
        fetchMock.mockClear();
        await run(signedReq(textEvent('HCS-AAAAAAAA')));
        expect(replyText()).toContain('ไม่พบรหัส');
    });

    it('other messages and follow events get the help text; bad JSON does not crash', async () => {
        await run(signedReq(textEvent('hello')));
        expect(replyText()).toContain('HCS-');
        fetchMock.mockClear();
        await run(signedReq({ events: [{ type: 'follow', replyToken: 'rt', source: { userId: LINE_USER } }] }));
        expect(replyText()).toContain('ลงทะเบียนรับงาน');
        const bad = Readable.from([Buffer.from('not json')]) as any;
        bad.method = 'POST';
        bad.headers = { 'x-line-signature': createHmac('sha256', SECRET).update('not json').digest('base64') };
        expect((await run(bad)).statusCode).toBe(200);
    });

    it('ignores stickers and events without a user', async () => {
        const res = await run(signedReq({ events: [
            { type: 'message', replyToken: 'rt', source: { userId: LINE_USER }, message: { type: 'sticker', id: '1' } },
            { type: 'message', replyToken: 'rt', source: {}, message: { type: 'text', text: 'x' } },
        ] }));
        expect(res.statusCode).toBe(200);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('a photo is answered with where to put it, not silence', async () => {
        await run(signedReq({ events: [{ type: 'message', replyToken: 'rt', source: { userId: LINE_USER }, message: { type: 'image', id: '1' } }] }));
        expect(replyText()).toContain('ส่งงาน');
    });

    const reply = () => JSON.parse(fetchMock.mock.calls.find(c => String(c[0]).endsWith('/message/reply'))![1].body).messages[0] as
        { text: string; quickReply?: { items: { action: { text: string } }[] } };

    it('help is about the person: a linked technician gets their jobs, not how to register', async () => {
        const { code } = await issueCode();
        await run(signedReq(textEvent(code)));
        fetchMock.mockClear();
        await run(signedReq(textEvent('ช่วยเหลือ')));
        expect(reply().text).toContain('Somsak');
        expect(reply().text).not.toContain('HCR-');
        expect(reply().quickReply!.items.map(i => i.action.text)).toEqual(['งานของฉัน', 'ส่งงาน']);
        fetchMock.mockClear();
        await run(signedReq(textEvent('hello'))); // anything the bot does not know
        expect(reply().text).toContain('Somsak');
    });

    it('a linked admin is shown the admin menu, with no owner figures in it', async () => {
        seed(`owner_line/${LINE_USER}`, { account_uid: OWNER, owner_uid: OWNER, linked_at: '2026-01-01T00:00:00.000Z' });
        await run(signedReq(textEvent('เมนู')));
        expect(reply().text).toContain('เมนูผู้ดูแล');
        expect(reply().text).not.toContain('#ยอด');
        expect(reply().quickReply!.items.map(i => i.action.text)).toEqual(['งานทั้งหมด', 'ทีมงาน', 'จดมิเตอร์']);
    });

    const card = () => JSON.parse(fetchMock.mock.calls.find(c => String(c[0]).endsWith('/message/reply'))![1].body).messages[0] as
        { type: string; contents: { footer: { contents: { action: { uri: string; label: string } }[] } } };
    const cardUrl = () => card().contents.footer.contents[0].action.uri;
    const linkAs = async (role: 'technician' | 'housekeeping') => {
        const staff = (await manager({ action: 'staff_create', name: 'Malee', role, phone: '0811112222' })).body.staff;
        seed(`${B}/staff/${staff.id}`, { ...read(`${B}/staff/${staff.id}`)!, line_user_id: LINE_USER });
        return staff.id as string;
    };

    it('each menu button answers with one card and one button made for that person', async () => {
        await linkAs('housekeeping');
        await run(signedReq(textEvent('งานของฉัน')));
        expect(card().type).toBe('flex');
        expect(cardUrl()).toMatch(/\/\?sp=[A-Za-z0-9_-]{30,}$/);
        fetchMock.mockClear();
        await run(signedReq(textEvent('ส่งงาน')));
        expect(cardUrl()).toMatch(/\/\?sp=[A-Za-z0-9_-]{30,}&go=next$/);
        fetchMock.mockClear();
        await run(signedReq(textEvent('จดมิเตอร์')));
        expect(cardUrl()).toMatch(/&go=meter$/);
        fetchMock.mockClear();
        await run(signedReq(textEvent('งานทั้งหมด')));
        expect(reply().text).toContain('สำหรับผู้ดูแล');
    });

    it('a technician is not offered the meter page; an admin opens it in the app', async () => {
        await linkAs('technician');
        await run(signedReq(textEvent('จดมิเตอร์')));
        expect(reply().text).toContain('แม่บ้านและผู้ดูแล');
        fetchMock.mockClear();
        seed(`owner_line/${LINE_USER}`, { account_uid: OWNER, owner_uid: OWNER, linked_at: '2026-01-01T00:00:00.000Z' });
        await run(signedReq(textEvent('จดมิเตอร์')));
        expect(cardUrl()).toMatch(/\/\?view=recording$/);
        fetchMock.mockClear();
        await run(signedReq(textEvent('ทีมงาน')));
        expect(cardUrl()).toContain('view=operations');
    });

    describe('rich menu follows the person', () => {
        const MENUS = { richmenus: ['register', 'technician', 'housekeeping', 'admin'].map(m => ({ richMenuId: `rm-${m}`, name: `horcare-staff-${m}` })) };
        const menuCalls = () => fetchMock.mock.calls.filter(c => /\/user\/U[^/]+\/richmenu/.test(String(c[0]))).map(c => `${c[1].method} ${String(c[0]).split('/user/')[1]}`);
        beforeEach(() => {
            resetStaffMenuCache();
            fetchMock.mockImplementation(async (url: string) => String(url).endsWith('/richmenu/list')
                ? { ok: true, status: 200, json: async () => MENUS }
                : { ok: true, status: 200, text: async () => '', headers: new Headers() });
        });

        it('someone not registered stays on the default (registration) menu: LINE is not called for it', async () => {
            await run(signedReq(textEvent('ลงทะเบียน')));
            expect(reply().text).toContain('ลงทะเบียนรับงาน');
            expect(menuCalls()).toEqual([]);
        });

        it('linking with a code switches to the working menu for the job, once', async () => {
            const { code } = await issueCode();
            await run(signedReq(textEvent(code)));
            expect(menuCalls()).toEqual([`POST ${LINE_USER}/richmenu/rm-technician`]);
            expect(read(`staff_line_menus/${LINE_USER}`)).toMatchObject({ menu: 'technician', id: 'rm-technician' });
            fetchMock.mockClear();
            await run(signedReq(textEvent('งานของฉัน')));
            expect(menuCalls()).toEqual([]);
        });

        it('a housekeeper gets the menu with meters, an admin the admin menu', async () => {
            await linkAs('housekeeping');
            await run(signedReq(textEvent('เมนู')));
            expect(menuCalls()).toEqual([`POST ${LINE_USER}/richmenu/rm-housekeeping`]);
            fetchMock.mockClear();
            seed(`owner_line/${LINE_USER}`, { account_uid: OWNER, owner_uid: OWNER, linked_at: '2026-01-01T00:00:00.000Z' });
            await run(signedReq(textEvent('เมนู')));
            expect(menuCalls()).toEqual([`POST ${LINE_USER}/richmenu/rm-admin`]);
        });

        it('switching the person off, or unlinking LINE, puts them back on the registration menu at once', async () => {
            const staffId = await linkAs('technician');
            await run(signedReq(textEvent('เมนู')));
            fetchMock.mockClear();
            expect((await manager({ action: 'staff_update_info', staff_id: staffId, active: false })).statusCode).toBe(200);
            expect(menuCalls()).toEqual([`DELETE ${LINE_USER}/richmenu`]);
            expect(read(`staff_line_menus/${LINE_USER}`)).toBeUndefined();

            await manager({ action: 'staff_update_info', staff_id: staffId, active: true });
            fetchMock.mockClear();
            expect((await manager({ action: 'staff_unlink', staff_id: staffId })).statusCode).toBe(200);
            expect(menuCalls()).toEqual([`DELETE ${LINE_USER}/richmenu`]);
        });

        it('a failing LINE call never breaks the reply', async () => {
            await linkAs('technician');
            fetchMock.mockImplementation(async (url: string) => {
                if (String(url).includes('/richmenu')) throw new Error('LINE down');
                return { ok: true, status: 200, text: async () => '', headers: new Headers() };
            });
            expect((await run(signedReq(textEvent('งานของฉัน')))).statusCode).toBe(200);
            expect(card().type).toBe('flex');
        });
    });

    it('"งานของฉัน" from someone not linked says so and leaves a registration untouched', async () => {
        seed(`staff_reg_sessions/${LINE_USER}`, { line_user_id: LINE_USER, owner_uid: OWNER, building_id: BLD, step: 'name', role: 'technician', updated_at: Date.now() });
        await run(signedReq(textEvent('งานของฉัน')));
        expect(reply().text).toContain('ยังไม่ได้ลงทะเบียน');
        expect(read(`staff_reg_sessions/${LINE_USER}`)?.step).toBe('name');
        fetchMock.mockClear();
        await run(signedReq(textEvent('ช่วยเหลือ')));
        expect(reply().text).toContain('กำลังลงทะเบียนค้างอยู่');
        expect(read(`staff_reg_sessions/${LINE_USER}`)?.step).toBe('name');
    });
});
