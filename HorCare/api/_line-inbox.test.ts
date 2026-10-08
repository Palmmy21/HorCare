import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import handler, { ACK_EVERY_MS, recordInbound } from './_line-inbox.js';
import { addAuthUser, fakeReq, fakeRes, listPaths, read, resetFake, seed } from './_fake-firestore.js';
import { permissionsForRole } from '../src/shared/permissions.js';

const OWNER = 'owner-1';
const BLD = 'bld-A';
const B = `users/${OWNER}/buildings/${BLD}`;
const TENANT = 'U' + 'a'.repeat(32);
const OTHER = 'U' + 'b'.repeat(32);
const TOKEN = 'tenant-token';
const T = `${B}/line_threads/${TENANT}`;

const fetchMock = vi.fn();

function member(uid: string, role: 'front_desk' | 'technician', property_ids = ['*']) {
    seed(`users/${OWNER}/members/${uid}`, { uid, role, permissions: permissionsForRole(role), property_ids, status: 'active' });
}

beforeEach(() => {
    resetFake();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '', headers: new Headers() });
    vi.stubGlobal('fetch', fetchMock);
    process.env.LINE_CHANNEL_ACCESS_TOKEN = TOKEN;
    addAuthUser(OWNER, 'o@x.com', 'Owner');
    addAuthUser('desk', 'd@x.com', 'Desk');
    addAuthUser('tech', 't@x.com', 'Tech');
    addAuthUser('outsider', 'x@x.com');
    seed(`users/${OWNER}`, { uid: OWNER });
    seed(B, { id: BLD });
    seed(`${B}/rooms/r101`, { room_number: '101', is_active: true, line_user_id: TENANT });
    seed(`${B}/tenants/r101`, { full_name: 'Somchai' });
    seed(`line_rooms/${TENANT}`, { uid: OWNER, building_id: BLD, room_id: 'r101', room_number: '101' });
    // a second property owned by someone else, with its own tenant
    seed(`users/other-owner/buildings/bld-X/rooms/rX`, { room_number: 'X1', is_active: true, line_user_id: OTHER });
    seed(`line_rooms/${OTHER}`, { uid: 'other-owner', building_id: 'bld-X', room_id: 'rX', room_number: 'X1' });
});

afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
});

describe('recordInbound', () => {
    it('stores the message in the tenant\'s own property and opens a thread', async () => {
        const r = await recordInbound(TENANT, { kind: 'text', text: '  น้ำไม่ไหลค่ะ  ' });
        expect(r).toEqual({ recorded: true, shouldAck: true });
        expect(read(T)).toMatchObject({
            line_user_id: TENANT, room_id: 'r101', room_number: '101', tenant_name: 'Somchai',
            last_message_text: 'น้ำไม่ไหลค่ะ', last_direction: 'in', unread_count: 1,
        });
        const msgs = listPaths(`${T}/messages/`).map(p => read(p)!);
        expect(msgs).toHaveLength(1);
        expect(msgs[0]).toMatchObject({ direction: 'in', kind: 'text', text: 'น้ำไม่ไหลค่ะ', by: null });
    });

    it('messages from different tenants never mix across properties', async () => {
        await recordInbound(TENANT, { kind: 'text', text: 'hi' });
        await recordInbound(OTHER, { kind: 'text', text: 'hello' });
        expect(listPaths(`${B}/line_threads/`).every(p => p.includes(TENANT))).toBe(true);
        expect(read(`users/other-owner/buildings/bld-X/line_threads/${OTHER}`)?.last_message_text).toBe('hello');
    });

    it('ignores senders who are not registered tenants, and empty text', async () => {
        expect(await recordInbound('U' + 'c'.repeat(32), { kind: 'text', text: 'hi' })).toEqual({ recorded: false, shouldAck: false });
        expect(await recordInbound(TENANT, { kind: 'text', text: '   ' })).toEqual({ recorded: false, shouldAck: false });
        expect(listPaths(`${B}/line_threads/`)).toHaveLength(0);
    });

    it('counts unread and only acknowledges once per window', async () => {
        expect((await recordInbound(TENANT, { kind: 'text', text: 'one' })).shouldAck).toBe(true);
        expect((await recordInbound(TENANT, { kind: 'text', text: 'two' })).shouldAck).toBe(false);
        expect(read(T)?.unread_count).toBe(2);
        // an old acknowledgement expires
        seed(T, { ...read(T)!, last_ack_at: new Date(Date.now() - ACK_EVERY_MS - 1000).toISOString() });
        expect((await recordInbound(TENANT, { kind: 'text', text: 'three' })).shouldAck).toBe(true);
    });

    it('caps very long messages and keeps a short preview', async () => {
        await recordInbound(TENANT, { kind: 'text', text: 'x'.repeat(5000) });
        const msg = listPaths(`${T}/messages/`).map(p => read(p)!)[0];
        expect((msg.text as string).length).toBe(2000);
        expect((read(T)!.last_message_text as string).length).toBe(200);
    });

    it('stickers are recorded as placeholders', async () => {
        await recordInbound(TENANT, { kind: 'sticker', text: '[สติกเกอร์]' });
        expect(listPaths(`${T}/messages/`).map(p => read(p)!)[0]).toMatchObject({ kind: 'sticker', text: '[สติกเกอร์]' });
    });
});

async function call(uid: string | undefined, body: Record<string, unknown>) {
    const res = fakeRes();
    await handler(fakeReq({ owner_uid: OWNER, building_id: BLD, line_user_id: TENANT, ...body }, uid), res as never);
    return res as { statusCode: number; body: any };
}
const send = (uid: string | undefined, text = 'ได้ค่ะ จะส่งช่างไปดูให้') => call(uid, { action: 'send', text });

describe('sending replies', () => {
    beforeEach(async () => { await recordInbound(TENANT, { kind: 'text', text: 'น้ำไม่ไหล' }); });

    it('happy path: pushes with the tenant OA token, stores the reply, clears unread, audits (without the text)', async () => {
        const res = await send(OWNER);
        expect(res.statusCode).toBe(200);
        const push = fetchMock.mock.calls.find(c => String(c[0]).endsWith('/message/push'))!;
        expect(push[1].headers.Authorization).toBe(`Bearer ${TOKEN}`);
        expect(JSON.parse(push[1].body)).toEqual({ to: TENANT, messages: [{ type: 'text', text: 'ได้ค่ะ จะส่งช่างไปดูให้' }] });
        expect(read(T)).toMatchObject({ last_direction: 'out', unread_count: 0, last_message_text: 'ได้ค่ะ จะส่งช่างไปดูให้' });
        const out = listPaths(`${T}/messages/`).map(p => read(p)!).find(m => m.direction === 'out');
        expect(out).toMatchObject({ by: 'Owner', kind: 'text' });
        const audits = listPaths(`users/${OWNER}/audit_logs/`).map(p => read(p)!);
        expect(audits).toHaveLength(1);
        expect(JSON.stringify(audits[0])).not.toContain('ส่งช่างไปดูให้');
        expect(audits[0]).toMatchObject({ action: 'CREATE', resource_type: 'message' });
    });

    it('requires a token (401) and message.send (403); outsiders and cross-property members are refused', async () => {
        expect((await send(undefined)).statusCode).toBe(401);
        expect((await send('outsider')).statusCode).toBe(403);
        member('tech', 'technician');
        expect((await send('tech')).statusCode).toBe(403);
        member('desk', 'front_desk', ['bld-OTHER']);
        expect((await send('desk')).statusCode).toBe(403);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('front desk may reply on a granted property', async () => {
        member('desk', 'front_desk', [BLD]);
        expect((await send('desk')).statusCode).toBe(200);
    });

    it('validates the text and ids (400)', async () => {
        for (const text of ['', '   ', 'x'.repeat(1001), 42 as unknown as string]) {
            expect((await call(OWNER, { action: 'send', text })).statusCode).toBe(400);
        }
        expect((await call(OWNER, { action: 'send', text: 'hi', line_user_id: 'not-a-line-id' })).statusCode).toBe(400);
        expect((await call(OWNER, { action: 'send', text: 'hi', line_user_id: undefined })).statusCode).toBe(400);
        expect((await call(OWNER, { action: 'nope' })).statusCode).toBe(400);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('cannot message a tenant of another property by guessing their LINE id (404)', async () => {
        const res = await call(OWNER, { action: 'send', text: 'hi', line_user_id: OTHER });
        expect(res.statusCode).toBe(404);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refuses when the tenant is no longer linked to the room (409)', async () => {
        seed(`${B}/rooms/r101`, { room_number: '101', is_active: true, line_user_id: OTHER });
        expect((await send(OWNER)).statusCode).toBe(409);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reports a missing LINE token (503) and a failed push (502) without storing a reply', async () => {
        delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
        expect((await send(OWNER)).statusCode).toBe(503);
        process.env.LINE_CHANNEL_ACCESS_TOKEN = TOKEN;
        fetchMock.mockResolvedValue({ ok: false, status: 400, text: async () => 'bad', headers: new Headers() });
        expect((await send(OWNER)).statusCode).toBe(502);
        expect(listPaths(`${T}/messages/`).map(p => read(p)!).filter(m => m.direction === 'out')).toHaveLength(0);
        expect(read(T)?.unread_count).toBe(1);
    });
});

describe('mark_read', () => {
    it('clears the unread count; needs message.read', async () => {
        await recordInbound(TENANT, { kind: 'text', text: 'a' });
        await recordInbound(TENANT, { kind: 'text', text: 'b' });
        expect(read(T)?.unread_count).toBe(2);
        member('tech', 'technician');
        expect((await call('tech', { action: 'mark_read' })).statusCode).toBe(403);
        expect(read(T)?.unread_count).toBe(2);
        expect((await call(OWNER, { action: 'mark_read' })).statusCode).toBe(200);
        expect(read(T)?.unread_count).toBe(0);
    });

    it('unknown thread is 404; only POST is accepted', async () => {
        expect((await call(OWNER, { action: 'mark_read' })).statusCode).toBe(404);
        const res = fakeRes();
        await handler(fakeReq({}, OWNER, 'GET'), res as never);
        expect(res.statusCode).toBe(405);
    });
});
