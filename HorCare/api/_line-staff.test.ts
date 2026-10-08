import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import webhook from './line-staff-webhook.js';
import workOrders from './_work-orders.js';
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
        expect(replyText()).toContain('เชื่อมต่อ LINE สำเร็จ');
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
        expect(replyText()).toContain('รหัสเชื่อม');
        const bad = Readable.from([Buffer.from('not json')]) as any;
        bad.method = 'POST';
        bad.headers = { 'x-line-signature': createHmac('sha256', SECRET).update('not json').digest('base64') };
        expect((await run(bad)).statusCode).toBe(200);
    });

    it('ignores non-text events and events without a user', async () => {
        const res = await run(signedReq({ events: [
            { type: 'message', replyToken: 'rt', source: { userId: LINE_USER }, message: { type: 'image', id: '1' } },
            { type: 'message', replyToken: 'rt', source: {}, message: { type: 'text', text: 'x' } },
        ] }));
        expect(res.statusCode).toBe(200);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
