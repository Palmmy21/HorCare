import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import handler, { parseMeterOcr } from './_meter-ocr.js';
import { addAuthUser, fakeReq, fakeRes, resetFake, seed } from './_fake-firestore.js';
import { permissionsForRole } from '../src/shared/permissions.js';

describe('parseMeterOcr (model output is untrusted)', () => {
    it('parses a good response', () => {
        expect(parseMeterOcr('{"room_number":"305","reading":1285.4,"meter_type":"electric","confidence":0.93,"note":""}'))
            .toEqual({ room_number: '305', reading: 1285, meter_type: 'electric', confidence: 0.93, note: '' });
    });
    it('accepts numeric room numbers and trims', () => {
        expect(parseMeterOcr('{"room_number":305,"reading":1,"meter_type":"water","confidence":1}').room_number).toBe('305');
        expect(parseMeterOcr('{"room_number":"  A-1 ","reading":1,"meter_type":"water","confidence":1}').room_number).toBe('A-1');
    });
    it('turns garbage into a safe empty result instead of throwing', () => {
        for (const raw of ['', 'not json', '[]', 'null', '42', '"x"']) {
            const r = parseMeterOcr(raw);
            expect(r.reading).toBeNull();
            expect(r.room_number).toBeNull();
            expect(r.meter_type).toBe('unknown');
            expect(r.confidence).toBe(0);
        }
    });
    it('rejects bad field values', () => {
        const r = parseMeterOcr('{"room_number":"","reading":-5,"meter_type":"gas","confidence":7}');
        expect(r.room_number).toBeNull();
        expect(r.reading).toBeNull();
        expect(r.meter_type).toBe('unknown');
        expect(r.confidence).toBe(1); // clamped
        expect(parseMeterOcr('{"confidence":-3}').confidence).toBe(0);
        expect(parseMeterOcr('{"reading":"1285"}').reading).toBeNull(); // strings are not numbers
    });
    it('caps oversized text fields', () => {
        const r = parseMeterOcr(JSON.stringify({ room_number: 'x'.repeat(500), note: 'y'.repeat(500) }));
        expect(r.room_number!.length).toBe(20);
        expect(r.note.length).toBe(200);
    });
});

describe('/api/meter-ocr access control', () => {
    const OWNER = 'owner-1';
    beforeEach(() => {
        resetFake();
        addAuthUser(OWNER, 'o@x.com');
        addAuthUser('tech', 't@x.com');
        addAuthUser('desk', 'd@x.com');
        seed(`users/${OWNER}`, { uid: OWNER, license: 'free' });
        seed(`users/${OWNER}/buildings/bld-A`, { id: 'bld-A' });
    });
    const body = { owner_uid: OWNER, building_id: 'bld-A', imageBase64: 'AAAA' };
    async function call(uid: string | undefined, b: Record<string, unknown> = body) {
        const res = fakeRes();
        await handler(fakeReq(b, uid), res as never);
        return res;
    }

    it('401 without a token', async () => expect((await call(undefined)).statusCode).toBe(401));

    it('403 for roles without meter.record, and for outsiders', async () => {
        seed(`users/${OWNER}/members/tech`, { uid: 'tech', role: 'technician', permissions: permissionsForRole('technician'), property_ids: ['*'], status: 'active' });
        // technician has meter.read only
        expect((await call('tech')).statusCode).toBe(403);
        expect((await call('desk')).statusCode).toBe(403);
    });

    it('403 for a member limited to a different property', async () => {
        seed(`users/${OWNER}/members/desk`, { uid: 'desk', role: 'owner' as never, permissions: [], property_ids: ['bld-OTHER'], status: 'active' });
        expect((await call('desk')).statusCode).toBe(403);
    });

    it('404 for a property that does not belong to the owner', async () => {
        const res = await call(OWNER, { ...body, building_id: 'bld-forged' });
        expect(res.statusCode).toBe(404);
    });

    it('403 feature_locked on the free plan, even for the owner', async () => {
        const res = await call(OWNER);
        expect(res.statusCode).toBe(403);
        expect((res.body as { error: string }).error).toBe('feature_locked');
    });

    it('400 for missing or oversized images on a paid plan', async () => {
        seed(`users/${OWNER}`, { uid: OWNER, license: 'monthly_large' });
        expect((await call(OWNER, { ...body, imageBase64: '' })).statusCode).toBe(400);
        expect((await call(OWNER, { ...body, imageBase64: 'A'.repeat(6_000_001) })).statusCode).toBe(400);
        expect((await call(OWNER, { ...body, imageBase64: 42 })).statusCode).toBe(400);
    });
});
