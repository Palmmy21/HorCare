import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);
// many calls from one address here; the limiter has its own tests (_abuse-guard.test.ts)
vi.mock('./_abuse-guard.js', async () => ({ ...(await vi.importActual<typeof import('./_abuse-guard.js')>('./_abuse-guard.js')), rateLimit: async () => ({ ok: true, retryAfterSec: 0 }) }));
const pushes: { uid: string; title: string }[] = [];
vi.mock('./_notify-push.js', () => ({ pushToOwner: async (uid: string, msg: { title: string }) => { pushes.push({ uid, title: msg.title }); return 1; } }));

import { FakeSupabase } from './_fake-supabase.js';
const sb = new FakeSupabase();
let configured = true;
vi.mock('./_supabase.js', async () => {
    const real = await vi.importActual<typeof import('./_supabase.js')>('./_supabase.js');
    return { ...real, supabase: () => { if (!configured) throw new real.SupabaseNotConfigured(); return sb; } };
});

import handler from './_listing.js';
import { addAuthUser, fakeReq, fakeRes, listPaths, read, resetFake, seed } from './_fake-firestore.js';
import { addDays, todayTh } from '../src/shared/market.js';

const OWNER = 'owner-1';
const B = `users/${OWNER}/buildings/bld-1`;

async function call(body: object, uid?: string) {
    const res = fakeRes();
    await handler(fakeReq(body, uid), res as never);
    return res as unknown as { statusCode: number; body: Record<string, any> };
}

async function publish(over: object = {}) {
    return call({ action: 'publish', owner_uid: OWNER, building_id: 'bld-1', enabled: true, headline: 'ห้องใหม่ ใกล้ ม.', ...over }, OWNER);
}

beforeEach(() => {
    resetFake(); sb.reset(); configured = true; pushes.length = 0;
    addAuthUser(OWNER, 'o@x.com', 'Owner');
    addAuthUser('stranger', 's@x.com', 'S');
    seed(`users/${OWNER}`, { uid: OWNER });
    seed(B, { id: 'bld-1' });
    seed(`${B}/data/config`, { building_type: 'dormitory', bill_customization: { dorm_name: 'หอสุขใจ', dorm_phone: '0812345678' } });
    seed(`${B}/rooms/r1`, { room_number: '101', is_active: true, rent_amount: 3500, deposit_amount: 7000, amenities: ['wifi'] });
    seed(`${B}/rooms/r2`, { room_number: '102', is_active: true, rent_amount: 3600 });
    seed(`${B}/rooms/r3`, { room_number: '103', is_active: false, rent_amount: 3600 });
    seed(`${B}/tenants/r2`, { full_name: 'สมชาย', phone: '0899999999', move_in_date: '2025-01-01' });
});

describe('/api/listing', () => {
    it('publishes with a random slug and shows only vacant, active rooms without tenant data', async () => {
        const pub = await publish();
        expect(pub.statusCode).toBe(200);
        const slug = pub.body.listing.slug as string;
        expect(slug).toMatch(/^[a-z0-9]{12}$/);
        expect(read(`listing_slugs/${slug}`)).toMatchObject({ owner_uid: OWNER, building_id: 'bld-1' });

        const view = await call({ action: 'view', slug });
        expect(view.statusCode).toBe(200);
        expect(view.body.name).toBe('หอสุขใจ');
        expect(view.body.rooms.map((r: { number: string }) => r.number)).toEqual(['101']);
        expect(view.body.rooms[0]).toMatchObject({ rent: 3500, deposit: 7000, amenities: ['wifi'] });
        expect(JSON.stringify(view.body)).not.toContain('สมชาย');
        expect(JSON.stringify(view.body)).not.toContain(OWNER);
    });

    it('treats a room with an active lease as taken', async () => {
        sb.seed('leases', { id: 'l1', owner_uid: OWNER, building_id: 'bld-1', room_id: 'r1', status: 'active', start_date: addDays(todayTh(), -10), end_date: addDays(todayTh(), 300) });
        const slug = (await publish()).body.listing.slug;
        expect((await call({ action: 'view', slug })).body.rooms).toEqual([]);
    });

    it('hides prices when the owner turns them off, and keeps the slug on later publishes', async () => {
        const slug = (await publish()).body.listing.slug;
        const again = await publish({ show_prices: false, headline: '' });
        expect(again.body.listing.slug).toBe(slug);
        expect((read(`${B}/data/config`) as { listing: { headline?: string } }).listing.headline).toBeUndefined();
        expect((await call({ action: 'view', slug })).body.rooms[0]).toMatchObject({ rent: null, deposit: null });
    });

    it('is not found when turned off, unknown, or malformed', async () => {
        const slug = (await publish()).body.listing.slug;
        await publish({ enabled: false });
        expect((await call({ action: 'view', slug })).statusCode).toBe(404);
        expect((await call({ action: 'view', slug: 'abcdefgh1234' })).statusCode).toBe(404);
        expect((await call({ action: 'view', slug: '../users' })).statusCode).toBe(404);
    });

    it('only the owner (or leasing staff) can publish', async () => {
        expect((await call({ action: 'publish', owner_uid: OWNER, building_id: 'bld-1', enabled: true }, 'stranger')).statusCode).toBe(403);
        expect((await call({ action: 'publish', owner_uid: OWNER, building_id: 'bld-1', enabled: true })).statusCode).toBe(401);
        expect((await publish({ line_url: 'https://evil.example/x' })).statusCode).toBe(400);
    });

    it('saves a viewing request, adds a lead and tells the owner', async () => {
        const slug = (await publish()).body.listing.slug;
        const r = await call({ action: 'request', slug, room_id: 'r1', name: 'มานี', phone: '081-111-2222', move_in: addDays(todayTh(), 7) });
        expect(r.statusCode).toBe(200);
        const saved = listPaths(`${B}/viewing_requests/`).map(p => read(p));
        expect(saved).toHaveLength(1);
        expect(saved[0]).toMatchObject({ name: 'มานี', phone: '0811112222', room_number: '101', status: 'new' });
        expect(sb.rows('leasing_leads')).toHaveLength(1);
        expect(sb.rows('leasing_leads')[0]).toMatchObject({ source: 'online', interested_room_id: 'r1', created_by: 'public_listing' });
        expect(pushes).toEqual([{ uid: OWNER, title: 'มีคนขอดูห้อง 101' }]);
    });

    it('keeps the request when the leasing module is not set up', async () => {
        configured = false;
        const slug = (await publish()).body.listing.slug;
        expect((await call({ action: 'request', slug, name: 'มานี', phone: '0811112222' })).statusCode).toBe(200);
        expect(listPaths(`${B}/viewing_requests/`)).toHaveLength(1);
    });

    it('rejects bad input and silently drops bots', async () => {
        const slug = (await publish()).body.listing.slug;
        expect((await call({ action: 'request', slug, name: 'ม', phone: '0811112222' })).statusCode).toBe(400);
        expect((await call({ action: 'request', slug, name: 'มานี', phone: '12345' })).statusCode).toBe(400);
        expect((await call({ action: 'request', slug, name: 'มานี', phone: '0811112222', room_id: 'r3' })).statusCode).toBe(400);
        expect((await call({ action: 'request', slug, name: 'มานี', phone: '0811112222', website: 'spam' })).statusCode).toBe(200);
        expect(listPaths(`${B}/viewing_requests/`)).toHaveLength(0);
    });
});
