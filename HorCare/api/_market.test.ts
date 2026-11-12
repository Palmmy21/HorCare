import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);
// these tests exercise the market rules with many calls from one address; the limiter has its own tests (_abuse-guard.test.ts)
vi.mock('./_abuse-guard.js', async () => ({ ...(await vi.importActual<typeof import('./_abuse-guard.js')>('./_abuse-guard.js')), rateLimit: async () => ({ ok: true, retryAfterSec: 0 }) }));

import handler from './_market.js';
import { addAuthUser, fakeReq, fakeRes, listPaths, read, resetFake, seed, seedPortalLink } from './_fake-firestore.js';
import { permissionsForRole } from '../src/shared/permissions.js';
import { addDays, todayTh } from '../src/shared/market.js';

const OWNER = 'owner-1';
const BLD = 'mkt-1';
const B = `users/${OWNER}/buildings/${BLD}`;
const today = todayTh();
const d = (n: number) => addDays(today, n);

beforeEach(() => {
    resetFake();
    for (const [u, n] of [[OWNER, 'Owner'], ['mkt', 'Market'], ['fin', 'Fin'], ['shop', 'Shop'], ['stranger', 'S']]) addAuthUser(u, `${u}@x.com`, n);
    seed(`users/${OWNER}`, { uid: OWNER });
    seed(B, { id: BLD });
    seed(`${B}/data/config`, { building_type: 'market', bill_customization: { dorm_name: 'ตลาดทดสอบ' } });
    seed(`${B}/rooms/s1`, { id: 's1', room_number: 'A01' });
    seed(`${B}/rooms/s2`, { id: 's2', room_number: 'A02' });
    // a dormitory in the same account: market actions must not work there
    seed(`users/${OWNER}/buildings/dorm`, { id: 'dorm' });
    seed(`users/${OWNER}/buildings/dorm/data/config`, { building_type: 'dormitory' });
    seed(`users/${OWNER}/buildings/dorm/rooms/s1`, { id: 's1', room_number: '101' });
    for (const [uid, role] of [['mkt', 'market_admin'], ['fin', 'finance'], ['shop', 'shop_owner']] as const)
        seed(`users/${OWNER}/members/${uid}`, { uid, role, permissions: permissionsForRole(role), property_ids: ['*'], status: 'active' });
});

async function call(uid: string | null, body: Record<string, unknown>) {
    const res = fakeRes();
    await handler(fakeReq({ owner_uid: OWNER, building_id: BLD, ...body }, uid ?? undefined), res as never);
    return res as { statusCode: number; body: any };
}
/** A stall's public call: the stall is named by its portal link (room_id here only picks which link to send). */
function stall(action: string, over: Record<string, unknown> = {}) {
    const { room_id, ...rest } = over;
    const room = 'room_id' in over ? room_id : 's1';
    const bld = typeof over.building_id === 'string' ? over.building_id : BLD;
    return call(null, { action, ...rest, portal: typeof room === 'string' ? seedPortalLink(OWNER, bld, room) : undefined });
}
const closure = (over: Record<string, unknown> = {}) => stall('closure_submit', { from_date: d(1), to_date: d(2), reason: 'sick', ...over });
const walkin = (over: Record<string, unknown> = {}) => call(null, { action: 'walkin_submit', date: d(1), name: 'สมชาย', phone: '081-234-5678', goods: 'ผลไม้', ...over });
const notes = () => listPaths(`${B}/notifications/`).map(p => read(p)!);

describe('closures (public)', () => {
    it('a stall reports a closure and the owner is notified in-app only', async () => {
        const res = await closure({ note: 'ไปหาหมอ' });
        expect(res.statusCode).toBe(200);
        expect(res.body.closure).toMatchObject({ room_id: 's1', room_number: 'A01', status: 'active', note: 'ไปหาหมอ' });
        expect(notes()).toHaveLength(1);
        expect(notes()[0]).toMatchObject({ event: 'shop.closure_submitted', room_id: null });
        expect(notes()[0].body).toContain('A01');
    });

    it('rejects bad dates, reasons and notes, unknown stalls, and dormitories', async () => {
        for (const bad of [{ from_date: d(-1) }, { to_date: d(0) }, { to_date: d(90) }, { reason: 'x' }, { note: 'x'.repeat(201) }, { from_date: 'tomorrow' }])
            expect((await closure(bad)).statusCode).toBe(400);
        expect((await closure({ room_id: 'ghost' })).statusCode).toBe(401);
        expect((await closure({ room_id: undefined })).statusCode).toBe(401);
        expect((await call(null, { action: 'closure_submit', room_id: 's1', from_date: d(1), to_date: d(2), reason: 'sick' })).statusCode).toBe(401);
        expect((await closure({ building_id: 'dorm' })).statusCode).toBe(404);
        expect((await closure({ building_id: 'nope' })).statusCode).toBe(401);
        expect(listPaths(`${B}/shop_closures/`)).toHaveLength(0);
    });

    it('refuses overlapping closures and caps the number a stall can have open', async () => {
        await closure();
        expect((await closure({ from_date: d(2), to_date: d(3) })).body.error).toBe('overlaps_existing');
        for (let i = 0; i < 9; i++) await closure({ from_date: d(10 + i * 3), to_date: d(10 + i * 3) });
        expect((await closure({ from_date: d(50), to_date: d(50) })).body.error).toBe('limit_reached');
    });

    it('lists only that stall\'s upcoming closures, and a stall can only cancel its own', async () => {
        const mine = (await closure()).body.closure;
        await closure({ room_id: 's2' });
        const list = await stall('closure_list', { room_id: 's1' });
        expect(list.body.closures.map((c: any) => c.id)).toEqual([mine.id]);
        expect((await stall('closure_cancel', { room_id: 's2', closure_id: mine.id })).statusCode).toBe(404);
        expect((await stall('closure_cancel', { room_id: 's1', closure_id: mine.id })).statusCode).toBe(200);
        expect((await stall('closure_list', { room_id: 's1' })).body.closures).toEqual([]);
    });
});

describe('closure_ack (staff)', () => {
    it('market admin and owner may acknowledge; finance, shop owner, stranger, anonymous may not', async () => {
        const id = (await closure()).body.closure.id;
        for (const uid of ['fin', 'shop', 'stranger']) expect((await call(uid, { action: 'closure_ack', closure_id: id })).statusCode).toBe(403);
        expect((await call(null, { action: 'closure_ack', closure_id: id })).statusCode).toBe(401);
        expect((await call('mkt', { action: 'closure_ack', closure_id: id })).statusCode).toBe(200);
        expect(read(`${B}/shop_closures/${id}`)).toMatchObject({ ack_by: 'Market' });
        expect(listPaths(`users/${OWNER}/audit_logs/`)).toHaveLength(1);
        expect((await call(OWNER, { action: 'closure_ack', closure_id: 'ghost' })).statusCode).toBe(404);
    });
});

describe('closure_add (staff)', () => {
    const add = (uid: string | null, over: Record<string, unknown> = {}) =>
        call(uid, { action: 'closure_add', room_id: 's1', from_date: d(1), to_date: d(2), reason: 'holiday', ...over });

    it('staff records a closure for a stall: already acknowledged, audited, no notification', async () => {
        const res = await add('mkt');
        expect(res.statusCode).toBe(200);
        expect(res.body.closure).toMatchObject({ room_id: 's1', room_number: 'A01', status: 'active', ack_by: 'Market' });
        expect(listPaths(`users/${OWNER}/audit_logs/`)).toHaveLength(1);
        expect(notes()).toHaveLength(0);
        // the stall sees it in its portal list
        expect((await stall('closure_list', { room_id: 's1' })).body.closures).toHaveLength(1);
    });

    it('needs shop.update and keeps the same date and overlap rules', async () => {
        for (const uid of ['fin', 'shop', 'stranger']) expect((await add(uid)).statusCode).toBe(403);
        expect((await add(null)).statusCode).toBe(401);
        expect((await add(OWNER, { from_date: d(-1) })).statusCode).toBe(400);
        expect((await add(OWNER, { room_id: 'ghost' })).statusCode).toBe(404);
        await add(OWNER);
        expect((await add(OWNER, { from_date: d(2), to_date: d(3) })).body.error).toBe('overlaps_existing');
    });
});

describe('walk-in vendors', () => {
    it('a vendor announces a day, lands as pending, and the public gets no vendor data back', async () => {
        const res = await walkin();
        // only this request's own way into LINE comes back — nothing about any other vendor
        expect(Object.keys(res.body).sort()).toEqual(['line_code', 'line_url', 'market_name', 'oa_id', 'ok', 'status']);
        expect(res.body).toMatchObject({ ok: true, status: 'pending', market_name: 'ตลาดทดสอบ' });
        expect(res.body.line_code).toMatch(/^HCW-[A-Z0-9]{8}$/);
        const [w] = listPaths(`${B}/walk_ins/`).map(p => read(p)!);
        expect(w).toMatchObject({ name: 'สมชาย', phone: '0812345678', status: 'pending', source: 'public', date: d(1) });
        expect(notes()[0]).toMatchObject({ event: 'visitor.arriving' });
        expect(JSON.stringify(notes()[0])).not.toContain('0812345678');
    });

    it('the market\'s own scan link: no ids in it, it opens the form, and a new one retires the old', async () => {
        const made = await call('mkt', { action: 'walkin_link' });
        expect(made.statusCode).toBe(200);
        const url = new URL(made.body.url);
        const token = url.searchParams.get('walkin')!;
        expect(made.body.url).not.toContain(OWNER);
        expect(made.body.url).not.toContain(BLD);
        // the same link until replaced
        expect((await call('mkt', { action: 'walkin_link' })).body.url).toBe(made.body.url);
        // a walk-in with only the link: the form loads and the request lands in this market
        const info = await call(null, { owner_uid: undefined, building_id: undefined, action: 'walkin_info', link: token });
        expect(info.body).toMatchObject({ market_name: 'ตลาดทดสอบ' });
        expect(info.body.lots.map((l: { room_number: string }) => l.room_number)).toEqual(['A01', 'A02']);
        expect(JSON.stringify(info.body)).not.toContain(OWNER);
        expect((await call(null, { owner_uid: undefined, building_id: undefined, action: 'walkin_submit', link: token, date: d(1), name: 'สมศรี', phone: '0812345679', goods: 'ขนม' })).statusCode).toBe(200);
        expect(listPaths(`${B}/walk_ins/`)).toHaveLength(1);
        // staff only
        expect((await call('fin', { action: 'walkin_link' })).statusCode).toBe(403);
        // rotate: the old link is dead
        const fresh = await call('mkt', { action: 'walkin_link', rotate: true });
        expect(fresh.body.url).not.toBe(made.body.url);
        expect((await call(null, { owner_uid: undefined, building_id: undefined, action: 'walkin_info', link: token })).statusCode).toBe(404);
        expect((await call(null, { owner_uid: undefined, building_id: undefined, action: 'walkin_info', link: 'x'.repeat(24) })).statusCode).toBe(404);
    });

    it('a lot is a wish: counted per day, checked against the market, and the market gives the lot when approving', async () => {
        const a = await walkin({ preferred_room_id: 's1' });
        expect(a.statusCode).toBe(200);
        await walkin({ phone: '0812345670', preferred_room_id: 's1' });
        expect((await walkin({ phone: '0812345671', preferred_room_id: 'ghost' })).body.error).toBe('invalid_lot');
        // a dorm's room is not a lot of this market
        expect((await walkin({ phone: '0812345672', preferred_room_id: '../dorm' })).statusCode).toBe(400);
        const info = await call(null, { action: 'walkin_info', date: d(1) });
        expect(info.body.requested).toEqual({ s1: 2 });
        const [first] = listPaths(`${B}/walk_ins/`).map(p => read(p)!).filter(w => w.phone === '0812345678');
        expect(first.preferred_lot).toEqual({ room_id: 's1', room_number: 'A01', zone: null });
        // the clash is settled by giving the other lot
        const r = await call('mkt', { action: 'walkin_decide', walkin_id: first.id, status: 'approved', lot_room_id: 's2' });
        expect(r.statusCode).toBe(200);
        expect(read(`${B}/walk_ins/${first.id}`)).toMatchObject({ status: 'approved', lot: { room_id: 's2', room_number: 'A02' } });
        expect((await call('mkt', { action: 'walkin_decide', walkin_id: first.id, status: 'approved', lot_room_id: 'ghost' })).body.error).toBe('invalid_lot');
    });

    it('validates input and the date window; only markets accept walk-ins', async () => {
        for (const bad of [{ date: d(-1) }, { date: d(30) }, { phone: '123' }, { name: '' }, { goods: 'x' }, { date: 'today' }])
            expect((await walkin(bad)).statusCode).toBe(400);
        expect((await walkin({ building_id: 'dorm' })).statusCode).toBe(404);
        expect(listPaths(`${B}/walk_ins/`)).toHaveLength(0);
    });

    it('one live request per phone per day; a rejected one can be retried; the day is capped', async () => {
        await walkin();
        expect((await walkin()).body.error).toBe('already_requested');
        const id = listPaths(`${B}/walk_ins/`).map(p => read(p)!)[0].id;
        await call('mkt', { action: 'walkin_decide', walkin_id: id, status: 'rejected' });
        expect((await walkin()).statusCode).toBe(200);
        for (let i = 0; i < 200; i++) seed(`${B}/walk_ins/x${i}`, { id: `x${i}`, date: d(2), phone: `09${String(i).padStart(8, '0')}`, status: 'approved' });
        expect((await walkin({ date: d(2), phone: '0899999999' })).body.error).toBe('day_full');
    });

    it('staff decide and add; others cannot', async () => {
        await walkin();
        const id = listPaths(`${B}/walk_ins/`).map(p => read(p)!)[0].id;
        for (const uid of ['fin', 'shop', 'stranger']) expect((await call(uid, { action: 'walkin_decide', walkin_id: id, status: 'approved' })).statusCode).toBe(403);
        expect((await call(null, { action: 'walkin_decide', walkin_id: id, status: 'approved' })).statusCode).toBe(401);
        expect((await call('mkt', { action: 'walkin_decide', walkin_id: id, status: 'maybe' })).statusCode).toBe(400);
        expect((await call('mkt', { action: 'walkin_decide', walkin_id: 'ghost', status: 'approved' })).statusCode).toBe(404);
        expect((await call('mkt', { action: 'walkin_decide', walkin_id: id, status: 'approved' })).statusCode).toBe(200);
        expect(read(`${B}/walk_ins/${id}`)).toMatchObject({ status: 'approved', decided_by: 'Market' });

        const added = await call(OWNER, { action: 'walkin_add', date: d(3), name: 'สมหญิง', phone: '0898765432', goods: 'ขนม' });
        expect(added.body.walk_in).toMatchObject({ status: 'approved', source: 'staff' });
        expect((await call('fin', { action: 'walkin_add', date: d(3), name: 'สมหญิง', phone: '0898765433', goods: 'ขนม' })).statusCode).toBe(403);
    });

    it('rejects unknown actions', async () => {
        expect((await call(OWNER, { action: 'nuke' })).statusCode).toBe(400);
    });
});