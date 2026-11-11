import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import webhook from './line-webhook.js';
import invitations from './_invitations.js';
import tenantLink from './_tenant-link.js';
import { recordFriendship } from './_line-binding.js';
import { addAuthUser, fakeReq, fakeRes, listPaths, read, resetFake, seed } from './_fake-firestore.js';

// One LINE account that looks after several rooms: a teacher renting rooms for students, the school paying.
const OWNER = 'owner-1';
const BLD = 'bld-A';
const B = `users/${OWNER}/buildings/${BLD}`;
const SECRET = 'tenant-secret';
const TEACHER = 'U' + 'a'.repeat(32);
const LINK = `line_rooms/${TEACHER}`;
// a real (1×1) PNG: the slip code decodes and compresses whatever it is given
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const fetchMock = vi.fn();

const room = (id: string, number: string) => ({ uid: OWNER, building_id: BLD, room_id: id, room_number: number, dorm_name: 'Dorm A', due_day: 5 });
const bill = (roomId: string, number: string, total: number, status = 'unpaid') => ({
    id: `b-${roomId}`, room_id: roomId, room_number: number, month: '2026-11', is_saved: true, payment_status: status,
    total_bill: total, rent_amount: total, water_units: 0, electric_units: 0, water_bill: 0, electric_bill: 0, created_at: '2026-11-01T00:00:00.000Z',
});

beforeEach(() => {
    resetFake();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => String(url).includes('/content')
        ? { ok: true, status: 200, headers: new Headers({ 'content-type': 'image/png' }), arrayBuffer: async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength) }
        : { ok: true, status: 200, text: async () => '', json: async () => ({}), headers: new Headers() });
    vi.stubGlobal('fetch', fetchMock);
    process.env.LINE_CHANNEL_SECRET = SECRET;
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'tenant-token';
    process.env.APP_URL = 'https://app.example';
    process.env.PORTAL_TOKEN_SECRET = 'portal-secret';
    addAuthUser(OWNER, 'o@x.com', 'Owner');
    seed(`users/${OWNER}`, { uid: OWNER });
    seed(B, { id: BLD });
    seed(`${B}/data/config`, { bill_customization: { dorm_name: 'Dorm A', due_day: 5 } });
    for (const [id, n] of [['r101', '101'], ['r102', '102'], ['r103', '103']]) {
        seed(`${B}/rooms/${id}`, { room_number: n, is_active: true, line_user_id: TEACHER, line_channel: 'tenant' });
        seed(`${B}/tenants/${id}`, { full_name: 'ครูสมศรี' });
    }
    seed(LINK, { ...room('r101', '101'), rooms: [room('r101', '101'), room('r102', '102'), room('r103', '103')] });
    seed(`${B}/bills/b-r101`, bill('r101', '101', 3500));
    seed(`${B}/bills/b-r102`, bill('r102', '102', 4200));
    seed(`${B}/bills/b-r103`, bill('r103', '103', 3500, 'paid'));
});

afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of ['LINE_CHANNEL_SECRET', 'LINE_CHANNEL_ACCESS_TOKEN', 'APP_URL', 'PORTAL_TOKEN_SECRET']) delete process.env[k];
});

async function post(events: object[]) {
    const raw = Buffer.from(JSON.stringify({ events }));
    const req = Readable.from([raw]) as never as { method: string; headers: object };
    req.method = 'POST';
    req.headers = { 'x-line-signature': createHmac('sha256', SECRET).update(raw).digest('base64') };
    const res = fakeRes();
    fetchMock.mockClear();
    await webhook(req as never, res as never);
    expect(res.statusCode).toBe(200);
}
const text = (t: string, user = TEACHER) => ({ type: 'message', replyToken: 'rt', source: { userId: user }, message: { type: 'text', text: t } });
const image = (id = 'img-1') => ({ type: 'message', replyToken: 'rt', source: { userId: TEACHER }, message: { type: 'image', id } });
const postback = (data: string) => ({ type: 'postback', replyToken: 'rt', source: { userId: TEACHER }, postback: { data } });
interface Msg { type: string; text?: string; altText?: string; contents?: { body?: { contents: { action?: { type: string; label: string; data?: string; uri?: string } }[] } } }
const replies = (): Msg[] => {
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/v2/bot/message/reply'));
    return call ? (JSON.parse(call[1].body) as { messages: Msg[] }).messages : [];
};
const buttons = (m: Msg) => (m.contents?.body?.contents ?? []).map(c => c.action).filter((a): a is NonNullable<typeof a> => !!a);

describe('one LINE account, several rooms', () => {
    it('"บิล" shows the latest bill of every room, unpaid ones first, and says they are separate', async () => {
        await post([text('บิล')]);
        const out = replies();
        expect(out.map(m => m.type)).toEqual(['text', 'flex', 'flex', 'flex']);
        expect(out[0].text).toContain('101, 102 และ 103');
        expect(out[0].text).toContain('โอนแยกทีละห้อง');
    });

    it('a room whose LINE was cleared in the app is dropped: its bill is never shown, and the list heals', async () => {
        seed(`${B}/rooms/r103`, { room_number: '103', is_active: true });   // the tenant moved out
        await post([text('บิล')]);
        expect(replies().map(m => m.type)).toEqual(['text', 'flex', 'flex']);
        expect(replies()[0].text).not.toContain('103');
        expect((read(LINK)?.rooms as { room_id: string }[]).map(r => r.room_id)).toEqual(['r101', 'r102']);
    });

    it('"พอร์ทัล" offers one button per room', async () => {
        await post([text('พอร์ทัล')]);
        const b = buttons(replies()[0]);
        expect(b.map(x => x.label)).toEqual(['ห้อง 101', 'ห้อง 102', 'ห้อง 103']);
        expect(new Set(b.map(x => x.uri)).size).toBe(3);
        for (const x of b) expect(x.uri).toMatch(/^https:\/\/app\.example\/\?p=/);
    });

    it('a slip is asked which room it pays when more than one room owes, and is then recorded on that room only', async () => {
        await post([text('ส่งสลิป')]);
        await post([image('img-9')]);
        const ask = replies()[0];
        expect(ask.altText).toContain('ห้องไหน');
        const choices = buttons(ask);
        expect(choices.map(c => c.label)).toEqual(['ห้อง 101 · ฿3,500', 'ห้อง 102 · ฿4,200']);   // 103 is paid: not offered
        expect(read(`${B}/bills/b-r101`)?.slip_submitted_at).toBeUndefined();
        expect(read(`${B}/bills/b-r102`)?.slip_submitted_at).toBeUndefined();
        expect(read(LINK)?.slip_choice).toMatchObject({ message_id: 'img-9' });

        await post([postback(choices[1].data!)]);
        expect(read(`${B}/bills/b-r102`)).toMatchObject({ payment_status: 'pending' });
        expect(read(`${B}/bills/b-r102`)?.slip_submitted_at).toBeTruthy();
        expect(read(`${B}/bills/b-r101`)?.slip_submitted_at).toBeUndefined();
        expect(read(LINK)?.slip_choice).toBeUndefined();
        expect(replies()[0].type).toBe('flex');

        // the same button again: the photo was used, nothing is recorded twice
        await post([postback(choices[0].data!)]);
        expect(replies()[0].text).toContain('ส่งรูปสลิปอีกครั้ง');
        expect(read(`${B}/bills/b-r101`)?.slip_submitted_at).toBeUndefined();
    });

    it('a slip goes straight to the only room that still owes', async () => {
        seed(`${B}/bills/b-r101`, bill('r101', '101', 3500, 'paid'));
        await post([text('ส่งสลิป')]);
        await post([image()]);
        expect(read(`${B}/bills/b-r102`)?.slip_submitted_at).toBeTruthy();
        expect(read(LINK)?.slip_choice).toBeUndefined();
    });

    it('with nothing owed anywhere, says so and records nothing', async () => {
        seed(`${B}/bills/b-r101`, bill('r101', '101', 3500, 'paid'));
        seed(`${B}/bills/b-r102`, bill('r102', '102', 4200, 'paid'));
        await post([text('ส่งสลิป')]);
        await post([image()]);
        expect(replies()[0].text).toContain('ไม่มียอดค้างชำระ');
    });

    it('a slip button for a room that is not theirs does nothing', async () => {
        seed(`users/other/buildings/bX/rooms/rX`, { room_number: '900', is_active: true, line_user_id: 'U' + 'z'.repeat(32) });
        seed(`users/other/buildings/bX/bills/bX1`, { ...bill('rX', '900', 100), id: 'bX1' });
        seed(LINK, { ...read(LINK)!, slip_choice: { message_id: 'img-1', until: Date.now() + 60_000 } });
        await post([postback('sliproom|other|bX|rX')]);
        expect(replies()).toEqual([]);
        expect(read('users/other/buildings/bX/bills/bX1')?.slip_submitted_at).toBeUndefined();
    });

    it('adding or blocking the OA is recorded on every room', async () => {
        await recordFriendship(TEACHER, false);
        expect(['r101', 'r102', 'r103'].map(id => read(`${B}/rooms/${id}`)?.line_unreachable)).toEqual([true, true, true]);
        await recordFriendship(TEACHER, true);
        expect(['r101', 'r102', 'r103'].map(id => read(`${B}/rooms/${id}`)?.line_unreachable)).toEqual([undefined, undefined, undefined]);
    });

    it('the owner unlinking one room leaves the account its other rooms; unlinking the primary promotes the next', async () => {
        const unlink = async (roomId: string) => {
            const res = fakeRes();
            await tenantLink(fakeReq({ action: 'unlink', owner_uid: OWNER, building_id: BLD, room_id: roomId }, OWNER) as never, res as never);
            return res.statusCode;
        };
        expect(await unlink('r102')).toBe(200);
        expect(read(`${B}/rooms/r102`)?.line_user_id).toBeUndefined();
        expect((read(LINK)?.rooms as { room_id: string }[]).map(r => r.room_id)).toEqual(['r101', 'r103']);

        expect(await unlink('r101')).toBe(200);
        expect(read(LINK)).toMatchObject({ room_id: 'r103', room_number: '103' });
        expect(read(LINK)?.rooms).toBeUndefined();

        expect(await unlink('r103')).toBe(200);
        expect(read(LINK)).toBeUndefined();
    });
});

describe('registering a second room in the chat', () => {
    const STUDENT_ROOMS = `${B}/rooms`;
    const invite = async (roomId: string) => {
        const res = fakeRes();
        await invitations(fakeReq({ action: 'create', owner_uid: OWNER, building_id: BLD, room_id: roomId, tenant_name: 'ครูสมศรี' }, OWNER) as never, res as never);
        return (res.body as { code: string }).code;
    };
    beforeEach(() => {
        // start over: the teacher holds room 101 only, 102 is free
        seed(LINK, room('r101', '101'));
        seed(`${STUDENT_ROOMS}/r102`, { room_number: '102', is_active: true });
        seed(`${STUDENT_ROOMS}/r103`, { room_number: '103', is_active: true });
    });

    it('asks "เพิ่มห้อง" or "ย้ายห้อง", then adds the room and keeps the first', async () => {
        await post([text(await invite('r102'))]);
        expect(replies()[0].text).toContain('คุณลงทะเบียนห้อง 101 ไว้แล้ว');
        expect(read(`${STUDENT_ROOMS}/r102`)?.line_user_id).toBeUndefined();

        await post([text('อะไรนะ')]);                       // not an answer: asked again, nothing bound
        expect(replies()[0].text).toContain('กรุณาเลือก');

        await post([text('เพิ่มห้อง')]);
        expect(replies()[0].text).toContain('ดูแลห้อง 101 และ 102');
        expect(read(`${STUDENT_ROOMS}/r101`)?.line_user_id).toBe(TEACHER);
        expect(read(`${STUDENT_ROOMS}/r102`)?.line_user_id).toBe(TEACHER);
        expect(read(`line_pending/${TEACHER}`)).toBeUndefined();
    });

    it('"ย้ายห้อง" leaves the old room, as registering always did', async () => {
        await post([text(await invite('r102'))]);
        await post([text('ย้ายห้อง')]);
        expect(read(`${STUDENT_ROOMS}/r101`)?.line_user_id).toBeUndefined();
        expect(read(`${STUDENT_ROOMS}/r102`)?.line_user_id).toBe(TEACHER);
        expect(read(LINK)).toMatchObject({ room_id: 'r102' });
    });

    it('"ยกเลิก" drops the question and changes nothing', async () => {
        await post([text(await invite('r102'))]);
        await post([text('ยกเลิก')]);
        await post([text('เพิ่มห้อง')]);                    // no longer an answer to anything
        expect(read(`${STUDENT_ROOMS}/r102`)?.line_user_id).toBeUndefined();
        expect(read(LINK)?.rooms).toBeUndefined();
    });

    it('someone with one room is unaffected: their slip is never asked about', async () => {
        await post([text('ส่งสลิป')]);
        await post([image()]);
        expect(read(`${B}/bills/b-r101`)?.slip_submitted_at).toBeTruthy();
        expect(read(LINK)?.slip_choice).toBeUndefined();
    });
});

describe('registering with the property code and a room number (no invitation, nothing to switch on)', () => {
    const NEW = 'U' + 'd'.repeat(32);
    const send = async (t: string, user = NEW) => post([text(t, user)]);
    const requests = () => listPaths(`${B}/line_requests/`).map(p => read(p)!);
    beforeEach(() => {
        seed('dorm_codes/HC-K7MN2P', { uid: OWNER, building_id: BLD, dorm_name: 'Dorm A', due_day: 5 });
        // room 102 has never been registered; 101 belongs to the teacher
        seed(LINK, room('r101', '101'));
        seed(`${B}/rooms/r102`, { room_number: '102', is_active: true });
        seed(`${B}/rooms/r103`, { room_number: 'A03', is_active: true });
    });

    it('a room nobody registered is given at once, whatever the old "invitation only" setting says', async () => {
        seed(`${B}/data/config`, { bill_customization: { dorm_name: 'Dorm A', due_day: 5 }, claim_mode: 'invitation_only' });
        await send('HC-K7MN2P');
        expect(replies()[0].text).toContain('กรุณาพิมพ์เลขห้อง');
        await send('102');
        expect(replies()[0].text).toContain('ลงทะเบียนสำเร็จ');
        expect(read(`${B}/rooms/r102`)?.line_user_id).toBe(NEW);
        expect(read(`line_rooms/${NEW}`)).toMatchObject({ room_id: 'r102', room_number: '102', via: 'room_number' });
        expect(requests()).toEqual([]);
    });

    it('finds a room typed in lower case', async () => {
        await send('HC-K7MN2P');
        await send('a03');
        expect(read(`${B}/rooms/r103`)?.line_user_id).toBe(NEW);
    });

    it('a room that already has someone becomes a request: the tenant in it is not replaced until an admin approves', async () => {
        await send('HC-K7MN2P');
        await send('101');
        expect(replies()[0].text).toContain('ส่งคำขอให้แอดมินแล้ว');
        expect(read(`${B}/rooms/r101`)?.line_user_id).toBe(TEACHER);
        expect(read(`line_rooms/${NEW}`)).toBeUndefined();
        expect(requests()).toHaveLength(1);
        expect(requests()[0]).toMatchObject({ room_number: '101', status: 'pending', line_user_id: NEW });
        expect(requests()[0].add).toBeUndefined();
    });

    it('one more room for an account that has one is asked about, then waits for the owner', async () => {
        await send('HC-K7MN2P', TEACHER);
        await send('102', TEACHER);
        expect(replies()[0].text).toContain('คุณลงทะเบียนห้อง 101 ไว้แล้ว');
        await send('เพิ่มห้อง', TEACHER);
        expect(replies()[0].text).toContain('ส่งคำขอเพิ่มห้อง 102');
        expect(read(`${B}/rooms/r102`)?.line_user_id).toBeUndefined();
        expect(requests()[0]).toMatchObject({ room_number: '102', add: true, other_rooms: '101', status: 'pending' });
    });

    it('moving to a free room by number releases the old one, as a move always did', async () => {
        await send('HC-K7MN2P', TEACHER);
        await send('102', TEACHER);
        await send('ย้ายห้อง', TEACHER);
        expect(read(`${B}/rooms/r101`)?.line_user_id).toBeUndefined();
        expect(read(`${B}/rooms/r102`)?.line_user_id).toBe(TEACHER);
    });

    it('a number that is not a room is asked for again', async () => {
        await send('HC-K7MN2P');
        await send('999');
        expect(replies()[0].text).toContain('ไม่พบห้อง "999"');
        expect(read(`line_pending/${NEW}`)?.step).toBe('waiting_room_number');
    });
});
