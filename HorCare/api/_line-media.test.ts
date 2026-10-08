import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import handler, { getTenantLink, recordInbound } from './_line-inbox.js';
import {
    MAX_MEDIA_BYTES, SLIP_WINDOW_MS, isAllowedMedia, isSlipImage, normalizeContentType, saveMedia,
} from './_line-media.js';
import {
    addAuthUser, failStorage, fakeReq, fakeRes, listObjects, listPaths, read, readObject, resetFake, seed,
} from './_fake-firestore.js';
import { permissionsForRole } from '../src/shared/permissions.js';

const OWNER = 'owner-1';
const BLD = 'bld-A';
const B = `users/${OWNER}/buildings/${BLD}`;
const TENANT = 'U' + 'a'.repeat(32);
const OTHER = 'U' + 'b'.repeat(32);
const T = `${B}/line_threads/${TENANT}`;

beforeEach(() => {
    resetFake();
    addAuthUser(OWNER, 'o@x.com', 'Owner');
    addAuthUser('desk', 'd@x.com', 'Desk');
    addAuthUser('tech', 't@x.com', 'Tech');
    seed(`users/${OWNER}`, { uid: OWNER });
    seed(B, { id: BLD });
    seed(`${B}/rooms/r101`, { room_number: '101', is_active: true, line_user_id: TENANT });
    seed(`line_rooms/${TENANT}`, { uid: OWNER, building_id: BLD, room_id: 'r101', room_number: '101' });
    seed(`users/other-owner/buildings/bld-X/rooms/rX`, { room_number: 'X1', is_active: true, line_user_id: OTHER });
    seed(`line_rooms/${OTHER}`, { uid: 'other-owner', building_id: 'bld-X', room_id: 'rX', room_number: 'X1' });
});

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const m4a = Buffer.from('fake-audio-bytes');

describe('slip vs chat photo routing', () => {
    it('a readable slip QR is always a slip', () => {
        expect(isSlipImage({ hasQr: true })).toBe(true);
        expect(isSlipImage({ hasQr: true, expectedUntil: 0 })).toBe(true);
    });
    it('a photo without a QR is a chat photo by default', () => {
        expect(isSlipImage({ hasQr: false })).toBe(false);
        expect(isSlipImage({ hasQr: false, expectedUntil: undefined })).toBe(false);
    });
    it('after the tenant pressed "send slip" a QR-less photo still counts as a slip, until the window ends', () => {
        const now = 1_000_000;
        expect(isSlipImage({ hasQr: false, expectedUntil: now + SLIP_WINDOW_MS, now })).toBe(true);
        expect(isSlipImage({ hasQr: false, expectedUntil: now - 1, now })).toBe(false);
        expect(isSlipImage({ hasQr: false, expectedUntil: now, now })).toBe(false);
    });
});

describe('saveMedia', () => {
    const base = { ownerUid: OWNER, buildingId: BLD, lineUserId: TENANT, messageId: '555' };

    it('stores a photo under the tenant\'s folder in this property and returns a pointer', async () => {
        const r = await saveMedia({ ...base, kind: 'image', buffer: jpeg, contentType: 'image/jpeg' });
        expect(r).toEqual({ ok: true, media: { path: `line_media/${OWNER}/${BLD}/${TENANT}/555.jpg`, content_type: 'image/jpeg', size: jpeg.length } });
        expect(readObject(`line_media/${OWNER}/${BLD}/${TENANT}/555.jpg`)?.contentType).toBe('image/jpeg');
    });

    it('voice messages are stored as m4a even when LINE reports a generic type', async () => {
        const r = await saveMedia({ ...base, kind: 'audio', buffer: m4a, contentType: 'application/octet-stream' });
        expect(r.ok && r.media.content_type).toBe('audio/m4a');
        expect(listObjects()).toEqual([`line_media/${OWNER}/${BLD}/${TENANT}/555.m4a`]);
    });

    it('refuses empty and oversized files, and types that are not photos/audio', async () => {
        expect(await saveMedia({ ...base, kind: 'image', buffer: Buffer.alloc(0), contentType: 'image/jpeg' })).toEqual({ ok: false, reason: 'too_large' });
        expect(await saveMedia({ ...base, kind: 'image', buffer: Buffer.alloc(MAX_MEDIA_BYTES + 1), contentType: 'image/jpeg' })).toEqual({ ok: false, reason: 'too_large' });
        expect(await saveMedia({ ...base, kind: 'video', buffer: jpeg, contentType: 'video/mp4' })).toEqual({ ok: false, reason: 'unsupported' });
        expect(await saveMedia({ ...base, kind: 'image', buffer: jpeg, contentType: 'text/html' })).toMatchObject({ ok: true }); // normalised to jpeg, never served as html
        expect(listObjects().every(p => p.endsWith('.jpg'))).toBe(true);
    });

    it('reports a storage failure without throwing', async () => {
        failStorage();
        expect(await saveMedia({ ...base, kind: 'image', buffer: jpeg, contentType: 'image/jpeg' })).toEqual({ ok: false, reason: 'storage_failed' });
    });

    it('content-type helpers', () => {
        expect(normalizeContentType('image', 'IMAGE/PNG; charset=x')).toBe('image/png');
        expect(isAllowedMedia('image', 'image/svg+xml')).toBe(false);
        expect(isAllowedMedia('audio', 'audio/m4a')).toBe(true);
        expect(isAllowedMedia('video', 'video/mp4')).toBe(false);
    });
});

describe('recording media messages', () => {
    it('keeps the file pointer on the message and uses the LINE message id (retries do not duplicate)', async () => {
        const saved = await saveMedia({ ownerUid: OWNER, buildingId: BLD, lineUserId: TENANT, messageId: '777', kind: 'image', buffer: jpeg, contentType: 'image/jpeg' });
        if (!saved.ok) throw new Error('save failed');
        await recordInbound(TENANT, { kind: 'image', text: '[รูปภาพ]', messageId: '777', media: saved.media });
        await recordInbound(TENANT, { kind: 'image', text: '[รูปภาพ]', messageId: '777', media: saved.media }); // LINE redelivery
        const msgs = listPaths(`${T}/messages/`).map(p => read(p)!);
        expect(msgs).toHaveLength(1);
        expect(msgs[0]).toMatchObject({ id: '777', kind: 'image', media: { path: saved.media.path } });
        expect(read(T)?.last_message_text).toBe('[รูปภาพ]');
    });

    it('getTenantLink returns null for strangers', async () => {
        expect(await getTenantLink('U' + 'z'.repeat(32))).toBeNull();
        expect(await getTenantLink(TENANT)).toMatchObject({ uid: OWNER, building_id: BLD, room_id: 'r101' });
    });
});

async function mediaUrl(uid: string | undefined, over: Record<string, unknown> = {}) {
    const res = fakeRes();
    await handler(fakeReq({ owner_uid: OWNER, building_id: BLD, line_user_id: TENANT, action: 'media_url', message_id: '777', ...over }, uid), res as never);
    return res as { statusCode: number; body: any };
}

describe('media_url (signed link for the owner\'s browser)', () => {
    beforeEach(async () => {
        const saved = await saveMedia({ ownerUid: OWNER, buildingId: BLD, lineUserId: TENANT, messageId: '777', kind: 'audio', buffer: m4a, contentType: 'audio/m4a' });
        if (!saved.ok) throw new Error('save failed');
        await recordInbound(TENANT, { kind: 'audio', text: '[ข้อความเสียง]', messageId: '777', media: saved.media });
    });

    it('returns a short-lived URL and the content type', async () => {
        const res = await mediaUrl(OWNER);
        expect(res.statusCode).toBe(200);
        expect(res.body.url).toContain(`line_media/${OWNER}/${BLD}/${TENANT}/777.m4a`);
        expect(res.body.content_type).toBe('audio/m4a');
        expect(res.body.expires_in).toBe(900);
    });

    it('needs a token and message.read; cross-property members and outsiders are refused', async () => {
        expect((await mediaUrl(undefined)).statusCode).toBe(401);
        seed(`users/${OWNER}/members/tech`, { uid: 'tech', role: 'technician', permissions: permissionsForRole('technician'), property_ids: ['*'], status: 'active' });
        expect((await mediaUrl('tech')).statusCode).toBe(403);
        seed(`users/${OWNER}/members/desk`, { uid: 'desk', role: 'front_desk', permissions: permissionsForRole('front_desk'), property_ids: ['bld-OTHER'], status: 'active' });
        expect((await mediaUrl('desk')).statusCode).toBe(403);
        seed(`users/${OWNER}/members/desk`, { uid: 'desk', role: 'front_desk', permissions: permissionsForRole('front_desk'), property_ids: [BLD], status: 'active' });
        expect((await mediaUrl('desk')).statusCode).toBe(200);
    });

    it('cannot reach another property\'s tenant or files (404)', async () => {
        expect((await mediaUrl(OWNER, { line_user_id: OTHER })).statusCode).toBe(404);
    });

    it('rejects unknown/missing/malformed message ids and messages without a file', async () => {
        expect((await mediaUrl(OWNER, { message_id: 'nope' })).statusCode).toBe(404);
        expect((await mediaUrl(OWNER, { message_id: '../../etc/passwd' })).statusCode).toBe(400);
        expect((await mediaUrl(OWNER, { message_id: undefined })).statusCode).toBe(400);
        expect((await mediaUrl(OWNER, { message_id: 42 })).statusCode).toBe(400);
        await recordInbound(TENANT, { kind: 'text', text: 'plain', messageId: '888' });
        expect((await mediaUrl(OWNER, { message_id: '888' })).statusCode).toBe(404);
    });

    it('refuses a tampered message whose file points outside the tenant\'s folder', async () => {
        seed(`${T}/messages/777`, { ...read(`${T}/messages/777`)!, media: { path: `line_media/other-owner/bld-X/${OTHER}/1.jpg`, content_type: 'image/jpeg', size: 1 } });
        expect((await mediaUrl(OWNER)).statusCode).toBe(404);
    });
});
