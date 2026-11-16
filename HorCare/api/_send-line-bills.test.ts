// One room's bill is sent (or sent again) on its own, and the whole month still goes out as before.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);
const pushed: { to: string; messages: object[] }[] = [];
let lineFails = false;
vi.mock('./_line.js', async () => {
    const real = await vi.importActual<typeof import('./_line.js')>('./_line.js');
    return {
        ...real, roomLineToken: async () => 'tenant-token',
        linePush: async (to: string, messages: object[]) => { if (lineFails) throw new Error('LINE 400'); pushed.push({ to, messages }); },
    };
});
vi.mock('./_ledger-auto.js', () => ({ autoPostSafe: async () => undefined }));

import handler from './_send-line-bills.js';
import { addAuthUser, fakeReq, fakeRes, read, resetFake, seed } from './_fake-firestore.js';

const OWNER = 'owner-1';
const BLD = 'bld-A';
const B = `users/${OWNER}/buildings/${BLD}`;
const bill = (room: string, over: object = {}) => ({
    id: `2026-11_${room}`, room_id: room, room_number: room.replace('r', ''), month: '2026-11', is_saved: true,
    room_rent: 3000, elec_units: 10, elec_bill: 80, water_units: 2, water_bill: 36, total_bill: 3116, payment_status: 'unpaid',
    created_at: '2026-11-01T00:00:00.000Z', ...over,
});
// this handler also sets CORS headers, which the shared fake response does not carry
const newRes = () => Object.assign(fakeRes(), { setHeader: () => undefined, end: () => undefined });
const send = async (body: object, uid = OWNER) => {
    const res = newRes();
    await handler(fakeReq(body, uid), res as never);
    return res;
};

beforeEach(() => {
    resetFake();
    pushed.length = 0;
    lineFails = false;
    delete process.env.APP_URL;
    addAuthUser(OWNER, 'owner@example.com');
    seed(`${B}/data/config`, { bill_customization: { dorm_name: 'บ้านสุข', due_day: 5 } });
    seed(`${B}/rooms/r101`, { id: 'r101', room_number: '101', line_user_id: 'U101' });
    seed(`${B}/rooms/r102`, { id: 'r102', room_number: '102', line_user_id: 'U102' });
    seed(`${B}/rooms/r103`, { id: 'r103', room_number: '103' });                       // not on LINE
    seed(`${B}/bills/2026-11_r101`, bill('r101'));
    seed(`${B}/bills/2026-11_r102`, bill('r102', { is_notified: true }));
    seed(`${B}/bills/2026-11_r103`, bill('r103'));
    seed(`${B}/bills/2026-11_r104`, bill('r104', { is_saved: false }));
});

describe('sending one room its bill', () => {
    it('goes to that room only and is marked as sent', async () => {
        const res = await send({ building_id: BLD, bill_id: '2026-11_r101' });
        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ data: { sent: 1, skipped: 0 } });
        expect(pushed.map(p => p.to)).toEqual(['U101']);
        expect(read(`${B}/bills/2026-11_r101`)?.is_notified).toBe(true);
        expect(read(`${B}/bills/2026-11_r103`)?.is_notified).toBeUndefined();
    });

    it('a bill already sent can be sent again', async () => {
        expect((await send({ building_id: BLD, bill_id: '2026-11_r102' })).body).toMatchObject({ data: { sent: 1 } });
        expect(pushed.map(p => p.to)).toEqual(['U102']);
    });

    it('a room that is not on LINE is reported, not sent and not marked', async () => {
        const res = await send({ building_id: BLD, bill_id: '2026-11_r103' });
        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ data: { sent: 0, skipped: 1, reason: 'not_linked' } });
        expect(pushed).toEqual([]);
        expect(read(`${B}/bills/2026-11_r103`)?.is_notified).toBeUndefined();
    });

    it('refuses a bill that does not exist or is not saved yet, and one of another owner', async () => {
        expect((await send({ building_id: BLD, bill_id: 'nope' })).statusCode).toBe(404);
        expect((await send({ building_id: BLD, bill_id: '2026-11_r104' })).statusCode).toBe(404);
        addAuthUser('someone-else', 'x@example.com');
        expect((await send({ building_id: BLD, bill_id: '2026-11_r101' }, 'someone-else')).statusCode).toBe(404);
        expect(pushed).toEqual([]);
    });

    it('says so when LINE refuses the message, and leaves the bill unmarked', async () => {
        lineFails = true;
        const res = await send({ building_id: BLD, bill_id: '2026-11_r101' });
        expect(res.statusCode).toBe(502);
        expect(String((res.body as { error: string }).error)).toContain('101');
        expect(read(`${B}/bills/2026-11_r101`)?.is_notified).toBeUndefined();
    });
});

describe('who may send bills', () => {
    const member = (uid: string, role: string, property_ids = ['*'], status = 'active') => {
        addAuthUser(uid, uid + '@example.com');
        seed('users/' + OWNER + '/members/' + uid, { uid, role, property_ids, status });
    };
    const one = (uid: string) => send({ owner_uid: OWNER, building_id: BLD, bill_id: '2026-11_r101' }, uid);
    const month = (uid: string) => send({ owner_uid: OWNER, building_id: BLD, month: '2026-11' }, uid);

    it('the owner, the property manager and finance — one room or the whole month', async () => {
        member('pm', 'property_manager');
        member('fin', 'finance');
        expect((await send({ owner_uid: OWNER, building_id: BLD, bill_id: '2026-11_r101' })).body).toMatchObject({ data: { sent: 1 } });
        expect((await one('pm')).body).toMatchObject({ data: { sent: 1 } });
        expect((await one('fin')).body).toMatchObject({ data: { sent: 1 } });
        expect((await month('fin')).body).toMatchObject({ data: { sent: 2, skipped: 1 } });
        expect(read(B + '/bills/2026-11_r101')?.is_notified).toBe(true);     // the owner's bill, not a copy under the member
    });

    it('nobody else: other roles, a member who left, another property, a stranger', async () => {
        for (const role of ['front_desk', 'technician', 'housekeeping', 'market_admin', 'shop_owner', 'tenant']) member('m-' + role, role);
        member('gone', 'finance', ['*'], 'removed');
        member('elsewhere', 'finance', ['bld-B']);
        addAuthUser('stranger', 's@example.com');
        for (const uid of ['m-front_desk', 'm-technician', 'm-housekeeping', 'm-market_admin', 'm-shop_owner', 'm-tenant', 'gone', 'elsewhere', 'stranger']) {
            expect((await one(uid)).statusCode, uid).toBe(403);
            expect((await month(uid)).statusCode, uid).toBe(403);
        }
        expect(pushed).toEqual([]);
        expect(read(B + '/bills/2026-11_r101')?.is_notified).toBeUndefined();
    });
});

describe('sending the whole month', () => {
    it('still sends every saved bill of a room on LINE and skips the rest', async () => {
        const res = await send({ building_id: BLD, month: '2026-11' });
        expect(res.body).toMatchObject({ data: { sent: 2, skipped: 1 } });
        expect(pushed.map(p => p.to).sort()).toEqual(['U101', 'U102']);
        expect((await send({ building_id: BLD })).statusCode).toBe(400);
    });
});
