import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import webhook from './line-webhook.js';
import market from './_market.js';
import { addAuthUser, fakeReq, fakeRes, listPaths, read, resetFake, seed } from './_fake-firestore.js';
import { addDays, todayTh } from '../src/shared/market.js';

// A market vendor on the HorCare Markets OA says the stall is closed; the market records a shutdown and tells vendors.
const OWNER = 'owner-1';
const BLD = 'mkt';
const B = `users/${OWNER}/buildings/${BLD}`;
const SECRET = 'tenant-secret';
const VENDOR = 'U' + 'v'.repeat(32);
const fetchMock = vi.fn();

beforeEach(() => {
    resetFake();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '', json: async () => ({}), headers: new Headers() });
    vi.stubGlobal('fetch', fetchMock);
    process.env.LINE_CHANNEL_SECRET = SECRET;
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'tenant-token';
    process.env.LINE_MARKET_CHANNEL_ACCESS_TOKEN = 'market-token';
    addAuthUser(OWNER, 'o@x.com', 'Owner');
    seed(`users/${OWNER}`, { uid: OWNER });
    seed(B, { id: BLD });
    seed(`${B}/data/config`, { building_type: 'market', bill_customization: { dorm_name: 'ตลาดเช้า' } });
    seed(`${B}/rooms/s1`, { room_number: 'A1', zone: 'โซน A', is_active: true, line_user_id: VENDOR, line_channel: 'market' });
    seed(`${B}/rooms/s2`, { room_number: 'B1', zone: 'โซน B', is_active: true, line_user_id: 'U' + 'w'.repeat(32), line_channel: 'market' });
    seed(`line_rooms/${VENDOR}`, { uid: OWNER, building_id: BLD, room_id: 's1', room_number: 'A1' });
});
afterEach(() => { vi.unstubAllGlobals(); for (const k of ['LINE_CHANNEL_SECRET', 'LINE_CHANNEL_ACCESS_TOKEN', 'LINE_MARKET_CHANNEL_ACCESS_TOKEN']) delete process.env[k]; });

async function send(ev: object) {
    const raw = Buffer.from(JSON.stringify({ events: [{ replyToken: 'rt', source: { userId: VENDOR }, ...ev }] }));
    const req = Readable.from([raw]) as never as { method: string; headers: object };
    req.method = 'POST';
    req.headers = { 'x-line-signature': createHmac('sha256', SECRET).update(raw).digest('base64') };
    const res = fakeRes();
    fetchMock.mockClear();
    await webhook(req as never, res as never);
    const call = fetchMock.mock.calls.find(c => String(c[0]).endsWith('/message/reply'));
    return call ? (JSON.parse((call as unknown as [string, { body: string }])[1].body).messages[0] as { text: string; quickReply?: { items: { action: { type: string; data?: string; label: string } }[] } }) : null;
}
const text = (t: string) => send({ type: 'message', message: { type: 'text', text: t } });
const tap = (data: string, date?: string) => send({ type: 'postback', postback: { data, ...(date ? { params: { date } } : {}) } });
const closures = () => listPaths(`${B}/shop_closures/`).map(p => read(p)!);

describe('a vendor says the stall is closed, from the chat', () => {
    it('three taps: แจ้งหยุด → a day → a reason; the market has it at once', async () => {
        const ask = await text('แจ้งหยุด');
        expect(ask!.text).toContain('แผง A1 หยุดวันไหน');
        const actions = ask!.quickReply!.items.map(i => i.action);
        expect(actions.map(a => a.label)).toEqual(['วันนี้', 'พรุ่งนี้', 'เลือกวันอื่น', 'หยุดหลายวัน', 'ยกเลิก']);
        expect(actions[2].type).toBe('datetimepicker');
        expect(actions[3].type).toBe('datetimepicker');

        const reason = await tap(actions[1].data!);
        expect(reason!.text).toContain('เพราะอะไร');
        const sick = reason!.quickReply!.items.find(i => i.action.label === 'ป่วย')!.action.data!;
        const done = await tap(sick);
        expect(done!.text).toContain('บันทึกแล้ว: แผง A1');
        expect(closures()).toHaveLength(1);
        expect(closures()[0]).toMatchObject({ room_id: 's1', room_number: 'A1', from_date: addDays(todayTh(), 1), reason: 'sick', status: 'active' });
        expect(listPaths(`${B}/notifications/`)).toHaveLength(1);
        // and the people who run the market are actually told: an alert in the owner's inbox (bell + phone)
        const inbox = listPaths(`users/${OWNER}/inbox/`).map(p => read(p)!);
        expect(inbox).toHaveLength(1);
        expect(inbox[0]).toMatchObject({ type: 'shop_closure', title: 'ร้านค้าแจ้งหยุด', building_id: BLD });
        expect(String(inbox[0].body)).toContain('แผง A1');

        expect((await tap(sick))!.text).toContain('แจ้งหยุด');      // the same day twice
        expect(closures()).toHaveLength(1);
    });

    it('a day from the date picker', async () => {
        const day = addDays(todayTh(), 10);
        const reason = await tap('shopclose|s1|pick', day);
        await tap(reason!.quickReply!.items[0].action.data!);
        expect(closures()[0].from_date).toBe(day);
    });

    it('a long closure: first day, last day from the calendar, a reason — one record for the whole span', async () => {
        const from = addDays(todayTh(), 5);
        const to = addDays(todayTh(), 18);
        const ask = await tap('shopclose_range|s1|from', from);
        expect(ask!.text).toContain('หยุดถึงวันไหน');
        const picker = ask!.quickReply!.items[0].action as { type: string; data?: string; min?: string; max?: string };
        expect(picker).toMatchObject({ type: 'datetimepicker', min: from, max: addDays(from, 59) });
        expect(ask!.quickReply!.items.map(i => i.action.label)).toEqual(['เลือกวันสุดท้าย', '1 สัปดาห์', '2 สัปดาห์', '1 เดือน', 'ยกเลิก']);
        const reason = await tap(picker.data!, to);
        expect(reason!.text).toContain('14 วัน');
        const saved = await tap(reason!.quickReply!.items[2].action.data!);   // หยุดพักผ่อน
        expect(saved!.text).toContain('14 วัน');
        expect(closures()).toHaveLength(1);
        expect(closures()[0]).toMatchObject({ room_id: 's1', from_date: from, to_date: to, reason: 'holiday', status: 'active' });
        // the market is told the whole span
        expect(JSON.stringify(listPaths(`${B}/notifications/`).map(p => read(p)))).toContain(to);
        // listed with its span; a second request overlapping it is refused and points to the existing one
        expect((await text('วันหยุดที่แจ้ง'))!.text).toContain('14 วัน');
        const again = await tap(`shopclose_range|s1|${addDays(from, 3)}|${addDays(from, 9)}`);
        expect((await tap(again!.quickReply!.items[0].action.data!))!.text).toContain('ทับกับช่วงที่เลือก');
        expect(closures()).toHaveLength(1);
    });

    it('a preset (1 week) needs no calendar; a last day before the first, or over 60 days, is refused', async () => {
        const from = addDays(todayTh(), 1);
        const ask = await tap('shopclose_range|s1|from', from);
        const week = await tap(ask!.quickReply!.items[1].action.data!);
        expect(week!.text).toContain('7 วัน');
        expect((await tap(`shopclose_range|s1|${from}|pick`, addDays(from, -1)))!.text).toContain('ต้องไม่ก่อนวันเริ่ม');
        expect((await tap(`shopclose_range|s1|${from}|${addDays(from, 60)}`))!.text).toContain('ไม่เกิน 60 วัน');
        // a crafted save past the limit is refused by the same rule as the portal
        expect((await tap(`shopclose_save|s1|${from}|sick|${addDays(from, 61)}`))!.text).toContain('แจ้งไม่ได้');
        expect((await tap(`shopclose_range|s1|${addDays(todayTh(), -2)}|${from}`))!.text).toContain('หยุดวันไหน');   // a past first day: start again
        expect(closures()).toEqual([]);
    });

    it('lists what is coming and cancels it', async () => {
        seed(`${B}/shop_closures/c1`, { id: 'c1', room_id: 's1', room_number: 'A1', from_date: addDays(todayTh(), 3), to_date: addDays(todayTh(), 3), reason: 'holiday', status: 'active' });
        const list = await text('วันหยุดที่แจ้ง');
        expect(list!.text).toContain('แผง A1');
        expect((await tap(list!.quickReply!.items[0].action.data!))!.text).toContain('ยกเลิกการแจ้งหยุด');
        expect(read(`${B}/shop_closures/c1`)?.status).toBe('cancelled');
    });

    it('cannot speak for a stall that is not theirs, nor for a past day, nor at a non-market property', async () => {
        expect((await tap('shopclose_save|s2|' + addDays(todayTh(), 1) + '|sick'))!.text).toContain('ไม่พบแผงนี้');
        expect((await tap('shopclose_save|s1|' + addDays(todayTh(), -1) + '|sick'))!.text).toContain('แจ้งไม่ได้');
        expect((await tap('shopclose_cancel|nope'))!.text).toContain('ไม่พบ');
        seed(`${B}/data/config`, { building_type: 'dormitory' });
        expect((await text('แจ้งหยุด'))!.text).toContain('แผงในตลาด');
        expect(closures()).toEqual([]);
    });
});

describe('the market shuts and tells its vendors', () => {
    it('only the vendors of the zones that shut, through the OA they registered with', async () => {
        const res = fakeRes();
        await market(fakeReq({ action: 'market_closure_add', owner_uid: OWNER, building_id: BLD, from_date: todayTh(), to_date: todayTh(), zones: ['โซน A'], reason: 'power', note: 'ไฟกลับ 16:00', notify_line: true }, OWNER) as never, res as never);
        expect(res.statusCode).toBe(200);
        expect((res.body as { line_sent: number }).line_sent).toBe(1);
        const push = fetchMock.mock.calls.filter(c => String(c[0]).endsWith('/message/push'));
        expect(push).toHaveLength(1);
        const sent = JSON.parse((push[0] as unknown as [string, { body: string; headers: Record<string, string> }])[1].body);
        expect(sent.to).toBe(VENDOR);
        expect(sent.messages[0].text).toContain('ตลาดหยุด (โซน A)');
        expect(sent.messages[0].text).toContain('ไฟดับ');
        expect((push[0] as unknown as [string, { headers: Record<string, string> }])[1].headers.Authorization).toBe('Bearer market-token');
    });
});
