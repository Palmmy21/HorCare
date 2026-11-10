import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import webhook from './line-webhook.js';
import inbox from './_line-inbox.js';
import { MAX_MEDIA_BYTES, MAX_VIDEO_BYTES, fileContentType, isAllowedMedia, normalizeContentType } from './_line-media.js';
import { addAuthUser, fakeReq, fakeRes, listPaths, read, resetFake, seed } from './_fake-firestore.js';
import { fileSizeText, mapUrl, stickerUrl } from '../src/shared/messages.js';

// Everything a tenant can send that is not text: each reaches the owner's inbox in a form they can open.
const OWNER = 'owner-1';
const BLD = 'bld-A';
const B = `users/${OWNER}/buildings/${BLD}`;
const SECRET = 'tenant-secret';
const TENANT = 'U' + 'a'.repeat(32);
const STRANGER = 'U' + 'c'.repeat(32);
const THREAD = `${B}/line_threads/${TENANT}`;

const fetchMock = vi.fn();
/** What LINE's content endpoint answers, by message id (and "<id>/preview"). */
let contents: Record<string, { type: string; bytes: number; declared?: number; status?: number }>;

beforeEach(() => {
    resetFake();
    contents = {};
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => {
        const m = /\/message\/([^/]+)\/content(\/preview)?$/.exec(String(url));
        if (m) {
            const c = contents[m[2] ? `${m[1]}/preview` : m[1]];
            if (!c || (c.status ?? 200) >= 300 || c.status === 202) return { ok: !!c && c.status === 202 ? false : false, status: c?.status ?? 404, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) };
            const body = Buffer.alloc(c.bytes, 7);
            return {
                ok: true, status: 200, headers: new Headers({ 'content-type': c.type, 'content-length': String(c.declared ?? c.bytes) }),
                arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
            };
        }
        return { ok: true, status: 200, text: async () => '', json: async () => ({}), headers: new Headers() };
    });
    vi.stubGlobal('fetch', fetchMock);
    process.env.LINE_CHANNEL_SECRET = SECRET;
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'tenant-token';
    addAuthUser(OWNER, 'o@x.com', 'Owner');
    seed(`users/${OWNER}`, { uid: OWNER });
    seed(B, { id: BLD });
    seed(`${B}/rooms/r101`, { room_number: '101', is_active: true, line_user_id: TENANT });
    seed(`line_rooms/${TENANT}`, { uid: OWNER, building_id: BLD, room_id: 'r101', room_number: '101' });
});

afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LINE_CHANNEL_SECRET;
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
});

async function send(message: Record<string, unknown>, user = TENANT) {
    const raw = Buffer.from(JSON.stringify({ events: [{ type: 'message', replyToken: 'rt', source: { userId: user }, message }] }));
    const req = Readable.from([raw]) as never as { method: string; headers: object };
    req.method = 'POST';
    req.headers = { 'x-line-signature': createHmac('sha256', SECRET).update(raw).digest('base64') };
    const res = fakeRes();
    fetchMock.mockClear();
    await webhook(req as never, res as never);
    expect(res.statusCode).toBe(200);
}
const reply = () => {
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/v2/bot/message/reply'));
    return call ? (JSON.parse(call[1].body) as { messages: { text: string }[] }).messages[0].text : null;
};
const stored = (id: string) => read(`${THREAD}/messages/${id}`);
const chunks = (id: string) => listPaths(`${THREAD}/messages/${id}/chunks/`).length;
/** What the owner's browser gets when it opens a message's file. */
async function openFile(id: string) {
    const res = fakeRes();
    await inbox(fakeReq({ action: 'media', owner_uid: OWNER, building_id: BLD, line_user_id: TENANT, message_id: id }, OWNER) as never, res as never);
    return res as unknown as { statusCode: number; body: { data_url?: string; content_type?: string } };
}

describe('location', () => {
    it('keeps the place, its address and the pin', async () => {
        await send({ type: 'location', id: 'loc1', title: 'หอพักสุขใจ', address: '99 ถ.พหลโยธิน', latitude: 13.7563, longitude: 100.5018 });
        expect(stored('loc1')).toMatchObject({
            kind: 'location', direction: 'in', text: '[ตำแหน่ง] หอพักสุขใจ · 99 ถ.พหลโยธิน',
            location: { title: 'หอพักสุขใจ', address: '99 ถ.พหลโยธิน', lat: 13.7563, lng: 100.5018 },
        });
        expect(read(THREAD)).toMatchObject({ unread_count: 1, last_message_text: '[ตำแหน่ง] หอพักสุขใจ · 99 ถ.พหลโยธิน' });
        expect(reply()).toContain('ได้รับตำแหน่งแล้ว');
        expect(mapUrl({ lat: 13.7563, lng: 100.5018 })).toBe('https://www.google.com/maps?q=13.7563,100.5018');
    });

    it('falls back to the coordinates when LINE sends no address, and drops impossible ones', async () => {
        await send({ type: 'location', id: 'loc2', latitude: 18.7883, longitude: 98.9853 });
        expect(stored('loc2')?.text).toBe('[ตำแหน่ง] 18.78830, 98.98530');
        await send({ type: 'location', id: 'loc3', latitude: 913, longitude: 100 });
        expect(stored('loc3')).toBeUndefined();
    });
});

describe('video', () => {
    it('a short clip is kept and comes back as a playable file', async () => {
        contents.v1 = { type: 'video/mp4', bytes: 900_000 };
        await send({ type: 'video', id: 'v1', duration: 8000 });
        expect(stored('v1')).toMatchObject({ kind: 'video', text: '[วิดีโอ]', duration_ms: 8000, media: { content_type: 'video/mp4', size: 900_000, chunks: 2 } });
        expect(chunks('v1')).toBe(2);
        const file = await openFile('v1');
        expect(file.statusCode).toBe(200);
        expect(file.body.data_url!.startsWith('data:video/mp4;base64,')).toBe(true);
        expect(reply()).toContain('ได้รับวิดีโอแล้ว');
    });

    it('a long one is never downloaded: the owner gets its still picture and size, the tenant is told', async () => {
        contents.v2 = { type: 'video/mp4', bytes: 10, declared: 48_000_000 };
        contents['v2/preview'] = { type: 'image/jpeg', bytes: 20_000 };
        await send({ type: 'video', id: 'v2', duration: 95000 });
        expect(stored('v2')).toMatchObject({ kind: 'video', media: { content_type: 'image/jpeg', preview: true, chunks: 1 } });
        expect(stored('v2')?.text).toContain('48.0 MB');
        expect(reply()).toContain('ไฟล์ใหญ่เกินไป (48.0 MB)');
        expect(reply()).toContain('คลิปสั้น');
    });

    it('a video LINE cannot hand over yet still reaches the inbox, as a note', async () => {
        contents.v3 = { type: 'video/mp4', bytes: 0, status: 202 };
        await send({ type: 'video', id: 'v3' });
        expect(stored('v3')).toMatchObject({ kind: 'video', text: '[วิดีโอ] (เปิดไฟล์ไม่ได้)' });
        expect(stored('v3')?.media).toBeUndefined();
        expect(reply()).toContain('ส่งใหม่อีกครั้ง');
    });

    it('a clip at the limit is kept; one byte over is not', async () => {
        contents.v4 = { type: 'video/mp4', bytes: MAX_VIDEO_BYTES };
        await send({ type: 'video', id: 'v4' });
        expect(stored('v4')?.media).toMatchObject({ chunks: 6 });
        contents.v5 = { type: 'video/mp4', bytes: MAX_VIDEO_BYTES + 1 };
        await send({ type: 'video', id: 'v5' });
        expect(stored('v5')?.media).toBeUndefined();
    });
});

describe('files', () => {
    it('a PDF is kept under its own name and downloads as a PDF', async () => {
        contents.f1 = { type: 'application/octet-stream', bytes: 120_000 };   // how LINE labels every file
        await send({ type: 'file', id: 'f1', fileName: 'สัญญาเช่า.pdf', fileSize: 120_000 });
        expect(stored('f1')).toMatchObject({ kind: 'file', text: '[ไฟล์] สัญญาเช่า.pdf', file_name: 'สัญญาเช่า.pdf', media: { content_type: 'application/pdf', size: 120_000 } });
        expect((await openFile('f1')).body.content_type).toBe('application/pdf');
    });

    it('a kind the inbox cannot hand back is noted, not stored, and the tenant is asked for a PDF or photo', async () => {
        contents.f2 = { type: 'application/octet-stream', bytes: 5000 };
        await send({ type: 'file', id: 'f2', fileName: 'setup.exe', fileSize: 5000 });
        expect(stored('f2')?.text).toBe('[ไฟล์] setup.exe (ชนิดไฟล์นี้เปิดในระบบไม่ได้)');
        expect(stored('f2')?.media).toBeUndefined();
        expect(chunks('f2')).toBe(0);
        expect(reply()).toContain('PDF หรือรูปภาพ');
        expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/content'))).toBe(false);
    });

    it('a file LINE says is too large is not downloaded at all', async () => {
        await send({ type: 'file', id: 'f3', fileName: 'big.pdf', fileSize: 9_000_000 });
        expect(stored('f3')?.text).toContain('9.0 MB');
        expect(reply()).toContain(`เล็กกว่า ${fileSizeText(MAX_MEDIA_BYTES)}`);
        expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/content'))).toBe(false);
    });
});

describe('voice messages and stickers', () => {
    it('a voice message keeps its length', async () => {
        contents.a1 = { type: 'audio/x-m4a', bytes: 30_000 };
        await send({ type: 'audio', id: 'a1', duration: 4200 });
        expect(stored('a1')).toMatchObject({ kind: 'audio', duration_ms: 4200, media: { content_type: 'audio/x-m4a' } });
    });

    it('a sticker keeps the ids that show its picture, and is not answered', async () => {
        await send({ type: 'sticker', id: 's1', packageId: '446', stickerId: '1988' });
        const [path] = listPaths(`${THREAD}/messages/`);
        expect(read(path)).toMatchObject({ kind: 'sticker', sticker: { package_id: '446', sticker_id: '1988' } });
        expect(reply()).toBeNull();
        expect(stickerUrl('1988')).toBe('https://stickershop.line-scdn.net/stickershop/v1/sticker/1988/android/sticker.png');
    });
});

describe('someone not registered', () => {
    it('is told how to register, and nothing is fetched or stored', async () => {
        for (const message of [
            { type: 'location', id: 'x1', latitude: 13, longitude: 100 },
            { type: 'video', id: 'x2' },
            { type: 'file', id: 'x3', fileName: 'a.pdf', fileSize: 10 },
            { type: 'audio', id: 'x4' },
        ]) {
            await send(message, STRANGER);
            expect(reply()).toContain('ยังไม่ได้ลงทะเบียน');
            expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/content'))).toBe(false);
        }
        expect(listPaths(`${B}/line_threads/`)).toEqual([]);
    });
});

describe('what may be stored', () => {
    it('takes a file\'s type from its name, and only kinds a landlord would be sent', () => {
        expect(fileContentType('บิล.PDF')).toBe('application/pdf');
        expect(fileContentType('photo.jpeg')).toBe('image/jpeg');
        expect(fileContentType('list.xlsx')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        for (const bad of ['page.html', 'logo.svg', 'run.exe', 'a.zip', 'noext', undefined]) expect(fileContentType(bad)).toBeNull();
    });
    it('knows videos, and treats an unlabelled one as mp4', () => {
        expect(normalizeContentType('video', 'application/octet-stream')).toBe('video/mp4');
        expect(isAllowedMedia('video', 'video/mp4')).toBe(true);
        expect(isAllowedMedia('video', 'image/jpeg')).toBe(false);
        expect(isAllowedMedia('file', 'text/html')).toBe(false);
    });
});
