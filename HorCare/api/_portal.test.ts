import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);
vi.mock('./_abuse-guard.js', async () => ({ ...(await vi.importActual<typeof import('./_abuse-guard.js')>('./_abuse-guard.js')), rateLimit: async () => ({ ok: true, retryAfterSec: 0 }) }));

import handler, { lineUserFromAccessToken } from './_portal.js';
import { portalUrlFor, resolvePortalLink, rotatePortalLink } from './_portal-link.js';
import { addAuthUser, fakeReq, fakeRes, listPaths, read, resetFake, seed, seedPortalLink } from './_fake-firestore.js';
import { permissionsForRole } from '../src/shared/permissions.js';

const OWNER = 'owner-1';
const BLD = 'bld-A';
const B = `users/${OWNER}/buildings/${BLD}`;
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

async function call(body: Record<string, unknown>, uid?: string) {
    const res = fakeRes();
    await handler(fakeReq(body, uid), res as never);
    return res as { statusCode: number; body: any };
}

beforeEach(() => {
    resetFake();
    addAuthUser(OWNER, 'o@x.com', 'Owner');
    addAuthUser('desk', 'd@x.com', 'Desk');
    addAuthUser('tech', 't@x.com', 'Tech');
    seed(`users/${OWNER}`, { uid: OWNER });
    seed(B, { id: BLD, name: 'ตึก A' });
    seed(`${B}/data/config`, { building_type: 'dormitory', bill_customization: { dorm_name: 'หอ A' }, portal_pin: '', dorm_code: 'HC-SECRET', electricity_rate: 8 });
    seed(`${B}/rooms/r1`, { room_number: '101', rent_amount: 3500, line_user_id: 'U' + 'a'.repeat(32) });
    seed(`${B}/rooms/r2`, { room_number: '102', rent_amount: 3600 });
    seed(`${B}/tenants/r1`, { full_name: 'สมชาย', phone: '0811111111', id_card_number: '1234567890123', birthdate: '1990-01-01', deposit_note: 'internal' });
    seed(`${B}/tenants/r2`, { full_name: 'สมหญิง', phone: '0822222222' });
    seed(`${B}/bills/b1`, { id: 'b1', room_id: 'r1', month: '2026-10', total_bill: 4000 });
    seed(`${B}/bills/b2`, { id: 'b2', room_id: 'r2', month: '2026-10', total_bill: 9999 });
    seed(`${B}/fines/f2`, { id: 'f2', room_id: 'r2', amount: 100 });
    for (const [uid, role] of [['desk', 'front_desk'], ['tech', 'technician']] as const)
        seed(`users/${OWNER}/members/${uid}`, { uid, role, permissions: permissionsForRole(role), property_ids: ['*'], status: 'active' });
});

describe('portal links', () => {
    it('are created once per room and stop working when rotated', async () => {
        const url = await portalUrlFor(OWNER, BLD, 'r1');
        const packed = decodeURIComponent(url.split('?p=')[1]);
        expect(await portalUrlFor(OWNER, BLD, 'r1')).toBe(url);
        expect((await resolvePortalLink(packed))?.roomId).toBe('r1');
        await rotatePortalLink({ ownerUid: OWNER, buildingId: BLD, roomId: 'r1' });
        expect(await resolvePortalLink(packed)).toBeNull();
    });

    it('cannot be turned into another room\'s link by editing the ids', async () => {
        const packed = seedPortalLink(OWNER, BLD, 'r1');
        seedPortalLink(OWNER, BLD, 'r2', 'another-secret-another-secret-12');
        expect(await resolvePortalLink(packed.replace('~r1~', '~r2~'))).toBeNull();
        expect(await resolvePortalLink(`${OWNER}~${BLD}~r1`)).toBeNull();
        expect(await resolvePortalLink(42)).toBeNull();
    });
});

describe('view', () => {
    it('shows only this room, and keeps private fields server-side', async () => {
        const res = await call({ action: 'view', portal: seedPortalLink(OWNER, BLD, 'r1') });
        expect(res.statusCode).toBe(200);
        expect(res.body.room).toMatchObject({ id: 'r1', room_number: '101', rent_amount: 3500 });
        expect(res.body.bills.map((b: any) => b.id)).toEqual(['b1']);
        expect(res.body.fines).toEqual([]);
        expect(res.body.profile).toMatchObject({ full_name: 'สมชาย', phone: '0811111111' });
        const text = JSON.stringify(res.body);
        for (const secret of ['สมหญิง', '9999', 'HC-SECRET', 'line_user_id', 'id_card_number', '1234567890123', 'internal', 'portal_pin']) expect(text).not.toContain(secret);
    });

    it('refuses room ids without a link, and a forged link', async () => {
        expect((await call({ action: 'view', owner_uid: OWNER, building_id: BLD, room_id: 'r2' })).statusCode).toBe(401);
        expect((await call({ action: 'view', portal: `${OWNER}~${BLD}~r2~guess` })).statusCode).toBe(401);
    });

    it('checks the property PIN on the server', async () => {
        seed(`${B}/data/config`, { building_type: 'dormitory', portal_pin: '4321' });
        const portal = seedPortalLink(OWNER, BLD, 'r1');
        expect((await call({ action: 'view', portal })).body.error).toBe('pin_required');
        expect((await call({ action: 'view', portal, pin: '0000' })).body.error).toBe('pin_incorrect');
        expect((await call({ action: 'view', portal, pin: '4321' })).statusCode).toBe(200);
        // writes need it too
        expect((await call({ action: 'profile_update', portal, full_name: 'x' })).statusCode).toBe(401);
    });
});

describe('tenant writes', () => {
    it('profile_update changes only the allowed contact fields of this room', async () => {
        const portal = seedPortalLink(OWNER, BLD, 'r1');
        const res = await call({ action: 'profile_update', portal, full_name: 'สมชาย ใจดี', phone: '0899999999', id_card_number: '999', room_id: 'r2' });
        expect(res.statusCode).toBe(200);
        expect(read(`${B}/tenants/r1`)).toMatchObject({ full_name: 'สมชาย ใจดี', phone: '0899999999', id_card_number: '1234567890123' });
        expect(read(`${B}/tenants/r2`)).toMatchObject({ full_name: 'สมหญิง' });
        expect((await call({ action: 'profile_update', portal, full_name: 'x'.repeat(500) })).statusCode).toBe(400);
    });

    it('maintenance_create validates and files the request under this room', async () => {
        const portal = seedPortalLink(OWNER, BLD, 'r1');
        expect((await call({ action: 'maintenance_create', portal, category: 'nuke', urgency: 'normal', description: 'x' })).statusCode).toBe(400);
        expect((await call({ action: 'maintenance_create', portal, category: 'ac', urgency: 'normal', description: '' })).statusCode).toBe(400);
        expect((await call({ action: 'maintenance_create', portal, category: 'ac', urgency: 'normal', description: 'x', photo: 'javascript:alert(1)' })).statusCode).toBe(400);
        const ok = await call({ action: 'maintenance_create', portal, category: 'ac', urgency: 'urgent', description: 'แอร์ไม่เย็น', photo: PNG, room_id: 'r2' });
        expect(ok.statusCode).toBe(200);
        expect(read(`${B}/maintenance/${ok.body.id}`)).toMatchObject({ room_id: 'r1', room_number: '101', status: 'open', photo_url: PNG });
    });

    it('cleaning_create files under this room and caps open requests', async () => {
        const portal = seedPortalLink(OWNER, BLD, 'r1');
        const req = { action: 'cleaning_create', portal, service_type: 'general', preferred_date: '2026-10-21', preferred_time_slot: 'เช้า', description: '' };
        expect((await call({ ...req, preferred_date: 'tomorrow' })).statusCode).toBe(400);
        for (let i = 0; i < 5; i++) expect((await call(req)).statusCode).toBe(200);
        expect((await call(req)).body.error).toBe('too_many_open_requests');
        const docs = listPaths(`${B}/cleaning/`).map(p => read(p)!);
        expect(docs.every(d => d.room_id === 'r1' && d.status === 'pending' && d.tenant_name === 'สมชาย')).toBe(true);
    });

    it('contract_sign signs a pending contract once and records the event', async () => {
        const portal = seedPortalLink(OWNER, BLD, 'r1');
        expect((await call({ action: 'contract_sign', portal, signature: PNG })).body.error).toBe('no_contract');
        seed(`${B}/tenants/r1`, { full_name: 'สมชาย', signed_contract: { status: 'pending_lessee', lessee_name: 'สมชาย', contract_number: 'C-1' } });
        expect((await call({ action: 'contract_sign', portal, signature: 'nope' })).statusCode).toBe(400);
        expect((await call({ action: 'contract_sign', portal, signature: PNG })).statusCode).toBe(200);
        expect(read(`${B}/tenants/r1`)?.signed_contract).toMatchObject({ status: 'signed', lessee_signature: PNG });
        expect(listPaths(`${B}/tenants/r1/events/`)).toHaveLength(1);
        expect((await call({ action: 'contract_sign', portal, signature: PNG })).body.error).toBe('not_signable');
    });
});

describe('staff link / rotate', () => {
    it('staff with tenant.read get the link; only tenant.update may reset it', async () => {
        expect((await call({ action: 'link', owner_uid: OWNER, building_id: BLD, room_id: 'r1' })).statusCode).toBe(401);
        expect((await call({ action: 'link', owner_uid: OWNER, building_id: BLD, room_id: 'r1' }, 'tech')).statusCode).toBe(403);
        const got = await call({ action: 'link', owner_uid: OWNER, building_id: BLD, room_id: 'r1' }, 'desk');
        expect(got.statusCode).toBe(200);
        expect(got.body.url).toContain('?p=');
        expect((await call({ action: 'rotate', owner_uid: OWNER, building_id: BLD, room_id: 'r1' }, 'desk')).statusCode).toBe(403);
        const rotated = await call({ action: 'rotate', owner_uid: OWNER, building_id: BLD, room_id: 'r1' }, OWNER);
        expect(rotated.body.portal).not.toBe(got.body.portal);
        expect((await call({ action: 'view', portal: got.body.portal })).statusCode).toBe(401);
        expect((await call({ action: 'view', portal: rotated.body.portal })).statusCode).toBe(200);
        expect(listPaths(`users/${OWNER}/audit_logs/`)).toHaveLength(1);
    });
});

describe('liff', () => {
    const fetchFor = (clientId: string, userId: string) => vi.fn(async (url: string) =>
        url.includes('/verify') ? new Response(JSON.stringify({ client_id: clientId, expires_in: 100 })) : new Response(JSON.stringify({ userId })));

    it('accepts only tokens issued to our LINE channel', async () => {
        process.env.LINE_LOGIN_CHANNEL_ID = '1650000000';
        const user = 'U' + 'b'.repeat(32);
        expect(await lineUserFromAccessToken('t', fetchFor('1650000000', user) as never)).toBe(user);
        expect(await lineUserFromAccessToken('t', fetchFor('9999999999', user) as never)).toBeNull();
        delete process.env.LINE_LOGIN_CHANNEL_ID;
    });

    it('returns the registered room\'s link', async () => {
        process.env.LINE_LOGIN_CHANNEL_ID = '1650000000';
        const user = 'U' + 'c'.repeat(32);
        seed(`line_rooms/${user}`, { uid: OWNER, building_id: BLD, room_id: 'r1', room_number: '101' });
        vi.stubGlobal('fetch', fetchFor('1650000000', user));
        const res = await call({ action: 'liff', access_token: 'tok' });
        expect(res.statusCode).toBe(200);
        expect((await resolvePortalLink(res.body.portal))?.roomId).toBe('r1');
        vi.unstubAllGlobals();
        delete process.env.LINE_LOGIN_CHANNEL_ID;
    });
});
