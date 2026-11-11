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

// what the "AI" and the QR reader see is decided by each test
let qrPayload: string | null = 'QR-1';
let evaluation: Record<string, unknown> = {};
vi.mock('./_slip.js', async () => {
    const real = await vi.importActual<typeof import('./_slip.js')>('./_slip.js');
    return { ...real, decodeSlipQR: async () => ({ payload: qrPayload, looksLikeSlip: !!qrPayload }), compressSlipToDataUrl: async () => 'data:image/jpeg;base64,AAAA' };
});
vi.mock('./_slip-flow.js', async () => {
    const real = await vi.importActual<typeof import('./_slip-flow.js')>('./_slip-flow.js');
    return { ...real, evaluateSlip: async () => evaluation };
});

import webhook from './line-webhook.js';
import { listPaths, read, resetFake, seed } from './_fake-firestore.js';

// A market vendor pays the round by slip in LINE (no monthly bill), and a photo with no readable QR can still be a slip.
const OWNER = 'owner-1';
const BLD = 'mkt';
const B = `users/${OWNER}/buildings/${BLD}`;
const SECRET = 'tenant-secret';
const VENDOR = 'U' + 'v'.repeat(32);
const scope = { owner_uid: OWNER, building_id: BLD };
const fetchMock = vi.fn();

const review = { autoApprove: false, outcome: 'review', problems: [], qrPresent: true, bankVerified: false, details: null, verdict: null, fields: {}, verifyNote: 'โปรดตรวจสลิปด้วยตา', aiAmount: 3000, splitAmount: null };
const approved = { ...review, autoApprove: true, outcome: 'approved', fields: { slip_account_id: 'acc1' }, verifyNote: 'ok' };

beforeEach(() => {
    resetFake(); sb.reset(); qrPayload = 'QR-1'; evaluation = review;
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => {
        if (/\/message\/[^/]+\/content$/.test(String(url))) {
            const body = Buffer.alloc(64, 7);
            return { ok: true, status: 200, headers: new Headers({ 'content-type': 'image/jpeg', 'content-length': '64' }), arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + 64) };
        }
        return { ok: true, status: 200, text: async () => '', json: async () => ({}), headers: new Headers() };
    });
    vi.stubGlobal('fetch', fetchMock);
    process.env.LINE_CHANNEL_SECRET = SECRET;
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'tenant-token';
    seed(`users/${OWNER}`, { uid: OWNER, license: 'active' });
    seed(B, { id: BLD });
    seed(`${B}/rooms/a22`, { room_number: 'A22', is_active: true, line_user_id: VENDOR });
    seed(`line_rooms/${VENDOR}`, { uid: OWNER, building_id: BLD, room_id: 'a22', room_number: 'A22' });
    seed(`${B}/bank_accounts/acc1`, { id: 'acc1', status: 'active' });
    sb.seed('charges', { id: 'c-month', ...scope, kind: 'stall_month', room_id: 'a22', room_number: 'A22', party_name: 'แผง A22', period_start: '2026-11-01', period_end: '2026-11-30', description: 'ค่าเช่าแผง A22 เดือน 2026-11', amount_satang: 300000, paid_satang: 0, status: 'open', dedupe_key: 'stall-month:a22:2026-11', created_by: 'x', created_at: new Date().toISOString() });
});
afterEach(() => { vi.unstubAllGlobals(); delete process.env.LINE_CHANNEL_SECRET; delete process.env.LINE_CHANNEL_ACCESS_TOKEN; });

async function post(event: Record<string, unknown>) {
    const raw = Buffer.from(JSON.stringify({ events: [{ replyToken: 'rt', source: { userId: VENDOR }, ...event }] }));
    const req = Readable.from([raw]) as never as { method: string; headers: object };
    req.method = 'POST';
    req.headers = { 'x-line-signature': createHmac('sha256', SECRET).update(raw).digest('base64') };
    const res = { statusCode: 0, status(c: number) { this.statusCode = c; return this; }, send() { return this; }, json() { return this; } };
    fetchMock.mockClear();
    await webhook(req as never, res as never);
    expect(res.statusCode).toBe(200);
}
const photo = (id = '600000000001') => post({ type: 'message', message: { type: 'image', id } });
const reply = () => {
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/v2/bot/message/reply'));
    return call ? (JSON.parse(call[1].body) as { messages: { text: string; quickReply?: { items: { action: { data?: string } }[] } }[] }).messages[0] : null;
};

describe('a slip for the round, sent in LINE', () => {
    it('a vendor with no monthly bill pays the stall: an approved slip is recorded on the open charge', async () => {
        evaluation = approved;
        await photo();
        expect(reply()!.text).toContain('ได้รับยอด ฿3,000');
        expect(sb.rows('charges')[0]).toMatchObject({ paid_satang: 300000, status: 'paid' });
        expect(sb.rows('charge_payments')[0]).toMatchObject({ method: 'transfer', bank_account_id: 'acc1', received_by_name: 'สลิปทาง LINE', slip_ref: expect.any(String) });
    });

    it('a slip the AI cannot approve is kept for staff to confirm, nothing is recorded, and the same slip cannot pay twice', async () => {
        await photo();
        expect(reply()!.text).toContain('เจ้าหน้าที่จะตรวจและยืนยัน');
        expect(sb.rows('charge_payments')).toHaveLength(0);
        expect(listPaths(`${B}/slip_images/round-c-month-`)).toHaveLength(1);

        evaluation = approved;
        await photo('600000000002');
        sb.seed('charges', { id: 'c-day', ...scope, kind: 'stall_day', room_id: 'a22', room_number: 'A22', party_name: 'แผง A22', period_start: '2026-11-12', period_end: '2026-11-12', description: 'ค่าแผงรายวัน', amount_satang: 5000, paid_satang: 0, status: 'open', dedupe_key: 'stall-day:a22:2026-11-12', created_by: 'x', created_at: new Date().toISOString() });
        await photo('600000000003');   // the same slip (same QR) again, for the next charge
        expect(reply()!.text).toContain('ถูกใช้ไปแล้ว');
    });

    it('a photo with no readable QR, while money is owed, gets a "this is a slip" button that sends it through the check', async () => {
        qrPayload = null;
        await photo('600000000009');
        const r = reply()!;
        expect(r.text).toContain('นี่คือสลิป');
        const data = r.quickReply!.items[0].action.data!;
        expect(data).toBe('slipimg|600000000009');
        evaluation = approved;
        await post({ type: 'postback', postback: { data } });
        expect(reply()!.text).toContain('ได้รับยอด');
        // the photo and both bot answers are in the inbox
        const msgs = listPaths(`${B}/line_threads/${VENDOR}/messages/`).filter(p => !p.includes('/chunks/')).map(p => read(p) as { direction: string });
        expect(msgs.filter(m => m.direction === 'in').length).toBeGreaterThanOrEqual(1);
        expect(msgs.filter(m => m.direction === 'out').length).toBeGreaterThanOrEqual(2);
    });
});
