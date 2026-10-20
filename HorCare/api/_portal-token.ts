/**
 * Signed tenant-portal links. A portal link (?uid=&bid=&rid=) only names a room; anyone who has one
 * could, before this, upload a slip for any bill in the building. The `t` parameter is an HMAC of the
 * room it was issued for, so the slip API can tell the caller really holds that room's link.
 *
 * Secret: PORTAL_LINK_SECRET (recommended — rotating it invalidates every link), falling back to
 * LINE_CHANNEL_SECRET so existing deployments keep working without new configuration.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const secret = () => process.env.PORTAL_LINK_SECRET || process.env.LINE_CHANNEL_SECRET || '';

export function portalToken(ownerUid: string, buildingId: string, roomId: string): string | null {
    const s = secret();
    if (!s) return null;
    return createHmac('sha256', s).update(`portal|${ownerUid}|${buildingId}|${roomId}`).digest('base64url').slice(0, 22);
}

export function verifyPortalToken(ownerUid: unknown, buildingId: unknown, roomId: unknown, token: unknown): boolean {
    if (typeof ownerUid !== 'string' || typeof buildingId !== 'string' || typeof roomId !== 'string' || typeof token !== 'string') return false;
    const expected = portalToken(ownerUid, buildingId, roomId);
    if (!expected || token.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

/** `uid=…&bid=…&rid=…&t=…` for a room (no `t` when no secret is configured). */
export function portalQuery(ownerUid: string, buildingId: string, roomId: string): string {
    const t = portalToken(ownerUid, buildingId, roomId);
    const q = `uid=${encodeURIComponent(ownerUid)}&bid=${encodeURIComponent(buildingId)}&rid=${encodeURIComponent(roomId)}`;
    return t ? `${q}&t=${t}` : q;
}
