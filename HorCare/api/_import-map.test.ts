import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);
const prompts: string[] = [];
let aiAnswer: string | Error = '';
vi.mock('./_ai.js', async () => {
    const real = await vi.importActual<typeof import('./_ai.js')>('./_ai.js');
    return { ...real, aiGenerate: async (r: { prompt: string }) => { prompts.push(r.prompt); if (aiAnswer instanceof Error) throw aiAnswer; return aiAnswer; } };
});

import handler from './_import-map.js';
import { AiError } from './_ai.js';
import { addAuthUser, fakeReq, fakeRes, resetFake, seed } from './_fake-firestore.js';
import { permissionsForRole } from '../src/shared/permissions.js';

const OWNER = 'owner-1';
const headers = ['เลขที่', 'คนเช่า', 'มือถือ', 'ค่าห้อง'];
const samples = [['101', 'สมชาย ใจดี', '081-234-5678', '3500']];

async function call(uid: string, over: object = {}) {
    const res = fakeRes();
    await handler(fakeReq({ owner_uid: OWNER, building_id: 'b1', headers, samples, ...over }, uid), res as never);
    return res as unknown as { statusCode: number; body: Record<string, any> };
}

beforeEach(() => {
    resetFake(); prompts.length = 0;
    addAuthUser(OWNER, 'o@x.com', 'O');
    addAuthUser('tech', 't@x.com', 'T');
    seed(`users/${OWNER}`, { uid: OWNER });
    seed(`users/${OWNER}/buildings/b1`, { id: 'b1' });
    seed(`users/${OWNER}/members/tech`, { uid: 'tech', role: 'technician', permissions: permissionsForRole('technician'), property_ids: ['*'], status: 'active' });
});

describe('/api/import-map', () => {
    it("uses the AI's mapping, and never sends real tenant data to it", async () => {
        aiAnswer = '```json\n{"mapping":["room_number","tenant_name","phone","rent_amount"]}\n```';
        const r = await call(OWNER);
        expect(r.body).toEqual({ mapping: ['room_number', 'tenant_name', 'phone', 'rent_amount'], source: 'ai' });
        expect(prompts[0]).toContain('"คนเช่า"');
        expect(prompts[0]).not.toContain('สมชาย');
        expect(prompts[0]).not.toContain('234');
        expect(prompts[0]).toContain('999-999-9999');
    });

    it('falls back to the header guess when the AI is missing, fails, or answers without a room column', async () => {
        aiAnswer = new AiError('missing_key', 'no key');
        expect((await call(OWNER)).body).toEqual({ mapping: ['room_number', 'tenant_name', 'phone', 'rent_amount'], source: 'guess' });
        aiAnswer = 'not json at all';
        expect((await call(OWNER)).body.source).toBe('guess');
        aiAnswer = '{"mapping":[null,"tenant_name",null,null]}';
        expect((await call(OWNER)).body.source).toBe('guess');
    });

    it('needs room.create and sane input', async () => {
        expect((await call('tech')).statusCode).toBe(403);
        expect((await call(OWNER, { headers: [] })).statusCode).toBe(400);
        expect((await call(OWNER, { headers: [1, 2] })).statusCode).toBe(400);
    });
});
