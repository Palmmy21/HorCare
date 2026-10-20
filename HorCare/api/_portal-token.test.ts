import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import { portalQuery, portalToken, verifyPortalToken } from './_portal-token.js';
import uploadSlip from './_upload-slip.js';
import { resetFake, seed } from './_fake-firestore.js';

const res = () => {
    const r = { statusCode: 0, body: undefined as unknown, status(c: number) { r.statusCode = c; return r; }, json(b: unknown) { r.body = b; return r; } };
    return r;
};
const call = async (body: Record<string, unknown>) => {
    const r = res();
    await uploadSlip({ method: 'POST', body, headers: {}, socket: { remoteAddress: '203.0.113.9' } } as never, r as never);
    return r;
};

beforeEach(() => { process.env.PORTAL_LINK_SECRET = 'test-secret'; resetFake(); });
afterEach(() => { delete process.env.PORTAL_LINK_SECRET; delete process.env.LINE_CHANNEL_SECRET; });

describe('portal token', () => {
    it('is bound to the room it was issued for', () => {
        const t = portalToken('o1', 'b1', 'r1')!;
        expect(verifyPortalToken('o1', 'b1', 'r1', t)).toBe(true);
        expect(verifyPortalToken('o1', 'b1', 'r2', t)).toBe(false);
        expect(verifyPortalToken('o1', 'b2', 'r1', t)).toBe(false);
        expect(verifyPortalToken('o1', 'b1', 'r1', undefined)).toBe(false);
        expect(verifyPortalToken('o1', 'b1', 'r1', 'x')).toBe(false);
    });

    it('builds a link query with the token, and none without a secret', () => {
        expect(portalQuery('o1', 'b1', 'r1')).toBe(`uid=o1&bid=b1&rid=r1&t=${portalToken('o1', 'b1', 'r1')}`);
        delete process.env.PORTAL_LINK_SECRET;
        expect(portalQuery('o1', 'b1', 'r1')).toBe('uid=o1&bid=b1&rid=r1');
        expect(verifyPortalToken('o1', 'b1', 'r1', '')).toBe(false); // no secret → nothing verifies
    });
});

// The portal page packs a signed `?uid=&bid=&rid=&t=` link as `<uid>~<bid>~<rid>~h.<t>` (src/components/TenantPortal/portalApi.ts).
const legacy = (room: string, t = portalToken('o1', 'b1', room)) => `o1~b1~${room}~h.${t}`;

describe('upload-slip access', () => {
    const B = 'users/o1/buildings/b1';
    beforeEach(() => {
        seed(`${B}/rooms/r1`, { room_number: '101' });
        seed(`${B}/rooms/r2`, { room_number: '102' });
        seed(`${B}/bills/other`, { id: 'other', room_id: 'r2', total_bill: 3500, payment_status: 'unpaid' });
    });

    it('refuses a caller without the room\'s link, or with a forged one', async () => {
        const r = await call({ uid: 'o1', buildingId: 'b1', roomId: 'r1', itemId: 'other', itemType: 'bill', base64: 'x' });
        expect(r.statusCode).toBe(401);
        const split = await call({ action: 'split', portal: legacy('r1', 'forged'), itemId: 'other', itemType: 'bill', slipRef: 'a' });
        expect(split.statusCode).toBe(401);
    });

    it('refuses another room\'s bill even with a valid link', async () => {
        const r = await call({ portal: legacy('r1'), itemId: 'other', itemType: 'bill', base64: 'data:image/jpeg;base64,AAAA' });
        expect(r.statusCode).toBe(404);
        const split = await call({ action: 'split', portal: legacy('r1'), itemId: 'other', itemType: 'bill', slipRef: 'a' });
        expect(split.statusCode).toBe(404);
    });

    it('a signed link stops working once the room\'s portal link has been reset', async () => {
        seed('portal_links/o1__b1__r2', { owner_uid: 'o1', building_id: 'b1', room_id: 'r2', secret: 'new', rotated_at: '2026-10-20T00:00:00Z' });
        const r = await call({ action: 'split', portal: legacy('r2'), itemId: 'other', itemType: 'bill', slipRef: 'a' });
        expect(r.statusCode).toBe(401);
    });
});
