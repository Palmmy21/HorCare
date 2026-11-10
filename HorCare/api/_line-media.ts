/**
 * Storage for files tenants send over LINE (photos, voice messages, short videos, documents).
 *
 * Files are kept in Firestore, not Cloud Storage: Storage needs the paid Blaze plan for new
 * buckets, which this project avoids (slip images are stored the same way). A file is split
 * into base64 chunks under the message it belongs to:
 *
 *   users/{owner}/buildings/{b}/line_threads/{lineUserId}/messages/{messageId}/chunks/{n}
 *
 * Because chunks live under the message, a file can only ever be read through that message's
 * own property and thread — there is no path to guess. Firestore rules deny clients on this
 * subcollection; the owner's browser gets the file from /api/line-inbox (permission-checked).
 */
import { Jimp } from 'jimp';
import { db } from './_firebase.js';
import type { MessageKind, MessageMedia } from '../src/shared/messages.js';

/** Raw bytes per chunk: ≈680k base64 chars, safely under Firestore's 1 MiB document limit. */
export const CHUNK_RAW_BYTES = 510_000;
export const MAX_CHUNKS = 4;
export const MAX_MEDIA_BYTES = CHUNK_RAW_BYTES * MAX_CHUNKS; // ≈2 MB — keeps the API response under Vercel's 4.5 MB cap
/** A short clip gets more room: ≈3 MB raw is ≈4.1 MB as base64, the most one API response can carry. */
export const MAX_VIDEO_BYTES = CHUNK_RAW_BYTES * 6;
export const maxBytesFor = (kind: MessageKind): number => (kind === 'video' ? MAX_VIDEO_BYTES : MAX_MEDIA_BYTES);
/** Photos bigger than this are re-compressed before storing. */
const IMAGE_RECOMPRESS_ABOVE = 1_000_000;

const EXT_TYPES = new Set([
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'audio/x-m4a', 'audio/m4a', 'audio/mp4', 'audio/aac', 'audio/mpeg', 'audio/ogg', 'audio/wav',
]);
const VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/3gpp', 'video/webm']);
/** Documents a tenant plausibly sends a landlord. Nothing a browser would run. */
const FILE_TYPES: Record<string, string> = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
    txt: 'text/plain', csv: 'text/csv',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** The type to store a tenant's file as, from its name (LINE labels most files as a generic download). Null = not kept. */
export function fileContentType(fileName: string | undefined): string | null {
    const ext = (fileName ?? '').split('.').pop()?.toLowerCase() ?? '';
    return FILE_TYPES[ext] ?? null;
}

/** LINE sends voice messages as m4a, sometimes labelled with a generic type. */
export function normalizeContentType(kind: MessageKind, raw: string): string {
    const base = raw.split(';')[0].trim().toLowerCase();
    if (kind === 'audio' && !EXT_TYPES.has(base)) return 'audio/m4a';
    if (kind === 'image' && !EXT_TYPES.has(base)) return 'image/jpeg';
    if (kind === 'video' && !VIDEO_TYPES.has(base)) return 'video/mp4';
    return base;
}

export function isAllowedMedia(kind: MessageKind, contentType: string): boolean {
    const t = contentType.toLowerCase();
    if (kind === 'image') return t.startsWith('image/') && EXT_TYPES.has(t);
    if (kind === 'audio') return t.startsWith('audio/') && EXT_TYPES.has(t);
    if (kind === 'video') return VIDEO_TYPES.has(t);
    if (kind === 'file') return Object.values(FILE_TYPES).includes(t);
    return false;
}

/** After the tenant presses "ส่งสลิป", photos count as slips for this long. */
export const SLIP_WINDOW_MS = 30 * 60 * 1000;

/**
 * Is a photo from a registered tenant a payment slip? Yes if a Thai slip QR was read, or if the
 * tenant just asked to send a slip (so a blurry slip still reaches the payment flow). Otherwise
 * it is a normal chat photo for the owner.
 */
export function isSlipImage(input: { hasQr: boolean; expectedUntil?: number; now?: number }): boolean {
    if (input.hasQr) return true;
    return typeof input.expectedUntil === 'number' && input.expectedUntil > (input.now ?? Date.now());
}

export const messagePath = (owner: string, building: string, lineUserId: string, messageId: string) =>
    `users/${owner}/buildings/${building}/line_threads/${lineUserId}/messages/${messageId}`;

/** Split a buffer into chunk-sized slices. */
export function splitBuffer(buf: Buffer, size = CHUNK_RAW_BYTES): Buffer[] {
    const out: Buffer[] = [];
    for (let i = 0; i < buf.length; i += size) out.push(buf.subarray(i, i + size));
    return out;
}

/** Shrink a large photo until it is small enough to store. Returns null if it can't be read. */
async function recompressImage(buf: Buffer): Promise<Buffer | null> {
    try {
        const img = await Jimp.read(buf);
        for (const { w, q } of [{ w: 1600, q: 72 }, { w: 1280, q: 65 }, { w: 1024, q: 58 }, { w: 800, q: 50 }]) {
            if (img.bitmap.width > w) img.resize({ w });
            const out = await img.getBuffer('image/jpeg', { quality: q });
            if (out.length <= IMAGE_RECOMPRESS_ABOVE) return out;
        }
        return null;
    } catch {
        return null;
    }
}

export type SaveMediaResult =
    | { ok: true; media: MessageMedia }
    | { ok: false; reason: 'too_large' | 'unsupported' | 'storage_failed' };

export async function saveMedia(input: {
    ownerUid: string; buildingId: string; lineUserId: string; messageId: string;
    kind: MessageKind; buffer: Buffer; contentType: string;
    /** For `file`: the type comes from the name, since LINE's label for files says nothing. */
    fileName?: string;
}): Promise<SaveMediaResult> {
    let contentType = input.kind === 'file' ? (fileContentType(input.fileName) ?? '') : normalizeContentType(input.kind, input.contentType);
    if (!isAllowedMedia(input.kind, contentType)) return { ok: false, reason: 'unsupported' };
    if (input.buffer.length === 0) return { ok: false, reason: 'too_large' };

    let data = input.buffer;
    if (input.kind === 'image' && data.length > IMAGE_RECOMPRESS_ABOVE) {
        const smaller = await recompressImage(data);
        if (smaller) { data = smaller; contentType = 'image/jpeg'; }
    }
    if (data.length > maxBytesFor(input.kind)) return { ok: false, reason: 'too_large' };

    const chunks = splitBuffer(data);
    const base = `${messagePath(input.ownerUid, input.buildingId, input.lineUserId, input.messageId)}/chunks`;
    try {
        await Promise.all(chunks.map((c, i) => db.doc(`${base}/${i}`).set({ i, data: c.toString('base64') })));
    } catch (err) {
        console.error('[line-media] save failed:', (err as Error).message);
        return { ok: false, reason: 'storage_failed' };
    }
    return { ok: true, media: { content_type: contentType, size: data.length, chunks: chunks.length } };
}

/** Read a stored file back as a data URL, or null if any chunk is missing. */
export async function loadMediaDataUrl(msgPath: string, media: MessageMedia): Promise<string | null> {
    const snap = await db.collection(`${msgPath}/chunks`).get();
    const parts = snap.docs
        .map(d => d.data() as { i: number; data: string })
        .sort((a, b) => a.i - b.i);
    if (parts.length !== media.chunks || parts.some((p, i) => p.i !== i)) return null;
    return `data:${media.content_type};base64,${parts.map(p => p.data).join('')}`;
}
