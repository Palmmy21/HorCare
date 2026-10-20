/**
 * Tenant portal links.
 *
 * A link carries the room it opens and a random secret: `/?p=<owner>~<building>~<room>~<secret>`. The secret lives
 * server-side in `portal_links/{owner}__{building}__{room}` (no client can read that collection), so knowing a room's
 * ids — which every tenant of the building can guess — is not enough to open another room's portal.
 *
 * Rotating the secret (a new tenant moves in, or the owner resets it) makes every older link for that room stop
 * working at once, without touching any other room.
 */
import { randomInt, timingSafeEqual } from 'node:crypto';
import { db } from './_firebase.js';
import { appBaseUrl } from './_app-url.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const SECRET_LEN = 32;

export interface PortalRoom {
    ownerUid: string;
    buildingId: string;
    roomId: string;
}

const linkDoc = (r: PortalRoom) => db.doc(`portal_links/${r.ownerUid}__${r.buildingId}__${r.roomId}`);

function newSecret(): string {
    let s = '';
    for (let i = 0; i < SECRET_LEN; i++) s += ALPHABET[randomInt(ALPHABET.length)];
    return s;
}

function sameSecret(a: string, b: string): boolean {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
}

export function packPortalLink(r: PortalRoom, secret: string): string {
    return [r.ownerUid, r.buildingId, r.roomId, secret].join('~');
}

export function parsePortalLink(packed: unknown): (PortalRoom & { secret: string }) | null {
    if (typeof packed !== 'string' || packed.length > 400) return null;
    const parts = packed.split('~');
    if (parts.length !== 4 || parts.some(p => !p || p.includes('/'))) return null;
    return { ownerUid: parts[0], buildingId: parts[1], roomId: parts[2], secret: parts[3] };
}

/** The room's current secret, created on first use. */
export async function portalSecretFor(r: PortalRoom): Promise<string> {
    const ref = linkDoc(r);
    const snap = await ref.get();
    const existing = snap.exists ? (snap.data() as { secret?: string }).secret : undefined;
    if (existing) return existing;
    const secret = newSecret();
    try {
        await ref.create({ owner_uid: r.ownerUid, building_id: r.buildingId, room_id: r.roomId, secret, created_at: new Date().toISOString() });
        return secret;
    } catch {
        // created by a concurrent call — use theirs so both links work
        const again = await ref.get();
        const theirs = (again.data() as { secret?: string } | undefined)?.secret;
        if (!theirs) throw new Error('portal link could not be created');
        return theirs;
    }
}

/** The packed link value (what goes after `?p=`). */
export async function portalLinkFor(r: PortalRoom): Promise<string> {
    return packPortalLink(r, await portalSecretFor(r));
}

/** Full portal URL for a room, for LINE messages and notifications. */
export async function portalUrlFor(ownerUid: string, buildingId: string, roomId: string): Promise<string> {
    return `${appBaseUrl()}/?p=${encodeURIComponent(await portalLinkFor({ ownerUid, buildingId, roomId }))}`;
}

/** Issue a new secret: every link handed out before stops working. Returns the new packed link. */
export async function rotatePortalLink(r: PortalRoom): Promise<string> {
    const secret = newSecret();
    const now = new Date().toISOString();
    await linkDoc(r).set({ owner_uid: r.ownerUid, building_id: r.buildingId, room_id: r.roomId, secret, created_at: now, rotated_at: now });
    return packPortalLink(r, secret);
}

/**
 * The room a packed link opens, or null when the link is malformed, revoked, or the room no longer exists.
 * Callers must use the ids returned here, never ids sent alongside the link.
 */
export async function resolvePortalLink(packed: unknown): Promise<(PortalRoom & { room: Record<string, unknown> }) | null> {
    const parsed = parsePortalLink(packed);
    if (!parsed) return null;
    const snap = await linkDoc(parsed).get();
    const stored = snap.exists ? (snap.data() as { secret?: string }).secret : undefined;
    if (!stored || !sameSecret(stored, parsed.secret)) return null;
    const room = await db.doc(`users/${parsed.ownerUid}/buildings/${parsed.buildingId}/rooms/${parsed.roomId}`).get();
    if (!room.exists) return null;
    return { ownerUid: parsed.ownerUid, buildingId: parsed.buildingId, roomId: parsed.roomId, room: room.data() as Record<string, unknown> };
}
