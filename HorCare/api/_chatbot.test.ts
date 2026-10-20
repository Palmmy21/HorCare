import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import chatbot, { findFaqAnswer } from './_chatbot.js';
import announcements, { latestAnnouncementsText } from './_announcements.js';
import { recordBotReply } from './_line-inbox.js';
import { addAuthUser, fakeReq, fakeRes, listPaths, read, resetFake, seed, seedPortalLink } from './_fake-firestore.js';
import { permissionsForRole } from '../src/shared/permissions.js';

const OWNER = 'owner-1';
const BLD = 'bld-A';
const B = `users/${OWNER}/buildings/${BLD}`;
const T1 = 'U' + '1'.repeat(32);
const T2 = 'U' + '2'.repeat(32);
const TX = 'U' + '3'.repeat(32);
const fetchMock = vi.fn();

beforeEach(() => {
    resetFake();
    for (const [u, n] of [[OWNER, 'Owner'], ['mgr', 'Mgr'], ['desk', 'Desk'], ['fin', 'Fin'], ['stranger', 'S']]) addAuthUser(u, `${u}@x.com`, n);
    seed(`users/${OWNER}`, { uid: OWNER });
    seed(B, { id: BLD });
    seed(`users/${OWNER}/buildings/bld-B`, { id: 'bld-B' });
    seed(`${B}/rooms/r1`, { id: 'r1' });
    seed(`${B}/data/config`, { bill_customization: { dorm_name: 'หอทดสอบ' } });
    for (const [uid, role] of [['mgr', 'property_manager'], ['desk', 'front_desk'], ['fin', 'finance']] as const)
        seed(`users/${OWNER}/members/${uid}`, { uid, role, permissions: permissionsForRole(role), property_ids: ['*'], status: 'active' });
    // two tenants of this property, one of another property
    seed(`line_rooms/${T1}`, { uid: OWNER, building_id: BLD, room_id: 'r1', room_number: '101' });
    seed(`line_rooms/${T2}`, { uid: OWNER, building_id: BLD, room_id: 'r2', room_number: '102' });
    seed(`line_rooms/${TX}`, { uid: 'other-owner', building_id: 'bld-X', room_id: 'rX', room_number: 'X1' });
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '', headers: new Headers() });
    vi.stubGlobal('fetch', fetchMock);
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'tok';
});
afterEach(() => { vi.unstubAllGlobals(); delete process.env.LINE_CHANNEL_ACCESS_TOKEN; });

async function call(h: typeof chatbot, uid: string | null, body: Record<string, unknown>) {
    const res = fakeRes();
    await h(fakeReq({ owner_uid: OWNER, building_id: BLD, ...body }, uid ?? undefined), res as never);
    return res as { statusCode: number; body: any };
}
const faqBody = (over: Record<string, unknown> = {}) => ({ action: 'create', title: 'Wi-Fi', keywords: ['wifi', 'ไวไฟ'], answer: 'รหัส wifi: horcare123', ...over });

describe('chatbot FAQ management', () => {
    it('owner and manager manage; front desk, finance, strangers and anonymous cannot', async () => {
        expect((await call(chatbot, OWNER, faqBody())).statusCode).toBe(200);
        expect((await call(chatbot, 'mgr', faqBody({ title: 'อีกข้อ', keywords: ['ซักผ้า'] }))).statusCode).toBe(200);
        for (const uid of ['desk', 'fin', 'stranger']) expect((await call(chatbot, uid, faqBody())).statusCode).toBe(403);
        expect((await call(chatbot, null, faqBody())).statusCode).toBe(401);
    });

    it('create validates input, audits, and caps the list', async () => {
        for (const bad of [{ title: '' }, { keywords: [] }, { answer: '' }, { keywords: ['ก'] }, { enabled: 'x' }]) {
            expect((await call(chatbot, OWNER, faqBody(bad))).statusCode).toBe(400);
        }
        const ok = await call(chatbot, OWNER, faqBody());
        expect(ok.body.faq).toMatchObject({ title: 'Wi-Fi', enabled: true, hit_count: 0 });
        expect(listPaths(`users/${OWNER}/audit_logs/`)).toHaveLength(1);
        for (let i = 0; i < 99; i++) seed(`${B}/faqs/f${i}`, { id: `f${i}` });
        expect((await call(chatbot, OWNER, faqBody())).body.error).toBe('limit_reached');
    });

    it('update changes only what is sent; delete removes; unknown ids 404; other property unreachable', async () => {
        const id = (await call(chatbot, OWNER, faqBody())).body.faq.id;
        expect((await call(chatbot, OWNER, { action: 'update', faq_id: id, enabled: false })).statusCode).toBe(200);
        expect(read(`${B}/faqs/${id}`)).toMatchObject({ enabled: false, title: 'Wi-Fi', answer: 'รหัส wifi: horcare123' });
        expect((await call(chatbot, OWNER, { action: 'update', faq_id: id, answer: '' })).statusCode).toBe(400);
        expect((await call(chatbot, OWNER, { action: 'update', faq_id: 'ghost', enabled: true })).statusCode).toBe(404);
        expect((await call(chatbot, OWNER, { action: 'delete', faq_id: id, building_id: 'bld-B' })).statusCode).toBe(404);
        expect((await call(chatbot, OWNER, { action: 'delete', faq_id: id })).statusCode).toBe(200);
        expect(read(`${B}/faqs/${id}`)).toBeUndefined();
        expect((await call(chatbot, OWNER, { action: 'nuke' })).statusCode).toBe(400);
    });
});

describe('findFaqAnswer', () => {
    it("answers from this property's Q&A only, counts the hit, and stays quiet otherwise", async () => {
        const id = (await call(chatbot, OWNER, faqBody())).body.faq.id;
        seed(`users/other-owner/buildings/bld-X/faqs/z`, { id: 'z', title: 'z', keywords: ['wifi'], answer: 'LEAK', enabled: true, hit_count: 0, created_at: '2026-01-01' });
        const link = { uid: OWNER, building_id: BLD };
        expect(await findFaqAnswer(link, 'ขอรหัส WiFi หน่อยค่ะ')).toBe('รหัส wifi: horcare123');
        expect(read(`${B}/faqs/${id}`)!.hit_count).toBe(1);
        expect(await findFaqAnswer(link, 'สวัสดีค่ะ')).toBeNull();
    });
});

describe('recordBotReply', () => {
    it('stores the answer in the thread without clearing unread', async () => {
        seed(`${B}/line_threads/${T1}`, { line_user_id: T1, unread_count: 2, last_message_text: 'q', last_direction: 'in' });
        await recordBotReply(T1, 'คำตอบ');
        expect(read(`${B}/line_threads/${T1}`)).toMatchObject({ unread_count: 2, last_direction: 'out', last_message_text: 'คำตอบ' });
        const msgs = listPaths(`${B}/line_threads/${T1}/messages/`).map(p => read(p)!);
        expect(msgs[0]).toMatchObject({ direction: 'out', by: 'ตอบอัตโนมัติ' });
    });
});

const ann = (uid: string | null, body: Record<string, unknown>) => call(announcements as never, uid, body);
const create = (uid: string | null = OWNER, over: Record<string, unknown> = {}) =>
    ann(uid, { action: 'create', title: 'ปิดน้ำ', body: 'พรุ่งนี้ 9-12 น.', ...over });

describe('announcements', () => {
    it('owner, manager and front desk may publish; finance, strangers and anonymous may not', async () => {
        for (const uid of [OWNER, 'mgr', 'desk']) expect((await create(uid)).statusCode).toBe(200);
        for (const uid of ['fin', 'stranger']) expect((await create(uid)).statusCode).toBe(403);
        expect((await create(null)).statusCode).toBe(401);
    });

    it('validates input and refuses an expiry in the past', async () => {
        for (const bad of [{ title: '' }, { body: '' }, { title: 'x'.repeat(101) }, { expires_at: 'nope' }, { expires_at: '2000-01-01T00:00:00Z' }, { send_line: 'yes' }])
            expect((await create(OWNER, bad)).statusCode).toBe(400);
        expect(listPaths(`${B}/announcements/`)).toHaveLength(0);
    });

    it('sends to LINE only to tenants of this property, and records the counts', async () => {
        const res = await create(OWNER, { send_line: true });
        expect(res.body.announcement).toMatchObject({ line_sent: 2, line_failed: 0 });
        const recipients = fetchMock.mock.calls.map(c => JSON.parse(c[1].body).to).sort();
        expect(recipients).toEqual([T1, T2]);
        expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].text).toContain('หอทดสอบ');
    });

    it('counts failures without failing the publish', async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 400, text: async () => 'bad', headers: new Headers() });
        const res = await create(OWNER, { send_line: true });
        expect(res.statusCode).toBe(200);
        expect(res.body.announcement).toMatchObject({ line_sent: 0, line_failed: 2 });
    });

    it('without send_line nothing is pushed; without a LINE token a send is refused and nothing is stored', async () => {
        await create(OWNER);
        expect(fetchMock).not.toHaveBeenCalled();
        delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
        expect((await create(OWNER, { send_line: true })).statusCode).toBe(503);
        expect(listPaths(`${B}/announcements/`)).toHaveLength(1);
    });

    it('update edits, pins and archives; archived notices disappear for tenants', async () => {
        const id = (await create()).body.announcement.id;
        expect((await ann(OWNER, { action: 'update', announcement_id: id, pinned: true, title: 'ปิดน้ำ (แก้ไข)' })).statusCode).toBe(200);
        const list = () => ann(null, { action: 'tenant_list', portal: seedPortalLink(OWNER, BLD, 'r1') });
        expect((await list()).body.announcements[0]).toMatchObject({ id, title: 'ปิดน้ำ (แก้ไข)', pinned: true });
        await ann(OWNER, { action: 'update', announcement_id: id, status: 'archived' });
        expect((await list()).body.announcements).toEqual([]);
        expect((await ann(OWNER, { action: 'update', announcement_id: id, status: 'weird' })).statusCode).toBe(400);
        expect((await ann(OWNER, { action: 'update', announcement_id: 'ghost', pinned: true })).statusCode).toBe(404);
        expect((await ann('desk', { action: 'update', announcement_id: id, pinned: false })).statusCode).toBe(200);
        expect((await ann('fin', { action: 'update', announcement_id: id, pinned: false })).statusCode).toBe(403);
    });

    it('tenant_list shows no author or counts, hides expired, and needs a valid portal link', async () => {
        const pastId = 'old';
        seed(`${B}/announcements/${pastId}`, { id: pastId, title: 'เก่า', body: 'x', pinned: false, status: 'published', expires_at: '2020-01-01T00:00:00Z', created_at: '2019-01-01T00:00:00Z', created_by: 'o', line_sent: 1, line_failed: 0 });
        await create();
        const ok = await ann(null, { action: 'tenant_list', portal: seedPortalLink(OWNER, BLD, 'r1') });
        expect(ok.body.announcements).toHaveLength(1);
        expect(Object.keys(ok.body.announcements[0]).sort()).toEqual(['body', 'created_at', 'id', 'pinned', 'title']);
        expect((await ann(null, { action: 'tenant_list', portal: seedPortalLink(OWNER, BLD, 'nope') })).statusCode).toBe(401);
        expect((await ann(null, { action: 'tenant_list', room_id: 'r1' })).statusCode).toBe(401);
    });

    it('latestAnnouncementsText lists the newest notices or null', async () => {
        const link = { uid: OWNER, building_id: BLD };
        expect(await latestAnnouncementsText(link)).toBeNull();
        await create();
        expect(await latestAnnouncementsText(link)).toContain('ปิดน้ำ');
    });
});