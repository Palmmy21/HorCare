/**
 * Storage for files tenants send over LINE (photos, voice messages).
 *
 * Files go to Cloud Storage under line_media/{owner}/{building}/{lineUserId}/{id}.{ext} via the
 * Admin SDK; storage rules deny every client. The owner's browser gets a short-lived signed URL
 * from /api/line-inbox (permission-checked) instead.
 */
import { admin } from './_firebase.js';
import type { MessageKind, MessageMedia } from '../src/shared/messages.js';

export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
export const SIGNED_URL_TTL_MS = 15 * 60 * 1000;

const EXT: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
    'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/mpeg': 'mp3',
    'audio/ogg': 'ogg', 'audio/wav': 'wav',
};

/** LINE sends voice messages as m4a, sometimes labelled with a generic type. */
export function normalizeContentType(kind: MessageKind, raw: string): string {
    const base = raw.split(';')[0].trim().toLowerCase();
    if (kind === 'audio' && !EXT[base]) return 'audio/m4a';
    if (kind === 'image' && !EXT[base]) return 'image/jpeg';
    return base;
}

export function isAllowedMedia(kind: MessageKind, contentType: string): boolean {
    const t = contentType.toLowerCase();
    if (kind === 'image') return t.startsWith('image/') && t in EXT;
    if (kind === 'audio') return t.startsWith('audio/') && t in EXT;
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

export const mediaPathPrefix = (owner: string, building: string) => `line_media/${owner}/${building}/`;

export type SaveMediaResult =
    | { ok: true; media: MessageMedia }
    | { ok: false; reason: 'too_large' | 'unsupported' | 'storage_failed' };

export async function saveMedia(input: {
    ownerUid: string; buildingId: string; lineUserId: string; messageId: string;
    kind: MessageKind; buffer: Buffer; contentType: string;
}): Promise<SaveMediaResult> {
    const contentType = normalizeContentType(input.kind, input.contentType);
    if (!isAllowedMedia(input.kind, contentType)) return { ok: false, reason: 'unsupported' };
    if (input.buffer.length === 0 || input.buffer.length > MAX_MEDIA_BYTES) return { ok: false, reason: 'too_large' };

    const path = `${mediaPathPrefix(input.ownerUid, input.buildingId)}${input.lineUserId}/${input.messageId}.${EXT[contentType]}`;
    try {
        await admin.storage().bucket().file(path).save(input.buffer, { contentType, resumable: false });
    } catch (err) {
        console.error('[line-media] save failed:', (err as Error).message);
        return { ok: false, reason: 'storage_failed' };
    }
    return { ok: true, media: { path, content_type: contentType, size: input.buffer.length } };
}

export async function signedUrlFor(path: string): Promise<string> {
    const [url] = await admin.storage().bucket().file(path).getSignedUrl({
        version: 'v4', action: 'read', expires: Date.now() + SIGNED_URL_TTL_MS,
    });
    return url;
}
