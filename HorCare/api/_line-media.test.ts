import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import handler, { getTenantLink, recordInbound } from './_line-inbox.js';
import {
    CHUNK_RAW_BYTES, MAX_MEDIA_BYTES, SLIP_WINDOW_MS, isAllowedMedia, isSlipImage, loadMediaDataUrl,
    messagePath, normalizeContentType, saveMedia, splitBuffer,
} from './_line-media.js';
import { addAuthUser, failWritesTo, fakeReq, fakeRes, listPaths, read, resetFake, seed } from './_fake-firestore.js';
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
const base = { ownerUid: OWNER, buildingId: BLD, lineUserId: TENANT, messageId: '555' };
const bytes = (n: number) => Buffer.from(Array.from({ length: n }, (_, i) => i % 251));

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

describe('saveMedia (stored in Firestore chunks — no Cloud Storage needed)', () => {
    it('stores a small photo as one chunk under its own message and reads back identically', async () => {
        const r = await saveMedia({ ...base, kind: 'image', buffer: jpeg, contentType: 'image/jpeg' });
        expect(r).toEqual({ ok: true, media: { content_type: 'image/jpeg', size: jpeg.length, chunks: 1 } });
        const msgPath = messagePath(OWNER, BLD, TENANT, '555');
        expect(listPaths(`${msgPath}/chunks/`)).toEqual([`${msgPath}/chunks/0`]);
        if (!r.ok) return;
        expect(await loadMediaDataUrl(msgPath, r.media)).toBe(`data:image/jpeg;base64,${jpeg.toString('base64')}`);
    });

    it('splits a larger voice message into chunks (each under the Firestore document limit) and reassembles it exactly', async () => {
        const audio = bytes(CHUNK_RAW_BYTES * 2 + 123);
        const r = await saveMedia({ ...base, kind: 'audio', buffer: audio, contentType: 'audio/x-m4a' });
        expect(r.ok && r.media).toMatchObject({ content_type: 'audio/x-m4a', size: audio.length, chunks: 3 });
        const msgPath = messagePath(OWNER, BLD, TENANT, '555');
        for (const p of listPaths(`${msgPath}/chunks/`)) expect((read(p)!.data as string).length).toBeLessThan(900_000);
        if (!r.ok) return;
        const url = await loadMediaDataUrl(msgPath, r.media);
        expect(Buffer.from(url!.split(',')[1], 'base64').equals(audio)).toBe(true);
    });

    it('voice messages with a generic content type are stored as m4a', async () => {
        const r = await saveMedia({ ...base, kind: 'audio', buffer: m4a, contentType: 'application/octet-stream' });
        expect(r.ok && r.media.content_type).toBe('audio/m4a');
    });

    it('refuses empty files, files over the cap, and types that are not photos/audio', async () => {
        expect(await saveMedia({ ...base, kind: 'image', buffer: Buffer.alloc(0), contentType: 'image/jpeg' })).toEqual({ ok: false, reason: 'too_large' });
        expect(await saveMedia({ ...base, kind: 'audio', buffer: bytes(MAX_MEDIA_BYTES + 1), contentType: 'audio/m4a' })).toEqual({ ok: false, reason: 'too_large' });
        expect(await saveMedia({ ...base, kind: 'video', buffer: jpeg, contentType: 'video/mp4' })).toEqual({ ok: false, reason: 'unsupported' });
        expect(listPaths(`${messagePath(OWNER, BLD, TENANT, '555')}/chunks/`)).toHaveLength(0);
    });

    it('an unknown type on a photo is stored as jpeg — never as something a browser would run', async () => {
        const r = await saveMedia({ ...base, kind: 'image', buffer: jpeg, contentType: 'text/html' });
        expect(r.ok && r.media.content_type).toBe('image/jpeg');
    });

    it('a big photo that cannot be re-compressed is kept as-is if it fits, rejected if not', async () => {
        const fits = await saveMedia({ ...base, messageId: '1', kind: 'image', buffer: bytes(1_200_000), contentType: 'image/jpeg' });
        expect(fits.ok && fits.media.chunks).toBe(3);
        const tooBig = await saveMedia({ ...base, messageId: '2', kind: 'image', buffer: bytes(MAX_MEDIA_BYTES + 10), contentType: 'image/jpeg' });
        expect(tooBig).toEqual({ ok: false, reason: 'too_large' });
    });

    it('reports a database failure without throwing', async () => {
        failWritesTo(`${B}/line_threads/`);
        expect(await saveMedia({ ...base, kind: 'image', buffer: jpeg, contentType: 'image/jpeg' })).toEqual({ ok: false, reason: 'storage_failed' });
    });

    it('loadMediaDataUrl returns null when a chunk is missing', async () => {
        const audio = bytes(CHUNK_RAW_BYTES + 10);
        const r = await saveMedia({ ...base, kind: 'audio', buffer: audio, contentType: 'audio/m4a' });
        if (!r.ok) throw new Error('save failed');
        const msgPath = messagePath(OWNER, BLD, TENANT, '555');
        seed(`${msgPath}/chunks/1`, { i: 5, data: 'AAAA' }); // wrong index = corrupt
        expect(await loadMediaDataUrl(msgPath, r.media)).toBeNull();
    });

    it('helpers', () => {
        expect(splitBuffer(bytes(10), 4).map(b => b.length)).toEqual([4, 4, 2]);
        expect(normalizeContentType('image', 'IMAGE/PNG; charset=x')).toBe('image/png');
        expect(isAllowedMedia('image', 'image/svg+xml')).toBe(false);
        expect(isAllowedMedia('audio', 'audio/m4a')).toBe(true);
        expect(isAllowedMedia('video', 'video/mp4')).toBe(false);
    });
});

describe('recording media messages', () => {
    it('keeps the file description on the message and uses the LINE message id (retries do not duplicate)', async () => {
        const saved = await saveMedia({ ...base, messageId: '777', kind: 'image', buffer: jpeg, contentType: 'image/jpeg' });
        if (!saved.ok) throw new Error('save failed');
        await recordInbound(TENANT, { kind: 'image', text: '[รูปภาพ]', messageId: '777', media: saved.media });
        await recordInbound(TENANT, { kind: 'image', text: '[รูปภาพ]', messageId: '777', media: saved.media }); // LINE redelivery
        const msgs = listPaths(`${T}/messages/`).filter(p => !p.includes('/chunks/')).map(p => read(p)!);
        expect(msgs).toHaveLength(1);
        expect(msgs[0]).toMatchObject({ id: '777', kind: 'image', media: { content_type: 'image/jpeg', chunks: 1 } });
        expect(read(T)?.last_message_text).toBe('[รูปภาพ]');
    });

    it('getTenantLink returns null for strangers', async () => {
        expect(await getTenantLink('U' + 'z'.repeat(32))).toBeNull();
        expect(await getTenantLink(TENANT)).toMatchObject({ uid: OWNER, building_id: BLD, room_id: 'r101' });
    });
});

async function media(uid: string | undefined, over: Record<string, unknown> = {}) {
    const res = fakeRes();
    await handler(fakeReq({ owner_uid: OWNER, building_id: BLD, line_user_id: TENANT, action: 'media', message_id: '777', ...over }, uid), res as never);
    return res as { statusCode: number; body: any };
}

describe('media action (the owner\'s browser fetches a stored file)', () => {
    beforeEach(async () => {
        const saved = await saveMedia({ ...base, messageId: '777', kind: 'audio', buffer: m4a, contentType: 'audio/m4a' });
        if (!saved.ok) throw new Error('save failed');
        await recordInbound(TENANT, { kind: 'audio', text: '[ข้อความเสียง]', messageId: '777', media: saved.media });
    });

    it('returns the file as a data URL with its content type', async () => {
        const res = await media(OWNER);
        expect(res.statusCode).toBe(200);
        expect(res.body.content_type).toBe('audio/m4a');
        expect(res.body.data_url).toBe(`data:audio/m4a;base64,${m4a.toString('base64')}`);
    });

    it('needs a token and message.read; cross-property members and outsiders are refused', async () => {
        expect((await media(undefined)).statusCode).toBe(401);
        seed(`users/${OWNER}/members/tech`, { uid: 'tech', role: 'technician', permissions: permissionsForRole('technician'), property_ids: ['*'], status: 'active' });
        expect((await media('tech')).statusCode).toBe(403);
        seed(`users/${OWNER}/members/desk`, { uid: 'desk', role: 'front_desk', permissions: permissionsForRole('front_desk'), property_ids: ['bld-OTHER'], status: 'active' });
        expect((await media('desk')).statusCode).toBe(403);
        seed(`users/${OWNER}/members/desk`, { uid: 'desk', role: 'front_desk', permissions: permissionsForRole('front_desk'), property_ids: [BLD], status: 'active' });
        expect((await media('desk')).statusCode).toBe(200);
    });

    it('cannot reach another property\'s tenant or files (404)', async () => {
        expect((await media(OWNER, { line_user_id: OTHER })).statusCode).toBe(404);
    });

    it('rejects unknown/missing/malformed message ids and messages without a file', async () => {
        expect((await media(OWNER, { message_id: 'nope' })).statusCode).toBe(404);
        expect((await media(OWNER, { message_id: '../../etc/passwd' })).statusCode).toBe(400);
        expect((await media(OWNER, { message_id: undefined })).statusCode).toBe(400);
        expect((await media(OWNER, { message_id: 42 })).statusCode).toBe(400);
        await recordInbound(TENANT, { kind: 'text', text: 'plain', messageId: '888' });
        expect((await media(OWNER, { message_id: '888' })).statusCode).toBe(404);
    });

    it('a message whose chunks are missing or corrupt is 404, not a broken file', async () => {
        const msgPath = messagePath(OWNER, BLD, TENANT, '777');
        seed(msgPath, { ...read(msgPath)!, media: { content_type: 'audio/m4a', size: 99, chunks: 3 } });
        expect((await media(OWNER)).statusCode).toBe(404);
    });
});
