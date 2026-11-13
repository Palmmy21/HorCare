import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import handler, { joinDestination } from './_liff-join.js';
import roomQr from './_room-qr.js';
import { encryptSecret } from './_line-oa.js';
import { addAuthUser, fakeReq, fakeRes, listPaths, read, resetFake, seed } from './_fake-firestore.js';

const OWNER = 'owner-1';
const BLD = 'bld-A';
const B = `users/${OWNER}/buildings/${BLD}`;
const LINE_A = 'U' + 'a'.repeat(32);
const TEAM = 'f'.repeat(32);

/** LINE's answers: which channel issued the token, who it belongs to, friendship, pushes. */
let tokenChannel = '123';
const fetchMock = vi.fn(async (url: string) => {
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => '', headers: new Headers() });
    if (url.includes('/oauth2/v2.1/verify')) return ok({ client_id: tokenChannel, expires_in: 600 });
    if (url.endsWith('/v2/profile')) return ok({ userId: LINE_A, displayName: 'Malee' });
    if (url.includes('/friendship/status')) return ok({ friendFlag: true });
    return ok({ displayName: 'Malee' });
});

beforeEach(() => {
    resetFake();
    fetchMock.mockClear();
    tokenChannel = '123';
    vi.stubGlobal('fetch', fetchMock);
    Object.assign(process.env, {
        LINE_CHANNEL_ACCESS_TOKEN: 'tenant-token', LINE_STAFF_CHANNEL_ACCESS_TOKEN: 'staff-token',
        VITE_LINE_OA_ID: '@horcare', VITE_LINE_STAFF_OA_ID: '@staff', VITE_LIFF_ID: '123-abc', LINE_LOGIN_CHANNEL_ID: '123',
        LINE_OA_ENC_KEY: Buffer.alloc(32, 7).toString('base64'),
    });
    addAuthUser(OWNER, 'o@x.com', 'Owner');
    seed(`users/${OWNER}`, { uid: OWNER });
    seed(B, { id: BLD, name: 'Dorm A' });
    seed(`${B}/data/config`, { bill_customization: { dorm_name: 'Dorm A', due_day: 7 } });
    seed(`${B}/rooms/r101`, { room_number: '101', is_active: true });
});

afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of ['LINE_CHANNEL_ACCESS_TOKEN', 'LINE_STAFF_CHANNEL_ACCESS_TOKEN', 'VITE_LINE_OA_ID', 'VITE_LINE_STAFF_OA_ID', 'VITE_LIFF_ID', 'LINE_LOGIN_CHANNEL_ID', 'LINE_OA_ENC_KEY']) delete process.env[k];
});

async function roomCode(): Promise<string> {
    const res = fakeRes();
    await roomQr(fakeReq({ owner_uid: OWNER, building_id: BLD, action: 'codes', room_ids: ['r101'] }, OWNER), res as never);
    return (res as unknown as { body: { codes: { code: string }[] } }).body.codes[0].code;
}
async function join(body: Record<string, unknown>) {
    const res = fakeRes();
    await handler(fakeReq({ action: 'join', access_token: 'tok', ...body }), res as never);
    return res as unknown as { statusCode: number; body: Record<string, any> };
}
function teamOa(withLiff: boolean) {
    seed(`line_oas/${TEAM}`, {
        owner_uid: OWNER, oa_id: '@team', bot_user_id: 'Ubot', display_name: 'Team OA',
        secret_enc: encryptSecret('s'.repeat(32)), token_enc: encryptSecret('team-token'),
        ...(withLiff ? { liff_id: '999-xyz', login_channel_id: '999' } : {}),
    });
}

describe('where a registration QR leads', () => {
    it('staff, admin and cashier codes open HorCare\'s LIFF app', async () => {
        expect(await joinDestination('hcs-abcdefgh')).toBe('https://liff.line.me/123-abc?join=HCS-ABCDEFGH');
        expect(await joinDestination('HCP-ABCDEFGH')).toBe('https://liff.line.me/123-abc?join=HCP-ABCDEFGH');
    });
    it('a room on the shared OA opens HorCare\'s LIFF; on a team OA, the team\'s LIFF — or its chat when it has none', async () => {
        const code = await roomCode();
        expect(await joinDestination(code)).toBe(`https://liff.line.me/123-abc?join=${code}`);
        teamOa(false);
        expect(await joinDestination(code)).toBe(`https://line.me/R/oaMessage/%40team/?${code}`);
        teamOa(true);
        expect(await joinDestination(code)).toBe(`https://liff.line.me/999-xyz?join=${code}`);
    });
    it('means nothing for an unknown or malformed code', async () => {
        expect(await joinDestination('HCR-AAAAAAAAAA')).toBeNull();
        expect(await joinDestination('hello')).toBeNull();
    });
});

describe('registering from the LIFF page', () => {
    it('binds a free room to the scanner proven by LINE', async () => {
        const code = await roomCode();
        const r = await join({ code });
        expect(r.statusCode).toBe(200);
        expect(r.body).toMatchObject({ kind: 'room', ok: true, outcome: 'bound', room_number: '101' });
        expect(read(`${B}/rooms/r101`)).toMatchObject({ line_user_id: LINE_A });
    });

    it('refuses a token issued to another LINE app', async () => {
        tokenChannel = '555';
        expect((await join({ code: await roomCode() })).statusCode).toBe(401);
    });

    it('sends a team\'s room to the team\'s own LIFF app: HorCare\'s LINE id means nothing there', async () => {
        const code = await roomCode();
        teamOa(true);
        const r = await join({ code });
        expect(r.statusCode).toBe(409);
        expect(r.body).toMatchObject({ error: 'wrong_liff', url: `https://liff.line.me/999-xyz?join=${code}` });
        expect(read(`${B}/rooms/r101`)?.line_user_id).toBeUndefined();
    });

    it('accepts the team\'s room from the team\'s LIFF app, with a token from the team\'s channel', async () => {
        const code = await roomCode();
        teamOa(true);
        tokenChannel = '999';
        const r = await join({ code, team: TEAM });
        expect(r.body).toMatchObject({ kind: 'room', ok: true, outcome: 'bound' });
        expect(read(`${B}/rooms/r101`)).toMatchObject({ line_user_id: LINE_A, line_channel: `oa:${TEAM}` });
    });

    it('signs staff up with the form in one go, pending a manager', async () => {
        const code = 'HCR-ABCDEFGH';
        seed(`staff_reg_codes/${createHash('sha256').update(code).digest('hex')}`, {
            owner_uid: OWNER, building_id: BLD, active: true, expires_at: Date.now() + 86_400_000, created_at: '', created_by: OWNER,
        });
        expect((await join({ code })).body).toMatchObject({ kind: 'staff_reg', ok: true, outcome: 'form', place: 'Dorm A' });
        const bad = await join({ code, form: { role: 'boss', name: 'x', phone: '1' } });
        expect(bad.body).toMatchObject({ ok: false, outcome: 'bad_form' });
        const done = await join({ code, form: { role: 'housekeeping', name: 'สมศรี ใจดี', phone: '081-234-5678' } });
        expect(done.body).toMatchObject({ kind: 'staff_reg', ok: true, outcome: 'pending' });
        const regs = listPaths(`${B}/staff_registrations/`);
        expect(regs).toHaveLength(1);
        expect(read(regs[0])).toMatchObject({ line_user_id: LINE_A, role: 'housekeeping', status: 'pending' });
    });

    it('rejects a malformed request before asking LINE', async () => {
        expect((await join({ code: 'nope' })).statusCode).toBe(400);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
