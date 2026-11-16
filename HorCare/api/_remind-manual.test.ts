// "ทวงบิลค้างชำระ": unpaid bills of the month are chased on LINE, by the same people who may send bills.
import { beforeEach, describe, expect, it, vi } from 'vitest';

// the shared fake has no FieldValue.increment (the reminder counter): a plain number stands in for it here
vi.mock('./_firebase.js', async () => {
    const { firebaseMock } = await import('./_fake-firestore.js');
    Object.assign(firebaseMock.admin.firestore.FieldValue, { increment: (n: number) => n });
    return firebaseMock;
});
const pushed: string[] = [];
vi.mock('./_line.js', async () => {
    const real = await vi.importActual<typeof import('./_line.js')>('./_line.js');
    return { ...real, roomLineToken: async () => 'tenant-token', linePush: async (to: string) => { pushed.push(to); } };
});

import handler from './remind-manual.js';
import { addAuthUser, fakeReq, fakeRes, read, resetFake, seed } from './_fake-firestore.js';

const OWNER = 'owner-1';
const BLD = 'bld-A';
const B = `users/${OWNER}/buildings/${BLD}`;
const bill = (room: string, payment_status: string) => ({
    id: `2026-11_${room}`, room_id: room, room_number: room.replace('r', ''), month: '2026-11', is_saved: true,
    room_rent: 3000, elec_units: 10, elec_bill: 80, water_units: 2, water_bill: 36, total_bill: 3116, payment_status,
    created_at: '2026-11-01T00:00:00.000Z',
});
const remind = async (uid: string, body: object = { owner_uid: OWNER, building_id: BLD, month: '2026-11' }) => {
    const res = Object.assign(fakeRes(), { setHeader: () => undefined, end: () => undefined });
    await handler(fakeReq(body, uid), res as never);
    return res;
};
const member = (uid: string, role: string, property_ids = ['*'], status = 'active') => {
    addAuthUser(uid, `${uid}@example.com`);
    seed(`users/${OWNER}/members/${uid}`, { uid, role, property_ids, status });
};

beforeEach(() => {
    resetFake();
    pushed.length = 0;
    delete process.env.APP_URL;
    addAuthUser(OWNER, 'owner@example.com');
    seed(`${B}/data/config`, { bill_customization: { dorm_name: 'บ้านสุข', due_day: 5 } });
    seed(`${B}/rooms/r101`, { id: 'r101', room_number: '101', line_user_id: 'U101' });
    seed(`${B}/rooms/r102`, { id: 'r102', room_number: '102', line_user_id: 'U102' });
    seed(`${B}/rooms/r103`, { id: 'r103', room_number: '103' });                 // not on LINE
    seed(`${B}/bills/2026-11_r101`, bill('r101', 'unpaid'));
    seed(`${B}/bills/2026-11_r102`, bill('r102', 'paid'));
    seed(`${B}/bills/2026-11_r103`, bill('r103', 'unpaid'));
});

describe('chasing unpaid bills', () => {
    it('the owner, the property manager and finance chase the owner\'s unpaid bills', async () => {
        member('pm', 'property_manager');
        member('fin', 'finance');
        for (const uid of [OWNER, 'pm', 'fin']) {
            expect((await remind(uid)).body, uid).toMatchObject({ data: { sent: 1, skipped: 1 } });
        }
        expect(pushed).toEqual(['U101', 'U101', 'U101']);                          // never the room that paid
        expect(read(`${B}/bills/2026-11_r101`)?.last_reminded_at).toBeTruthy();
        // the owner's own call, as the app made it before owner_uid existed
        expect((await remind(OWNER, { building_id: BLD, month: '2026-11' })).body).toMatchObject({ data: { sent: 1 } });
    });

    it('nobody else: other roles, a member who left, another property, a stranger', async () => {
        for (const role of ['front_desk', 'technician', 'housekeeping', 'market_admin', 'shop_owner', 'tenant']) member(`m-${role}`, role);
        member('gone', 'finance', ['*'], 'removed');
        member('elsewhere', 'finance', ['bld-B']);
        addAuthUser('stranger', 's@example.com');
        for (const uid of ['m-front_desk', 'm-technician', 'm-housekeeping', 'm-market_admin', 'm-shop_owner', 'm-tenant', 'gone', 'elsewhere', 'stranger']) {
            expect((await remind(uid)).statusCode, uid).toBe(403);
        }
        expect(pushed).toEqual([]);
        expect(read(`${B}/bills/2026-11_r101`)?.last_reminded_at).toBeUndefined();
    });
});
