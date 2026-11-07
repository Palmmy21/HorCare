import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import handler, { isRoomCode, scanRoomCode } from './_room-qr.js';
import { addAuthUser, fakeReq, fakeRes, listPaths, read, resetFake, seed } from './_fake-firestore.js';
import { permissionsForRole } from '../src/shared/permissions.js';
import { MAX_PENDING_PER_ROOM, QR_CHUNK } from '../src/shared/roomQr.js';

const OWNER = 'owner-1';
const BLD = 'bld-A';
const B = `users/${OWNER}/buildings/${BLD}`;
const LINE_A = 'U' + 'a'.repeat(32);
const LINE_B = 'U' + 'b'.repeat(32);
const LINE_C = 'U' + 'c'.repeat(32);
const lineId = (i: number) => 'U' + String(i).padStart(32, 'd');

const fetchMock = vi.fn();

beforeEach(() => {
    resetFake();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ displayName: 'Malee' }), text: async () => '', headers: new Headers() });
    vi.stubGlobal('fetch', fetchMock);
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'tenant-token';
    process.env.VITE_LINE_OA_ID = '@horcare';
    addAuthUser(OWNER, 'o@x.com', 'Owner');
    addAuthUser('staff', 's@x.com');
    addAuthUser('other-owner', 'x@x.com');
    seed(`users/${OWNER}`, { uid: OWNER });
    seed(B, { id: BLD, name: 'Dorm A' });
    seed(`${B}/data/config`, { bill_customization: { dorm_name: 'Dorm A', due_day: 7 } });
    seed(`${B}/rooms/r101`, { room_number: '101', is_active: true });
    seed(`${B}/rooms/r102`, { room_number: '102', is_active: true });
});

afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    delete process.env.VITE_LINE_OA_ID;
});

async function call(uid: string | undefined, body: Record<string, unknown>) {
    const res = fakeRes();
    await handler(fakeReq({ owner_uid: OWNER, building_id: BLD, ...body }, uid), res as never);
    return res as unknown as { statusCode: number; body: Record<string, any> };
}
const codeOf = async (room = 'r101') => (await call(OWNER, { action: 'codes', room_ids: [room] })).body.codes[0].code as string;
const pendingId = async () => (await call(OWNER, { action: 'status' })).body.requests[0].id as string;

async function open(code: string) {
    const res = { statusCode: 0, location: undefined as string | undefined,
        redirect(s: number, u: string) { res.statusCode = s; res.location = u; },
        setHeader() { /* not under test */ },
        status(s: number) { res.statusCode = s; return res; },
        send() { /* not under test */ },
    };
    const req = fakeReq({}, undefined, 'GET') as unknown as { query: object; headers: object };
    req.query = { c: code };
    await handler(req as never, res as never);
    return res;
}

describe('a room has one permanent code', () => {
    it('printing again returns the same code, so a lost card is only a reprint', async () => {
        const first = await codeOf();
        expect(isRoomCode(first)).toBe(true);
        expect(await codeOf()).toBe(first);
        expect(listPaths('room_codes/')).toHaveLength(1);
    });

    it('covers linked rooms too: the next tenant uses the same card', async () => {
        seed(`${B}/rooms/r102`, { room_number: '102', is_active: true, line_user_id: LINE_B });
        expect(isRoomCode(await codeOf('r102'))).toBe(true);
    });

    it('rotate retires the old code', async () => {
        const old = await codeOf();
        const fresh = (await call(OWNER, { action: 'rotate', room_ids: ['r101'] })).body.codes[0].code;
        expect(fresh).not.toBe(old);
        expect((await scanRoomCode(LINE_A, old)).outcome).toBe('invalid');
        expect((await scanRoomCode(LINE_A, fresh)).outcome).toBe('bound');
    });

    it('refuses more rooms than one transaction can hold, and forged ids', async () => {
        const many = await call(OWNER, { action: 'codes', room_ids: Array.from({ length: QR_CHUNK + 1 }, (_, i) => `x${i}`) });
        expect(many.statusCode).toBe(400);
        const forged = await call(OWNER, { action: 'codes', room_ids: ['../../secrets/x', 'r102'] });
        expect(forged.body.codes.map((c: { room_id: string }) => c.room_id)).toEqual(['r102']);
    });

    it('needs invitation.create in this organization', async () => {
        expect((await call(undefined, { action: 'codes', room_ids: ['r101'] })).statusCode).toBe(401);
        expect((await call('other-owner', { action: 'codes', room_ids: ['r101'] })).statusCode).toBe(403);
    });
});

describe('the QR address', () => {
    it('with LIFF set up, a scan on the shared OA opens LIFF: nothing to send', async () => {
        process.env.VITE_LIFF_ID = '123-abc';
        const code = await codeOf();
        const res = await open(code);
        expect(res.location).toBe(`https://liff.line.me/123-abc?room=${code}`);
        delete process.env.VITE_LIFF_ID;
    });

    it('a property on its own OA keeps the chat, even with LIFF set up', async () => {
        process.env.VITE_LIFF_ID = '123-abc';
        process.env.VITE_LINE_MARKET_OA_ID = '@market';
        const code = await codeOf();
        seed(B, { id: BLD, building_type: 'market' });
        expect((await open(code)).location).toContain('oaMessage/%40market');
        delete process.env.VITE_LIFF_ID;
        delete process.env.VITE_LINE_MARKET_OA_ID;
    });

    it('sends a scan to the OA with the code ready to send', async () => {
        const res = await open(await codeOf());
        expect(res.statusCode).toBe(302);
        expect(res.location).toMatch(/^https:\/\/line\.me\/R\/oaMessage\/%40horcare\/\?HCR-/);
    });

    it('sends market stalls to the vendor OA, chosen when scanned, not when printed', async () => {
        const code = await codeOf();
        process.env.VITE_LINE_MARKET_OA_ID = '@market';
        seed(B, { id: BLD, building_type: 'market' });
        expect((await open(code)).location).toContain('%40market');
        delete process.env.VITE_LINE_MARKET_OA_ID;
    });

    it('dead and malformed codes get a page, never a redirect', async () => {
        expect((await open('HCR-AAAAAAAAAA')).statusCode).toBe(404);
        expect((await open('<script>')).statusCode).toBe(404);
    });
});

describe('scanning', () => {
    it('binds a free room straight away', async () => {
        expect(await scanRoomCode(LINE_A, await codeOf())).toMatchObject({ outcome: 'bound', roomNumber: '101' });
        expect(read(`${B}/rooms/r101`)?.line_user_id).toBe(LINE_A);
        expect(read(`line_rooms/${LINE_A}`)).toMatchObject({ uid: OWNER, building_id: BLD, room_id: 'r101', due_day: 7 });
    });

    it('rescanning your own room changes nothing', async () => {
        const code = await codeOf();
        await scanRoomCode(LINE_A, code);
        expect((await scanRoomCode(LINE_A, code)).outcome).toBe('already_yours');
        expect(listPaths(`${B}/line_requests/`)).toHaveLength(0);
    });

    it('a taken room is never overwritten by a scan: it becomes a request', async () => {
        const code = await codeOf();
        await scanRoomCode(LINE_A, code);
        expect((await scanRoomCode(LINE_B, code)).outcome).toBe('requested');
        expect(read(`${B}/rooms/r101`)?.line_user_id).toBe(LINE_A);
        expect(read(`line_rooms/${LINE_B}`)).toBeUndefined();
        expect((await scanRoomCode(LINE_B, code)).outcome).toBe('already_requested');
        expect(listPaths(`${B}/line_requests/`)).toHaveLength(1);
    });

    it('a photo of a door cannot flood one room with requests', async () => {
        const code = await codeOf();
        await scanRoomCode(LINE_A, code);
        for (let i = 0; i < MAX_PENDING_PER_ROOM; i++) expect((await scanRoomCode(lineId(i), code)).outcome).toBe('requested');
        expect((await scanRoomCode(lineId(99), code)).outcome).toBe('too_many_requests');
    });

    it('moving to a free room releases the old one', async () => {
        await scanRoomCode(LINE_A, await codeOf('r101'));
        expect((await scanRoomCode(LINE_A, await codeOf('r102'))).outcome).toBe('bound');
        expect(read(`${B}/rooms/r101`)?.line_user_id).toBeUndefined();
        expect(read(`${B}/rooms/r102`)?.line_user_id).toBe(LINE_A);
    });

    it('unknown codes and deactivated rooms bind nothing', async () => {
        expect((await scanRoomCode(LINE_A, 'HCR-AAAAAAAAAA')).outcome).toBe('invalid');
        const code = await codeOf();
        seed(`${B}/rooms/r101`, { room_number: '101', is_active: false });
        expect((await scanRoomCode(LINE_A, code)).outcome).toBe('room_unavailable');
    });
});

describe('an admin decides a taken room', () => {
    let code: string;
    beforeEach(async () => {
        code = await codeOf();
        await scanRoomCode(LINE_A, code);
        await scanRoomCode(LINE_B, code);
    });

    it('status shows who is asking without handing out LINE ids', async () => {
        const res = await call(OWNER, { action: 'status' });
        expect(res.body.requests[0]).toMatchObject({ room_number: '101', display_name: 'Malee', line_ref: 'bbbb' });
        expect(JSON.stringify(res.body)).not.toContain(LINE_B);
    });

    it('approve swaps the account, tells both people, and leaves an audit trail', async () => {
        const res = await call(OWNER, { action: 'approve', request_id: await pendingId() });
        expect(res.statusCode).toBe(200);
        expect(read(`${B}/rooms/r101`)?.line_user_id).toBe(LINE_B);
        expect(read(`line_rooms/${LINE_B}`)).toMatchObject({ room_id: 'r101', due_day: 7 });
        expect(read(`line_rooms/${LINE_A}`)).toBeUndefined();
        const pushed = fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/message/push')).map(([, o]) => JSON.parse(o.body).to);
        expect(pushed).toEqual([LINE_B, LINE_A]);
        expect(listPaths(`users/${OWNER}/audit_logs/`).map(p => read(p)?.note)).toContain('LINE registration request approved');
    });

    it('approving one closes the other requests for that room', async () => {
        await scanRoomCode(LINE_C, code);
        const first = await pendingId();
        await call(OWNER, { action: 'approve', request_id: first });
        expect((await call(OWNER, { action: 'status' })).body.requests).toHaveLength(0);
    });

    it('reject leaves the tenant alone and blocks asking again for a day', async () => {
        await call(OWNER, { action: 'reject', request_id: await pendingId() });
        expect(read(`${B}/rooms/r101`)?.line_user_id).toBe(LINE_A);
        expect((await scanRoomCode(LINE_B, code)).outcome).toBe('recently_rejected');
    });

    it('a decision can only be made once', async () => {
        const id = await pendingId();
        await call(OWNER, { action: 'reject', request_id: id });
        expect((await call(OWNER, { action: 'approve', request_id: id })).statusCode).toBe(409);
    });

    it('is decided by a team member with tenant.update, not only the owner', async () => {
        seed(`users/${OWNER}/members/staff`, { uid: 'staff', role: 'property_manager', permissions: permissionsForRole('property_manager'), property_ids: ['*'], status: 'active' });
        expect((await call('staff', { action: 'approve', request_id: await pendingId() })).statusCode).toBe(200);
    });

    it('is refused for a role without tenant.update and for another team', async () => {
        seed(`users/${OWNER}/members/staff`, { uid: 'staff', role: 'technician', permissions: permissionsForRole('technician'), property_ids: ['*'], status: 'active' });
        const id = await pendingId();
        expect((await call('staff', { action: 'approve', request_id: id })).statusCode).toBe(403);
        expect((await call('other-owner', { action: 'approve', request_id: id })).statusCode).toBe(403);
        expect(read(`${B}/rooms/r101`)?.line_user_id).toBe(LINE_A);
    });
});

describe('scan only, through LIFF', () => {
    const LIFF_CHANNEL = '123';
    let friend: boolean;

    beforeEach(() => {
        friend = true;
        process.env.VITE_LIFF_ID = `${LIFF_CHANNEL}-abc`;
        fetchMock.mockImplementation(async (url: string) => {
            const u = String(url);
            const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data, text: async () => '', headers: new Headers() });
            if (u.includes('/oauth2/v2.1/verify')) {
                if (u.includes('forged')) return { ok: false, status: 400, json: async () => ({}), headers: new Headers() };
                return ok({ client_id: u.includes('other-app') ? '999' : LIFF_CHANNEL, expires_in: 100 });
            }
            if (u.endsWith('/v2/profile')) return ok({ userId: LINE_A });
            if (u.includes('/v2/bot/profile/')) return friend ? ok({ displayName: 'Malee' }) : { ok: false, status: 404, json: async () => ({}), headers: new Headers() };
            return ok({});
        });
    });
    afterEach(() => { delete process.env.VITE_LIFF_ID; });

    const liff = async (access_token: unknown, code: unknown) => {
        const res = fakeRes();
        await handler(fakeReq({ action: 'liff_scan', access_token, code }), res as never);
        return res as unknown as { statusCode: number; body: Record<string, any> };
    };

    it('binds the room to the account LINE vouches for, with nothing sent', async () => {
        const res = await liff('good', await codeOf());
        expect(res.body).toMatchObject({ outcome: 'bound', room_number: '101' });
        expect(read(`${B}/rooms/r101`)).toMatchObject({ line_user_id: LINE_A, line_channel: 'tenant' });
        expect(read(`${B}/rooms/r101`)?.line_unreachable).toBeUndefined();
        expect(res.body.add_friend_url).toBeUndefined();
    });

    it('someone who skipped adding the OA is flagged and handed the link', async () => {
        friend = false;
        const res = await liff('good', await codeOf());
        expect(read(`${B}/rooms/r101`)?.line_unreachable).toBe(true);
        expect(res.body.add_friend_url).toBe('https://line.me/R/ti/p/%40horcare');
    });

    it('never binds on a forged token, or one issued to another LINE app', async () => {
        const code = await codeOf();
        expect((await liff('forged', code)).statusCode).toBe(401);
        expect((await liff('other-app', code)).statusCode).toBe(401);
        expect(read(`${B}/rooms/r101`)?.line_user_id).toBeUndefined();
    });

    it('a taken room still goes to an admin', async () => {
        const code = await codeOf();
        await scanRoomCode(LINE_B, code);
        expect((await liff('good', code)).body.outcome).toBe('requested');
        expect(read(`${B}/rooms/r101`)?.line_user_id).toBe(LINE_B);
    });

    it('a room on another OA is refused and pointed at its chat: this LINE id is not valid there', async () => {
        process.env.VITE_LINE_MARKET_OA_ID = '@market';
        const code = await codeOf();
        seed(B, { id: BLD, building_type: 'market' });
        const res = await liff('good', code);
        expect(res.statusCode).toBe(409);
        expect(res.body.url).toContain('oaMessage/%40market');
        expect(read(`${B}/rooms/r101`)?.line_user_id).toBeUndefined();
        delete process.env.VITE_LINE_MARKET_OA_ID;
    });

    it('bad input is refused before asking LINE', async () => {
        expect((await liff('good', 'nope')).statusCode).toBe(400);
        expect((await liff(undefined, 'HCR-AAAAAAAAAA')).statusCode).toBe(400);
    });
});
