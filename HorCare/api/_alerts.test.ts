import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import handler, { pushToLineStaff, raiseAlert } from './_alerts.js';
import { monthlySummaryText, previousMonth, sendMonthlySummaries } from './_monthly-summary.js';
import { addAuthUser, fakeReq, fakeRes, listPaths, read, resetFake, seed } from './_fake-firestore.js';
import { permissionsForRole } from '../src/shared/permissions.js';
import { ALERT_TYPES, alertTypesFor, canReceiveAlert, cleanAlertPrefs, wantsAlert, wantsPush } from '../src/shared/alerts.js';

const OWNER = 'owner-1';
const BLD = 'bld-A';
const OTHER_BLD = 'bld-B';
const B = `users/${OWNER}/buildings/${BLD}`;
const member = (uid: string, role: string, property_ids = ['*'], status = 'active') =>
    seed(`users/${OWNER}/members/${uid}`, { uid, role, permissions: permissionsForRole(role as never), property_ids, status });
const inboxOf = (uid: string) => listPaths(`users/${uid}/inbox/`).map(p => read(p)!);

beforeEach(() => {
    resetFake();
    for (const uid of [OWNER, 'mgr', 'acct', 'desk', 'tech', 'maid', 'off', 'elsewhere', 'stranger']) addAuthUser(uid, `${uid}@x.com`, uid);
    seed(`users/${OWNER}`, { uid: OWNER });
    seed(B, { id: BLD });
    seed(`users/${OWNER}/buildings/${OTHER_BLD}`, { id: OTHER_BLD });
    seed(`${B}/data/config`, { bill_customization: { dorm_name: 'Dorm A' } });
    member('mgr', 'property_manager');
    member('acct', 'finance');
    member('desk', 'front_desk');
    member('tech', 'technician');
    member('maid', 'housekeeping');
    member('off', 'property_manager', ['*'], 'disabled');
    member('elsewhere', 'property_manager', [OTHER_BLD]);
});

const raise = (type: (typeof ALERT_TYPES)[number], extra: object = {}) =>
    raiseAlert({ ownerUid: OWNER, buildingId: BLD, type, title: 'หัวข้อ', body: 'รายละเอียด', ...extra });
const who = () => ['mgr', 'acct', 'desk', 'tech', 'maid', 'off', 'elsewhere', OWNER].filter(u => inboxOf(u).length > 0).sort();

describe('who hears about what', () => {
    it('money goes to the owner, managers, accounting and the front desk — not to technicians or housekeepers', async () => {
        await raise('payment');
        expect(who()).toEqual(['acct', 'desk', 'mgr', OWNER].sort());
    });

    it('the monthly figures go only to those who may see finances', async () => {
        await raise('monthly_summary');
        expect(who()).toEqual(['acct', 'mgr', OWNER].sort());
    });

    it('repairs and job status reach everyone who works with jobs, including technician and housekeeping accounts', async () => {
        await raise('maintenance');
        expect(who()).toEqual(['desk', 'maid', 'mgr', 'tech', OWNER].sort());
    });

    it('tenant chat reaches those who can read messages', async () => {
        await raise('chat');
        expect(who()).toEqual(['desk', 'mgr', OWNER].sort());
    });

    it('a disabled account and one that works at another property hear nothing', async () => {
        for (const t of ALERT_TYPES) await raise(t);
        expect(inboxOf('off')).toEqual([]);
        expect(inboxOf('elsewhere')).toEqual([]);
    });

    it('the person who caused it is not told', async () => {
        await raise('stock', { exceptUid: 'mgr' });
        expect(who()).toEqual([OWNER]);
    });

    it('writes a complete inbox entry that points at the right screen', async () => {
        await raise('staff_link', { title: 'มาลี ขอลงทะเบียน', kind: 'x' });
        expect(inboxOf(OWNER)[0]).toMatchObject({
            type: 'staff_link', title: 'มาลี ขอลงทะเบียน', body: 'รายละเอียด', url: '/?view=operations&tab=team',
            owner_uid: OWNER, building_id: BLD, kind: 'x',
        });
    });
});

describe('each person\'s own switches', () => {
    it('a kind switched off is not sent to that person, and still reaches the others', async () => {
        seed(`users/acct/data/alert_prefs`, { payment: false });
        await raise('payment');
        expect(inboxOf('acct')).toEqual([]);
        expect(inboxOf('mgr')).toHaveLength(1);
        await raise('monthly_summary');
        expect(inboxOf('acct')).toHaveLength(1);
    });

    it('are saved and read back per account, keeping only real switches', async () => {
        const call = async (uid: string | null, body: object) => {
            const res = fakeRes();
            await handler(fakeReq(body, uid ?? undefined) as never, res as never);
            return res as unknown as { statusCode: number; body: Record<string, any> };
        };
        expect((await call(null, { action: 'prefs_get' })).statusCode).toBe(401);
        expect((await call('acct', { action: 'prefs_get' })).body.prefs).toEqual({});
        const saved = await call('acct', { action: 'prefs_set', prefs: { chat: false, push: false, payment: 'no', admin: true } });
        expect(saved.body.prefs).toEqual({ chat: false, push: false });
        expect((await call('acct', { action: 'prefs_get' })).body.prefs).toEqual({ chat: false, push: false });
        expect((await call('mgr', { action: 'prefs_get' })).body.prefs).toEqual({});
    });

    it('everything is on until switched off; only known keys count', () => {
        expect(wantsAlert({}, 'chat')).toBe(true);
        expect(wantsAlert({ chat: false }, 'chat')).toBe(false);
        expect(wantsPush(undefined)).toBe(true);
        expect(wantsPush({ push: false })).toBe(false);
        expect(cleanAlertPrefs('x')).toEqual({});
        // finance reads leasing (deposits): told about bookings too
        expect(alertTypesFor(permissionsForRole('finance'))).toEqual(['booking', 'payment', 'monthly_summary']);
        expect(alertTypesFor(null)).toEqual([...ALERT_TYPES]);
        expect(canReceiveAlert('stock', permissionsForRole('front_desk'))).toBe(false);
    });
});

describe('/api/alerts', () => {
    const call = async (uid: string, body: object) => {
        const res = fakeRes();
        await handler(fakeReq(body, uid) as never, res as never);
        return res as unknown as { statusCode: number; body: Record<string, any> };
    };
    const stock = { action: 'raise', owner_uid: OWNER, building_id: BLD, type: 'stock', title: 'ปรับสต๊อก: หลอดไฟ', body: '10 → 8 ชิ้น' };

    it('a device registers for push under the caller\'s own account', async () => {
        expect((await call('acct', { action: 'token_save', token: 'x'.repeat(160), ua: 'Phone' })).statusCode).toBe(200);
        const tokens = Object.values(read('users/acct/data/fcm')!.tokens as Record<string, { token: string; ua: string }>);
        expect(tokens).toHaveLength(1);
        expect(tokens[0]).toMatchObject({ token: 'x'.repeat(160), ua: 'Phone' });
        expect((await call('acct', { action: 'token_save', token: 'short' })).statusCode).toBe(400);
        expect(read(`users/${OWNER}/data/fcm`)).toBeUndefined();
    });

    it('a manager adjusting stock tells the owner, not themselves', async () => {
        expect((await call('mgr', stock)).body).toMatchObject({ recipients: 1 });
        expect(inboxOf(OWNER)[0]).toMatchObject({ type: 'stock', title: 'ปรับสต๊อก: หลอดไฟ' });
        expect(inboxOf('mgr')).toEqual([]);
    });

    it('refuses someone who may not do that there, a stranger, kinds only the server raises, and unknown properties', async () => {
        expect((await call('acct', stock)).statusCode).toBe(403);
        expect((await call('stranger', stock)).statusCode).toBe(403);
        expect((await call('elsewhere', stock)).statusCode).toBe(403);
        expect((await call('mgr', { ...stock, type: 'payment' })).statusCode).toBe(400);
        expect((await call('mgr', { ...stock, title: '   ' })).statusCode).toBe(400);
        expect((await call(OWNER, { ...stock, building_id: 'nope' })).statusCode).toBe(404);
        expect(inboxOf(OWNER)).toEqual([]);
    });
});

describe('the team LINE OA', () => {
    it('reaches every linked, active person of that job — and nobody else', async () => {
        const fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => '', headers: new Headers() }));
        vi.stubGlobal('fetch', fetchMock);
        process.env.LINE_STAFF_CHANNEL_ACCESS_TOKEN = 'staff-token';
        seed(`${B}/staff/h1`, { id: 'h1', name: 'มาลี', role: 'housekeeping', active: true, line_user_id: 'U' + '1'.repeat(32) });
        seed(`${B}/staff/h2`, { id: 'h2', name: 'ศรี', role: 'housekeeping', active: true, line_user_id: null });
        seed(`${B}/staff/h3`, { id: 'h3', name: 'จันทร์', role: 'housekeeping', active: false, line_user_id: 'U' + '3'.repeat(32) });
        seed(`${B}/staff/t1`, { id: 't1', name: 'สมศักดิ์', role: 'technician', active: true, line_user_id: 'U' + '4'.repeat(32) });
        const sent = await pushToLineStaff(OWNER, BLD, 'housekeeping', s => ({ type: 'text', text: `งานใหม่ คุณ${s.name}` }));
        expect(sent).toBe(1);
        const pushes = fetchMock.mock.calls.map(c => JSON.parse((c as unknown as [string, { body: string }])[1].body));
        expect(pushes).toHaveLength(1);
        expect(pushes[0]).toMatchObject({ to: 'U' + '1'.repeat(32), messages: [{ text: 'งานใหม่ คุณมาลี' }] });
        vi.unstubAllGlobals();
        delete process.env.LINE_STAFF_CHANNEL_ACCESS_TOKEN;
    });
});

describe('monthly figures', () => {
    const bill = (id: string, total: number, status: string, month = '2026-10') =>
        seed(`${B}/bills/${id}`, { room_number: id, month, total_bill: total, payment_status: status, is_saved: true });

    it('names the month before', () => {
        expect(previousMonth('2026-11-01')).toBe('2026-10');
        expect(previousMonth('2027-01-01')).toBe('2026-12');
    });

    it('says what was collected, of what, and what is still open', () => {
        const t = monthlySummaryText('Dorm A', 'ตุลาคม 2569', [
            { room_number: '101', total_bill: 4000, payment_status: 'paid' },
            { room_number: '102', total_bill: 3000, payment_status: 'pending' },
            { room_number: '103', total_bill: 3000 },
        ], '2026-11-01');
        expect(t.title).toContain('Dorm A');
        expect(t.body).toContain('฿4,000 จาก ฿10,000 (40%)');
        expect(t.body).toContain('ค้าง 1 รอตรวจ 1');
    });

    it('is sent once, on the first of the month, to those who see finances — and only where something was billed', async () => {
        bill('101', 4000, 'paid');
        bill('102', 3000, 'unpaid');
        bill('103', 9999, 'paid', '2026-09');
        expect(await sendMonthlySummaries(new Date('2026-11-05T02:00:00Z'))).toMatchObject({ sent: 0, skipped: 'not_first_day' });

        const first = new Date('2026-10-31T18:00:00Z');   // 01:00 on 1 November in Thailand
        const r = await sendMonthlySummaries(first);
        expect(r.sent).toBe(3);                            // owner, manager, accounting — one property billed
        expect(inboxOf('acct')[0]).toMatchObject({ type: 'monthly_summary' });
        expect(inboxOf('acct')[0].body).toContain('฿4,000 จาก ฿7,000');
        expect(inboxOf('tech')).toEqual([]);

        expect(await sendMonthlySummaries(first)).toMatchObject({ sent: 0, skipped: 'already_sent' });
        expect(inboxOf('acct')).toHaveLength(1);
    });
});
