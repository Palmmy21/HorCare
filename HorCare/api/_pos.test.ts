import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import { FakeSupabase } from './_fake-supabase.js';
const sb = new FakeSupabase();
vi.mock('./_supabase.js', async () => {
    const real = await vi.importActual<typeof import('./_supabase.js')>('./_supabase.js');
    return { ...real, supabase: () => sb };
});

import handler, { posPlaces } from './_pos.js';
import webhook from './line-pos-webhook.js';
import { addAuthUser, fakeReq, fakeRes, read, resetFake, seed } from './_fake-firestore.js';
import { permissionsForRole } from '../src/shared/permissions.js';
import { parsePosCommand, canUsePos } from '../src/shared/posCare.js';
import { todayTh } from '../src/shared/market.js';

const OWNER = 'owner-1';
const MKT = 'mkt';
const RESORT = 'resort';
const SECRET = 'pos-secret';
const LINE = 'U' + 'p'.repeat(32);
const scope = { owner_uid: OWNER, building_id: MKT };
const fetchMock = vi.fn();

beforeEach(() => {
    resetFake();
    sb.reset();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '', json: async () => ({}), headers: new Headers() });
    vi.stubGlobal('fetch', fetchMock);
    process.env.LINE_POS_CHANNEL_SECRET = SECRET;
    process.env.LINE_POS_CHANNEL_ACCESS_TOKEN = 'pos-token';
    for (const uid of [OWNER, 'collector', 'acct', 'deskb']) addAuthUser(uid, `${uid}@x.com`, uid === 'collector' ? 'สมชาย' : uid);
    seed(`users/${OWNER}`, { uid: OWNER });
    seed(`users/${OWNER}/buildings/${MKT}`, { id: MKT });
    seed(`users/${OWNER}/buildings/${MKT}/data/config`, { building_type: 'market', bill_customization: { dorm_name: 'ตลาดเช้า' } });
    seed(`users/${OWNER}/buildings/${RESORT}`, { id: RESORT });
    seed(`users/${OWNER}/buildings/${RESORT}/data/config`, { building_type: 'resort', bill_customization: { dorm_name: 'รีสอร์ทริมน้ำ' } });
    seed(`users/${OWNER}/members/collector`, { uid: 'collector', role: 'market_admin', permissions: permissionsForRole('market_admin'), property_ids: [MKT], status: 'active' });
    seed(`users/${OWNER}/members/acct`, { uid: 'acct', role: 'finance', permissions: permissionsForRole('finance'), property_ids: ['*'], status: 'active' });
    seed(`users/${OWNER}/members/deskb`, { uid: 'deskb', role: 'front_desk', permissions: permissionsForRole('front_desk'), property_ids: [RESORT], status: 'active' });
});
afterEach(() => { vi.unstubAllGlobals(); delete process.env.LINE_POS_CHANNEL_SECRET; delete process.env.LINE_POS_CHANNEL_ACCESS_TOKEN; });

async function api(uid: string | null, body: object) {
    const res = fakeRes();
    await handler(fakeReq({ owner_uid: OWNER, ...body }, uid ?? undefined) as never, res as never);
    return res as unknown as { statusCode: number; body: Record<string, any> };
}
async function chat(text: string) {
    const raw = Buffer.from(JSON.stringify({ events: [{ type: 'message', replyToken: 'rt', source: { userId: LINE }, message: { type: 'text', text } }] }));
    const req = Readable.from([raw]) as never as { method: string; headers: object };
    req.method = 'POST';
    req.headers = { 'x-line-signature': createHmac('sha256', SECRET).update(raw).digest('base64') };
    const res = fakeRes();
    fetchMock.mockClear();
    await webhook(req as never, res as never);
    expect(res.statusCode).toBe(200);
    const call = fetchMock.mock.calls.find(c => String(c[0]).endsWith('/message/reply'));
    return call ? (JSON.parse((call as unknown as [string, { body: string }])[1].body).messages[0] as { type: string; text?: string; contents?: any }) : null;
}
const link = async (uid: string) => {
    const { code } = (await api(uid, { action: 'link_code' })).body;
    return chat(code);
};

describe('who may use POS Care', () => {
    it('the owner everywhere; a collector and a front desk where they work; accounting nowhere', async () => {
        expect((await posPlaces(OWNER, OWNER)).map(p => p.building_id).sort()).toEqual([MKT, RESORT]);
        expect((await posPlaces('collector', OWNER)).map(p => [p.building_id, p.style, p.can_close])).toEqual([[MKT, 'stall', false]]);   // closing the day needs collections.close
        expect((await posPlaces('deskb', OWNER)).map(p => [p.building_id, p.style])).toEqual([[RESORT, 'nightly']]);
        expect(await posPlaces('acct', OWNER)).toEqual([]);
        expect(canUsePos(permissionsForRole('technician'))).toBe(false);
    });

    it('accounting cannot even make a link code', async () => {
        expect((await api('acct', { action: 'link_code' })).statusCode).toBe(403);
    });

    it('reads the buttons and a few everyday words', () => {
        expect(parsePosCommand('เปิด POS Care')).toBe('open');
        expect(parsePosCommand('ยอดวันนี้')).toBe('today');
        expect(parsePosCommand('ร้านหยุดวันนี้')).toBe('closed_today');
        expect(parsePosCommand('ปิดยอด')).toBe('close_day');
        expect(parsePosCommand('สวัสดี')).toBeNull();
    });
});

describe('linking LINE and opening POS Care', () => {
    it('before linking, every button explains how to link', async () => {
        expect((await chat('เปิด POS Care'))!.text).toContain('HCP-');
    });

    it('a code links once; the open button gives a one-time sign-in link that becomes a sign-in as that account', async () => {
        expect((await link('collector'))!.text).toContain('เชื่อม LINE กับ POS Care แล้ว');
        expect(read(`pos_line/${LINE}`)).toMatchObject({ account_uid: 'collector', owner_uid: OWNER });
        expect((await api('collector', { action: 'status' })).body).toEqual({ linked: true, can_use: true });

        const card = await chat('เปิด POS Care');
        expect(card!.type).toBe('flex');
        const url = card!.contents.footer.contents[0].action.uri as string;
        expect(url).toMatch(/\/\?pos=[A-Za-z0-9_-]{30,}$/);
        const token = new URL(url).searchParams.get('pos')!;

        const first = await api(null, { action: 'redeem', token });
        expect(first.statusCode).toBe(200);
        expect(JSON.parse(first.body.token).uid).toBe('collector');
        expect(first.body.owner_uid).toBe(OWNER);
        expect((await api(null, { action: 'redeem', token })).statusCode).toBe(401);            // single use
        expect((await api(null, { action: 'redeem', token: 'x'.repeat(30) })).statusCode).toBe(401);
    });

    it('a used or unknown code is refused', async () => {
        const { code } = (await api('collector', { action: 'link_code' })).body;
        await chat(code);
        expect((await chat(code))!.text).toContain('ถูกใช้ไปแล้ว');
        expect((await chat('HCP-AAAAAAAA'))!.text).toContain('ไม่พบรหัส');
    });

    it('"ปิดยอด" opens the page on the day close', async () => {
        await link('collector');
        const url = (await chat('ปิดยอด'))!.contents.footer.contents[0].action.uri as string;
        expect(url).toMatch(/&go=close$/);
    });

    it('switching the member off ends it: no sign-in, and the binding is dropped', async () => {
        await link('collector');
        const url = (await chat('เปิด POS Care'))!.contents.footer.contents[0].action.uri as string;
        seed(`users/${OWNER}/members/collector`, { uid: 'collector', role: 'market_admin', property_ids: [MKT], status: 'disabled' });
        expect((await api(null, { action: 'redeem', token: new URL(url).searchParams.get('pos') })).statusCode).toBe(403);
        expect((await chat('ยอดวันนี้'))!.text).toContain('HCP-');
        expect(read(`pos_line/${LINE}`)).toBeUndefined();
    });

    it('places gives the properties and the accounts money is received into', async () => {
        seed(`users/${OWNER}/buildings/${MKT}/bank_accounts/k1`, { id: 'k1', status: 'active', bank_code: 'KBANK', account_name: 'ตลาด', account_number: '1234567890' });
        seed(`users/${OWNER}/buildings/${MKT}/bank_accounts/k2`, { id: 'k2', status: 'inactive' });
        const r = await api('collector', { action: 'places' });
        expect(r.body.places).toHaveLength(1);
        expect(r.body.accounts[MKT].map((a: { id: string }) => a.id)).toEqual(['k1']);
        expect((await api('acct', { action: 'places' })).statusCode).toBe(403);
    });
});

describe('the day in LINE', () => {
    it('"ยอดวันนี้" adds up today\'s cash and transfers and what is still due on the round', async () => {
        await link('collector');
        const today = todayTh();
        seed(`users/${OWNER}/buildings/${MKT}/rooms/s1`, { room_number: 'A1', is_active: true });
        seed(`users/${OWNER}/buildings/${MKT}/rooms/s2`, { room_number: 'A2', is_active: true });
        for (const id of ['s1', 's2']) sb.seed('stall_plans', { id: `p-${id}`, ...scope, room_id: id, room_number: id, mode: 'daily_actual', unit: 'day', rate_satang: 5000, open_days: [0, 1, 2, 3, 4, 5, 6], starts_on: '2026-01-01', ends_on: null, status: 'active' });
        sb.seed('charges', { id: 'c1', ...scope, kind: 'stall_day', room_id: 's1', room_number: 'A1', party_name: 'A1', period_start: today, period_end: today, description: '', amount_satang: 5000, paid_satang: 5000, status: 'paid', dedupe_key: `stall-day:s1:${today}`, created_by: 'collector' });
        sb.seed('charge_payments', { id: 'pay1', ...scope, charge_id: 'c1', amount_satang: 5000, method: 'cash', kind: 'payment', received_by: 'collector', received_by_name: 'สมชาย', received_at: new Date().toISOString() });
        const text = (await chat('ยอดวันนี้'))!.text!;
        expect(text).toContain('ตลาดเช้า');
        expect(text).toContain('เก็บได้ ฿50');
        expect(text).toContain('ยังค้างเก็บ 1 แผง ฿50');
        expect(text).toContain('ยังไม่ได้ปิดยอด');
    });

    it('"ร้านหยุดวันนี้" lists stall notices and market shutdowns', async () => {
        await link('collector');
        const today = todayTh();
        seed(`users/${OWNER}/buildings/${MKT}/shop_closures/c1`, { id: 'c1', room_id: 's1', room_number: 'A1', from_date: today, to_date: today, reason: 'sick', status: 'active' });
        seed(`users/${OWNER}/buildings/${MKT}/market_closures/m1`, { id: 'm1', from_date: today, to_date: today, zones: ['โซน B'], reason: 'power', note: 'หม้อแปลงเสีย', status: 'active' });
        const text = (await chat('ร้านหยุดวันนี้'))!.text!;
        expect(text).toContain('แจ้งหยุด 1 แผง: A1');
        expect(text).toContain('ตลาดหยุด (โซน B)');
    });
});
