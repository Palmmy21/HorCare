import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);
const { aiGenerate } = vi.hoisted(() => ({ aiGenerate: vi.fn() }));
vi.mock('./_ai.js', async (orig) => ({ ...(await orig<typeof import('./_ai.js')>()), aiGenerate }));

import handler from './_parcels.js';
import { AiError } from './_ai.js';
import { parseParcelLabel } from './_parcel-ocr.js';
import { decideChannels, renderMessage } from './_notify.js';
import { addAuthUser, fakeReq, fakeRes, listPaths, read, resetFake, seed, seedPortalLink } from './_fake-firestore.js';
import { permissionsForRole } from '../src/shared/permissions.js';
import { MAX_REMINDERS, canTransition, isDueForReminder, matchCarrier, matchLabelRoom, matchRecipient, nameWords, phoneTail, type Parcel } from '../src/shared/parcels.js';

const OWNER = 'owner-1';
const BLD = 'bld-A';
const B = `users/${OWNER}/buildings/${BLD}`;
const DAY = 86400_000;

function member(uid: string, role: 'front_desk' | 'technician', property_ids = ['*']) {
    seed(`users/${OWNER}/members/${uid}`, { uid, role, permissions: permissionsForRole(role), property_ids, status: 'active' });
}

beforeEach(() => {
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    aiGenerate.mockReset();
    resetFake();
    addAuthUser(OWNER, 'o@x.com', 'Owner');
    addAuthUser('desk', 'd@x.com', 'Desk');
    addAuthUser('tech', 't@x.com', 'Tech');
    addAuthUser('other-owner', 'oo@x.com');
    seed(`users/${OWNER}`, { uid: OWNER });
    seed(`${B}`, { id: BLD });
    seed(`${B}/data/config`, { bill_customization: { dorm_name: 'Dorm A' } });
    seed(`${B}/rooms/r101`, { room_number: '101', is_active: true });
    seed(`${B}/rooms/r102`, { room_number: '102', is_active: true, line_user_id: 'U' + 'a'.repeat(32) });
    seed(`${B}/rooms/r103`, { room_number: '103', is_active: false });
    seed(`${B}/tenants/r101`, { full_name: 'Somchai' });
    seed(`users/${OWNER}/buildings/bld-B`, { id: 'bld-B' });
    seed(`users/${OWNER}/buildings/bld-B/rooms/rB1`, { room_number: 'B1', is_active: true });
});

async function call(uid: string | undefined, body: Record<string, unknown>) {
    const res = fakeRes();
    await handler(fakeReq({ owner_uid: OWNER, building_id: BLD, ...body }, uid), res as never);
    return res;
}
const create = (uid: string | undefined, over: Record<string, unknown> = {}) =>
    call(uid, { action: 'create', room_id: 'r101', carrier: 'Kerry Express', ...over });

describe('create parcel', () => {
    it('happy path: stores the parcel, notifies in-app, advances to tenant_notified, audits', async () => {
        const res = await create(OWNER, { tracking_number: 'TH123', storage_location: 'Shelf 2', recipient_name: 'S. Somchai' });
        expect(res.statusCode).toBe(200);
        const { parcel, notify } = res.body as { parcel: { id: string; status: string; tenant_id: string; room_number: string }; notify: Record<string, string> };
        expect(parcel.status).toBe('tenant_notified');
        expect(parcel.tenant_id).toBe('r101');
        expect(parcel.room_number).toBe('101');
        expect(notify).toEqual({ line: 'skipped', in_app: 'sent' }); // r101 has no LINE linked
        expect(read(`${B}/parcels/${parcel.id}`)).toMatchObject({ tenant_name: 'Somchai', received_by: OWNER, received_by_name: 'Owner' });
        expect(listPaths(`${B}/notifications/`)).toHaveLength(1);
        expect(listPaths(`users/${OWNER}/audit_logs/`)).toHaveLength(1);
    });

    it('a LINE-linked room without a configured token is reported as skipped, never as sent', async () => {
        const res = await create(OWNER, { room_id: 'r102' });
        expect((res.body as { notify: Record<string, string> }).notify.line).toBe('skipped');
    });

    it('stores the photo in a separate document, not on the parcel', async () => {
        const res = await create(OWNER, { image_base64: 'AAAA' });
        const id = (res.body as { parcel: { id: string } }).parcel.id;
        expect(read(`${B}/parcels/${id}`)?.has_image).toBe(true);
        expect(JSON.stringify(read(`${B}/parcels/${id}`))).not.toContain('AAAA');
        expect(read(`${B}/parcel_images/${id}`)?.data_url).toBe('data:image/jpeg;base64,AAAA');
    });

    it('binds by the chosen room only — a label name never changes the room', async () => {
        // label says "Somchai" (room 101's tenant) but staff picked room 102
        const res = await create(OWNER, { room_id: 'r102', recipient_name: 'Somchai' });
        const p = (res.body as { parcel: { room_id: string; tenant_id: string } }).parcel;
        expect(p.room_id).toBe('r102');
        expect(p.tenant_id).toBe('r102');
    });

    it('401 without a token; 403 for outsiders and for roles without parcel.create', async () => {
        expect((await create(undefined)).statusCode).toBe(401);
        expect((await create('other-owner')).statusCode).toBe(403);
        member('tech', 'technician');
        expect((await create('tech')).statusCode).toBe(403);
    });

    it('front desk may create on a granted property but not on another (cross-property)', async () => {
        member('desk', 'front_desk', [BLD]);
        expect((await create('desk')).statusCode).toBe(200);
        const res = await call('desk', { action: 'create', building_id: 'bld-B', room_id: 'rB1', carrier: 'DHL' });
        expect(res.statusCode).toBe(403);
    });

    it('a room from another property is not found (forged room id)', async () => {
        expect((await create(OWNER, { room_id: 'rB1' })).statusCode).toBe(404);
        expect((await create(OWNER, { room_id: 'nope' })).statusCode).toBe(404);
        expect((await create(OWNER, { room_id: 'r103' })).statusCode).toBe(404); // inactive
    });

    it('saves with nothing filled in: no carrier, no room — nobody is notified until a room is chosen', async () => {
        const res = await call(OWNER, { action: 'create' });
        expect(res.statusCode).toBe(200);
        const p = (res.body as { parcel: Parcel }).parcel;
        expect(p).toMatchObject({ room_id: '', room_number: '', carrier: 'ไม่ระบุ', status: 'received', suggested_room: null });
        expect((res.body as { notify: unknown }).notify).toBeNull();
        expect(listPaths(`${B}/notifications/`)).toHaveLength(0);
        // nothing can be sent for it, nor can it wait for pickup — but it can be handed over
        expect((await call(OWNER, { action: 'renotify', parcel_id: p.id })).body).toMatchObject({ error: 'no_room' });
        expect((await call(OWNER, { action: 'update_status', parcel_id: p.id, status: 'waiting_pickup' })).body).toMatchObject({ error: 'no_room' });
    });

    it('no room but a name: the tenant it fits is suggested; choosing the room then tells the tenant', async () => {
        seed(`${B}/tenants/r102`, { full_name: 'สมศรี ใจดี', phone: '0891231234' });
        const res = await call(OWNER, { action: 'create', recipient_name: 'นางสาว สมศรี ใจดี', carrier: 'Flash Express' });
        const p = (res.body as { parcel: Parcel }).parcel;
        expect(p.room_id).toBe('');
        expect(p.suggested_room).toMatchObject({ room_id: 'r102', room_number: '102', by: 'name' });
        const assigned = await call(OWNER, { action: 'assign_room', parcel_id: p.id, room_id: p.suggested_room!.room_id });
        expect(assigned.statusCode).toBe(200);
        expect(read(`${B}/parcels/${p.id}`)).toMatchObject({ room_id: 'r102', room_number: '102', tenant_name: 'สมศรี ใจดี', suggested_room: null, status: 'tenant_notified' });
        expect(listPaths(`${B}/notifications/`)).toHaveLength(1);
        // a room of another property, or after pickup, is refused
        expect((await call(OWNER, { action: 'assign_room', parcel_id: p.id, room_id: 'rB1' })).statusCode).toBe(404);
        await call(OWNER, { action: 'update_status', parcel_id: p.id, status: 'picked_up' });
        expect((await call(OWNER, { action: 'assign_room', parcel_id: p.id, room_id: 'r101' })).body).toMatchObject({ error: 'already_picked_up' });
        member('tech', 'technician');
        expect((await call('tech', { action: 'assign_room', parcel_id: p.id, room_id: 'r101' })).statusCode).toBe(403);
    });

    it('rejects a property that is not the owner\'s', async () => {
        const res = await call(OWNER, { action: 'create', building_id: 'bld-forged', room_id: 'r101', carrier: 'DHL' });
        expect(res.statusCode).toBe(404);
    });

    it('validates input (400)', async () => {
        expect((await create(OWNER, { carrier: 'x'.repeat(41) })).statusCode).toBe(400);
        expect((await create(OWNER, { tracking_number: 't'.repeat(61) })).statusCode).toBe(400);
        expect((await create(OWNER, { note: 42 })).statusCode).toBe(400);
        expect((await create(OWNER, { room_id: 7 })).statusCode).toBe(400);
        expect((await create(OWNER, { image_base64: '<script>' })).statusCode).toBe(400);
        expect((await create(OWNER, { image_base64: 'A'.repeat(450_001) })).statusCode).toBe(400);
        expect(listPaths(`${B}/parcels/`)).toHaveLength(0);
    });

    it('rejects a duplicate open tracking number, allows it again once picked up', async () => {
        const first = await create(OWNER, { tracking_number: 'TH999' });
        expect((await create(OWNER, { tracking_number: 'TH999' })).statusCode).toBe(409);
        const id = (first.body as { parcel: { id: string } }).parcel.id;
        await call(OWNER, { action: 'update_status', parcel_id: id, status: 'picked_up' });
        expect((await create(OWNER, { tracking_number: 'TH999' })).statusCode).toBe(200);
    });
});

describe('update status', () => {
    async function newParcel() {
        const res = await create(OWNER);
        return (res.body as { parcel: { id: string } }).parcel.id;
    }

    it('walks the workflow and records who handed the parcel over', async () => {
        const id = await newParcel(); // tenant_notified
        expect((await call(OWNER, { action: 'update_status', parcel_id: id, status: 'waiting_pickup' })).statusCode).toBe(200);
        const res = await call(OWNER, { action: 'update_status', parcel_id: id, status: 'picked_up', picked_up_by_name: 'Malee' });
        expect(res.statusCode).toBe(200);
        expect(read(`${B}/parcels/${id}`)).toMatchObject({ status: 'picked_up', picked_up_by: OWNER, picked_up_by_name: 'Malee' });
        expect(read(`${B}/parcels/${id}`)?.picked_up_at).toBeTruthy();
    });

    it('defaults the handover name to the signed-in staff member', async () => {
        const id = await newParcel();
        await call(OWNER, { action: 'update_status', parcel_id: id, status: 'picked_up' });
        expect(read(`${B}/parcels/${id}`)?.picked_up_by_name).toBe('Owner');
    });

    it('cannot move backwards or out of picked_up (409)', async () => {
        const id = await newParcel();
        await call(OWNER, { action: 'update_status', parcel_id: id, status: 'picked_up' });
        expect((await call(OWNER, { action: 'update_status', parcel_id: id, status: 'waiting_pickup' })).statusCode).toBe(409);
        expect((await call(OWNER, { action: 'update_status', parcel_id: id, status: 'received' })).statusCode).toBe(409);
    });

    it('rejects unknown statuses, missing ids and unknown parcels', async () => {
        const id = await newParcel();
        expect((await call(OWNER, { action: 'update_status', parcel_id: id, status: 'lost' })).statusCode).toBe(400);
        expect((await call(OWNER, { action: 'update_status', status: 'picked_up' })).statusCode).toBe(400);
        expect((await call(OWNER, { action: 'update_status', parcel_id: 'ghost', status: 'picked_up' })).statusCode).toBe(404);
    });

    it('requires parcel.update; cross-property members are refused', async () => {
        const id = await newParcel();
        member('tech', 'technician');
        expect((await call('tech', { action: 'update_status', parcel_id: id, status: 'picked_up' })).statusCode).toBe(403);
        member('desk', 'front_desk', ['bld-B']);
        expect((await call('desk', { action: 'update_status', parcel_id: id, status: 'picked_up' })).statusCode).toBe(403);
        expect(read(`${B}/parcels/${id}`)?.status).toBe('tenant_notified');
    });

    it('renotify resends but refuses for picked-up parcels', async () => {
        const id = await newParcel();
        expect((await call(OWNER, { action: 'renotify', parcel_id: id })).statusCode).toBe(200);
        expect(listPaths(`${B}/notifications/`)).toHaveLength(2);
        await call(OWNER, { action: 'update_status', parcel_id: id, status: 'picked_up' });
        expect((await call(OWNER, { action: 'renotify', parcel_id: id })).statusCode).toBe(409);
    });
});

describe('tenant_list (portal view)', () => {
    it('returns only that room\'s parcels with non-sensitive fields', async () => {
        await create(OWNER, { room_id: 'r101', tracking_number: 'SECRET1', recipient_name: 'Label Name', image_base64: 'AAAA', note: 'private' });
        await create(OWNER, { room_id: 'r102', tracking_number: 'OTHER' });
        // the room comes from the link: asking for another room beside it changes nothing
        const res = await call(undefined, { action: 'tenant_list', portal: seedPortalLink(OWNER, BLD, 'r101'), room_id: 'r102' });
        expect(res.statusCode).toBe(200);
        const { parcels } = res.body as { parcels: Record<string, unknown>[] };
        expect(parcels).toHaveLength(1);
        expect(Object.keys(parcels[0]).sort()).toEqual(['carrier', 'id', 'picked_up_at', 'received_at', 'status', 'storage_location']);
        expect(JSON.stringify(res.body)).not.toMatch(/SECRET1|Label Name|AAAA|private|OTHER/);
    });

    it('needs a valid portal link: room ids alone, a wrong secret or a deleted room are refused', async () => {
        const link = seedPortalLink(OWNER, BLD, 'r101');
        expect((await call(undefined, { action: 'tenant_list', room_id: 'r101' })).statusCode).toBe(401);
        expect((await call(undefined, { action: 'tenant_list', portal: link.replace(/~[^~]+$/, '~guess') })).statusCode).toBe(401);
        expect((await call(undefined, { action: 'tenant_list', portal: seedPortalLink(OWNER, BLD, 'ghost') })).statusCode).toBe(401);
    });
});

describe('read_label (shipping-label OCR)', () => {
    const label = (uid: string | undefined, over: Record<string, unknown> = {}) =>
        call(uid, { action: 'read_label', image_base64: 'AAAA', ...over });

    it('returns parsed suggestions and writes nothing', async () => {
        seed(`users/${OWNER}`, { uid: OWNER, license: 'monthly_medium' });
        aiGenerate.mockResolvedValueOnce('```json\n{"carrier":"Flash","tracking_number":"th 0123-4567 89","recipient_name":"สมชาย","room_number":"101","confidence":0.9}\n```');
        const res = await label(OWNER);
        expect(res.statusCode).toBe(200);
        expect((res.body as { data: unknown }).data).toEqual({
            carrier: 'Flash', tracking_number: 'TH0123456789', recipient_name: 'สมชาย', recipient_phone: null, room_number: '101', confidence: 0.9,
        });
        expect(listPaths(`${B}/parcels/`)).toHaveLength(0);
    });

    it('no room on the label: the name finds the tenant; if the name is unclear the AI picks from the tenant list', async () => {
        seed(`users/${OWNER}`, { uid: OWNER, license: 'monthly_medium' });
        seed(`${B}/tenants/r102`, { full_name: 'สมศรี ใจดี', nickname: 'ศรี', phone: '0891231234' });
        aiGenerate.mockResolvedValueOnce('{"carrier":"Kerry","recipient_name":"คุณสมศรี ใจดี","room_number":null,"confidence":0.8}');
        const byName = (await label(OWNER)).body as { match: { room_id: string; by: string } };
        expect(byName.match).toMatchObject({ room_id: 'r102', by: 'name' });
        // an English spelling the name rules cannot match: the AI is asked, and only a room in the list is accepted
        aiGenerate
            .mockResolvedValueOnce('{"recipient_name":"SOMSRI JAIDEE","room_number":null,"confidence":0.8}')
            .mockResolvedValueOnce('{"room_number":"102","confidence":0.9}');
        const byAi = (await label(OWNER)).body as { match: { room_id: string; by: string } };
        expect(byAi.match).toMatchObject({ room_id: 'r102', by: 'ai' });
        const askedWith = String(aiGenerate.mock.calls.at(-1)?.[0]?.prompt);
        expect(askedWith).toContain('102: สมศรี ใจดี');
        expect(askedWith).not.toContain('0891231234');   // names only, never phones
        aiGenerate
            .mockResolvedValueOnce('{"recipient_name":"SOMSRI JAIDEE","confidence":0.8}')
            .mockResolvedValueOnce('{"room_number":"999","confidence":0.99}');
        expect(((await label(OWNER)).body as { match: unknown }).match).toBeNull();
        // the room printed on the label wins
        aiGenerate.mockResolvedValueOnce('{"recipient_name":"สมศรี ใจดี","room_number":"ห้อง 101","confidence":0.8}');
        expect(((await label(OWNER)).body as { match: { room_id: string; by: string } }).match).toMatchObject({ room_id: 'r101', by: 'label_room' });
    });

    it('is Plus/Pro only, needs parcel.create, and validates the image', async () => {
        expect((await label(OWNER)).statusCode).toBe(403); // free plan
        seed(`users/${OWNER}`, { uid: OWNER, license: 'monthly_medium' });
        member('tech', 'technician');
        expect((await label('tech')).statusCode).toBe(403);
        expect((await label(OWNER, { image_base64: '<script>' })).statusCode).toBe(400);
        expect((await label(OWNER, { image_base64: undefined })).statusCode).toBe(400);
        expect(aiGenerate).not.toHaveBeenCalled();
    });

    it('reports AI failures as 502 with a readable message', async () => {
        seed(`users/${OWNER}`, { uid: OWNER, license: 'active' });
        aiGenerate.mockRejectedValueOnce(new AiError('provider_429', 'busy'));
        const res = await label(OWNER);
        expect(res.statusCode).toBe(502);
        expect(res.body).toMatchObject({ error: 'ocr_failed', detail: 'provider_429' });
    });

    it('parser drops junk and non-label replies', () => {
        expect(parseParcelLabel('not json')).toEqual({ carrier: null, tracking_number: null, recipient_name: null, recipient_phone: null, room_number: null, confidence: 0 });
        // the name without a "ผู้รับ:" the model kept; a masked phone kept as printed; a non-phone dropped
        expect(parseParcelLabel('{"recipient_name":"ผู้รับ: นางสาว สมศรี ใจดี","recipient_phone":"08x-xxx-1234"}')).toMatchObject({ recipient_name: 'นางสาว สมศรี ใจดี', recipient_phone: '08xxxx1234' });
        expect(parseParcelLabel('{"recipient_phone":"call me"}').recipient_phone).toBeNull();
        expect(parseParcelLabel('{"tracking_number":"12","room_number":null,"carrier":"null","confidence":7}'))
            .toMatchObject({ tracking_number: null, room_number: null, carrier: null, confidence: 1 });
    });

    it('matches a label name / phone to one tenant — only when one clearly stands out', () => {
        const tenants = [
            { room_id: 'a', room_number: '201', full_name: 'สมชาย ใจดี', nickname: 'ชาย', phone: '0811111111' },
            { room_id: 'b', room_number: '202', full_name: 'สมชาย รักไทย', phone: '0822222222' },
            { room_id: 'c', room_number: '203', full_name: 'Anna Smith', nickname: 'แอน', phone: '0833334444' },
        ];
        expect(matchRecipient('นาย สมชาย ใจดี', null, tenants).match).toMatchObject({ room_id: 'a', by: 'name' });
        expect(matchRecipient('MS. ANNA SMITH', null, tenants).match).toMatchObject({ room_id: 'c' });
        // two "สมชาย": not clear — offered as candidates, never chosen
        const two = matchRecipient('สมชาย', null, tenants);
        expect(two.match).toBeNull();
        expect(two.candidates.map(c => c.room_id).sort()).toEqual(['a', 'b']);
        // ... the phone's last digits settle it, even masked
        expect(matchRecipient('สมชาย', '08x-xxx-2222', tenants).match).toMatchObject({ room_id: 'b' });
        expect(matchRecipient(null, '***4444', tenants).match).toMatchObject({ room_id: 'c', by: 'phone' });
        expect(matchRecipient('ใครก็ไม่รู้', null, tenants).match).toBeNull();
        expect(nameWords('นางสาว  สมศรี  ใจดี')).toEqual(['สมศรี', 'ใจดี']);
        expect(phoneTail('08x-xxx-1234')).toBe('1234');
        expect(phoneTail('xx12')).toBeNull();
    });

    it('matches carriers and rooms from what the label says', () => {
        expect(matchCarrier('KERRY EXPRESS (THAILAND)')).toBe('Kerry Express');
        expect(matchCarrier('SPX Express')).toBe('Shopee Express');
        expect(matchCarrier('J&T')).toBe('J&T Express');
        expect(matchCarrier('ไปรษณีย์ไทย EMS')).toBe('Thailand Post');
        expect(matchCarrier('Unknown Cargo')).toBeNull();
        const rooms = [{ id: 'a', room_number: 'A-2' }, { id: 'b', room_number: '101' }, { id: 'c', room_number: '102', is_active: false }];
        expect(matchLabelRoom('ห้อง A2', rooms)?.id).toBe('a');
        expect(matchLabelRoom('Room 101', rooms)?.id).toBe('b');
        expect(matchLabelRoom('102', rooms)).toBeNull(); // inactive
        expect(matchLabelRoom('999', rooms)).toBeNull();
    });
});

describe('request validation', () => {
    it('requires building_id, a POST, and a known action', async () => {
        const noBld = fakeRes();
        await handler(fakeReq({ action: 'create', owner_uid: OWNER }, OWNER), noBld as never);
        expect(noBld.statusCode).toBe(400);
        const get = fakeRes();
        await handler(fakeReq({}, OWNER, 'GET'), get as never);
        expect(get.statusCode).toBe(405);
        expect((await call(OWNER, { action: 'explode' })).statusCode).toBe(400);
    });
});

describe('workflow + reminders (pure)', () => {
    it('allows forward moves only', () => {
        expect(canTransition('received', 'tenant_notified')).toBe(true);
        expect(canTransition('tenant_notified', 'waiting_pickup')).toBe(true);
        expect(canTransition('waiting_pickup', 'picked_up')).toBe(true);
        expect(canTransition('picked_up', 'received')).toBe(false);
        expect(canTransition('waiting_pickup', 'tenant_notified')).toBe(false);
        expect(canTransition('received', 'received')).toBe(false);
    });

    const base = (over: Partial<Parcel> = {}) => ({
        status: 'tenant_notified' as const, received_at: new Date(Date.now() - 4 * DAY).toISOString(),
        last_reminded_at: null, reminder_count: 0, ...over,
    });

    it('reminds parcels waiting 3+ days, then every 3 days, up to the cap', () => {
        expect(isDueForReminder(base())).toBe(true);
        expect(isDueForReminder(base({ received_at: new Date(Date.now() - 2 * DAY).toISOString() }))).toBe(false);
        expect(isDueForReminder(base({ last_reminded_at: new Date(Date.now() - 1 * DAY).toISOString(), reminder_count: 1 }))).toBe(false);
        expect(isDueForReminder(base({ last_reminded_at: new Date(Date.now() - 4 * DAY).toISOString(), reminder_count: 1 }))).toBe(true);
        expect(isDueForReminder(base({ reminder_count: MAX_REMINDERS }))).toBe(false);
    });

    it('never reminds picked-up or un-notified parcels', () => {
        expect(isDueForReminder(base({ status: 'picked_up' }))).toBe(false);
        expect(isDueForReminder(base({ status: 'received' }))).toBe(false);
        expect(isDueForReminder(base({ received_at: 'garbage' }))).toBe(false);
    });

    it('notification channels follow the room; messages carry the portal link', () => {
        expect(decideChannels({ line_user_id: 'U1' })).toEqual(['in_app', 'line']);
        expect(decideChannels({})).toEqual(['in_app']);
        expect(decideChannels(undefined)).toEqual(['in_app']);
        const m = renderMessage('parcel.received', { room_number: '101', carrier: 'Kerry', storage_location: 'Shelf 2' }, 'Dorm A', 'https://x/?rid=1');
        expect(m.body).toContain('101');
        expect(m.body).toContain('Shelf 2');
        expect(m.body).toContain('https://x/?rid=1');
        expect(renderMessage('parcel.overdue', { room_number: '101', days: 5 }, 'Dorm A', 'u').body).toContain('5 วัน');
    });
});
