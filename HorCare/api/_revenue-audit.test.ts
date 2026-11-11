import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import { FakeSupabase } from './_fake-supabase.js';
const sb = new FakeSupabase();
let configured = true;
vi.mock('./_supabase.js', async () => {
    const real = await vi.importActual<typeof import('./_supabase.js')>('./_supabase.js');
    return { ...real, supabase: () => { if (!configured) throw new real.SupabaseNotConfigured(); return sb; } };
});

import handler from './_revenue-audit.js';
import market from './_market.js';
import { addAuthUser, fakeReq, fakeRes, read, resetFake, seed } from './_fake-firestore.js';
import { permissionsForRole } from '../src/shared/permissions.js';
import { todayTh } from '../src/shared/market.js';

const OWNER = 'owner-1';
const BLD = 'mkt-1';
const B = `users/${OWNER}/buildings/${BLD}`;
const scope = { owner_uid: OWNER, building_id: BLD };
const MONTH = '2026-10';

async function call(uid: string, body: object, h = handler) {
    const res = fakeRes();
    await h(fakeReq({ owner_uid: OWNER, building_id: BLD, ...body }, uid) as never, res as never);
    return res as unknown as { statusCode: number; body: Record<string, any> };
}
const report = (body: object = {}) => call(OWNER, { action: 'report', month: MONTH, ...body });

beforeEach(() => {
    resetFake();
    sb.reset();
    configured = true;
    for (const uid of [OWNER, 'acct', 'collector', 'stranger']) addAuthUser(uid, `${uid}@x.com`, uid);
    seed(`users/${OWNER}`, { uid: OWNER });
    seed(B, { id: BLD });
    seed(`${B}/data/config`, { building_type: 'market', bill_customization: { dorm_name: 'ตลาดทดสอบ' } });
    seed(`users/${OWNER}/members/acct`, { uid: 'acct', role: 'finance', permissions: permissionsForRole('finance'), property_ids: ['*'], status: 'active', display_name: 'บัญชี' });
    seed(`users/${OWNER}/members/collector`, { uid: 'collector', role: 'market_admin', permissions: permissionsForRole('market_admin'), property_ids: ['*'], status: 'active', display_name: 'สมชาย' });

    // zone A: four monthly stalls at ฿3,000, three rented
    for (const [id, rented] of [['a1', true], ['a2', true], ['a3', true], ['a4', false]] as const) {
        seed(`${B}/rooms/${id}`, { room_number: id.toUpperCase(), zone: 'โซน A', is_active: true, rent_amount: 3000 });
        if (rented) seed(`${B}/tenants/${id}`, { full_name: `ผู้ค้า ${id}`, move_in_date: '2026-01-01' });
    }
    seed(`${B}/bills/b1`, { id: 'b1', room_id: 'a1', month: MONTH, is_saved: true, room_rent: 3000, total_bill: 3000, payment_status: 'paid', paid_amount: 3000 });
    seed(`${B}/bills/b2`, { id: 'b2', room_id: 'a2', month: MONTH, is_saved: true, room_rent: 3000, total_bill: 2500, adjustments: [{ id: 'x', label: 'ลดพิเศษ', amount: -500 }], payment_status: 'unpaid' });
    // a3 has no bill; a draft bill does not count
    seed(`${B}/bills/b3`, { id: 'b3', room_id: 'a3', month: MONTH, is_saved: false, room_rent: 3000, total_bill: 3000 });

    // zone B: one daily stall at ฿100 on Mondays (5 Mondays in Oct 2026: 5, 12, 19, 26)
    seed(`${B}/rooms/b1`, { room_number: 'B1', zone: 'โซน B', is_active: true, rent_amount: 0 });
    sb.seed('stall_plans', { id: 'p1', ...scope, room_id: 'b1', room_number: 'B1', mode: 'daily_actual', unit: 'day', rate_satang: 10000, open_days: [1], starts_on: '2026-01-01', ends_on: null, status: 'active' });
    sb.seed('charges', { id: 'c1', ...scope, kind: 'stall_day', room_id: 'b1', room_number: 'B1', party_name: 'B1', period_start: '2026-10-05', period_end: '2026-10-05', description: '', amount_satang: 10000, paid_satang: 10000, status: 'paid', dedupe_key: 'stall-day:b1:2026-10-05', created_by: 'collector' });
    sb.seed('charge_payments', { id: 'pay1', ...scope, charge_id: 'c1', amount_satang: 10000, method: 'cash', kind: 'payment', received_by: 'collector', received_by_name: 'สมชาย', received_at: '2026-10-05T03:00:00Z' });
    sb.seed('stall_attendance', { id: 'at1', ...scope, room_id: 'b1', visit_date: '2026-10-12', present: false, marked_by: 'collector' });
    sb.seed('day_closes', { id: 'dc1', ...scope, close_date: '2026-10-05', expected_cash_satang: 10000, counted_cash_satang: 8000, transfer_satang: 0, payments_count: 1, difference_satang: -2000, closed_by: 'collector', closed_by_name: 'สมชาย' });
    seed(`${B}/shop_closures/s1`, { id: 's1', room_id: 'b1', room_number: 'B1', from_date: '2026-10-19', to_date: '2026-10-19', reason: 'sick', status: 'active' });
});

describe('/api/revenue-audit', () => {
    it('only those who may see the money', async () => {
        expect((await call('collector', { action: 'report', month: MONTH })).statusCode).toBe(403);
        expect((await call('stranger', { action: 'report', month: MONTH })).statusCode).toBe(403);
        expect((await call('acct', { action: 'report', month: MONTH })).statusCode).toBe(200);
    });

    it('rejects a bad month, a future month and an unknown action', async () => {
        expect((await report({ month: '2026-13' })).statusCode).toBe(400);
        const [y, m] = todayTh().split('-').map(Number);
        const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
        expect((await report({ month: next })).statusCode).toBe(400);
        expect((await call(OWNER, { action: 'nope', month: MONTH })).statusCode).toBe(400);
    });

    it('audits monthly and daily stalls together, and the numbers balance', async () => {
        const res = await report();
        expect(res.statusCode).toBe(200);
        const r = res.body.report;
        expect(res.body.zones).toEqual(['โซน A', 'โซน B']);
        // monthly: 3 rented × ฿3,000 = ฿9,000 expected; daily: 4 Mondays, 1 excused (sick notice) → ฿300
        expect(r.expected_satang).toBe(900000 + 30000);
        expect(r.collected_satang).toBe(300000 + 10000);
        expect(r.gaps.not_billed).toBe(300000);
        expect(r.gaps.discount).toBe(50000);
        expect(r.gaps.unpaid).toBe(250000);
        expect(r.gaps.absent_unreported).toBe(10000);   // 12th, marked absent, no notice
        expect(r.gaps.not_recorded).toBe(10000);        // 26th, nothing recorded
        expect(r.excused.vendor_closure).toBe(10000);    // 19th
        expect(r.cash_difference_satang).toBe(-2000);
        const sum = Object.values(r.gaps as Record<string, number>).reduce((a, b) => a + b, 0);
        expect(sum).toBe(r.expected_satang - r.collected_satang);
        expect(r.collectors.find((c: { name: string }) => c.name === 'สมชาย')).toMatchObject({ collected_satang: 10000, absent_unreported: 1, short_satang: 2000 });
        expect(r.findings.map((f: { id: string }) => f.id)).toEqual(expect.arrayContaining(['not_billed', 'unpaid', 'discount', 'cash_short']));
    });

    it('a zone on its own', async () => {
        const r = (await report({ zone: 'โซน A' })).body.report;
        expect(r.stalls_total).toBe(4);
        expect(r.expected_satang).toBe(900000);
        expect(r.cash_difference_satang).toBe(0);  // day closes are market-wide
    });

    it('without the round data, monthly stalls are still audited and the report says why the rest is missing', async () => {
        configured = false;
        const r = (await report()).body.report;
        expect(r.expected_satang).toBe(900000);
        expect(r.notes.join(' ')).toContain('รอบเก็บเงิน');
    });

    it('a market closure recorded by staff excuses those days', async () => {
        const add = await call(OWNER, { action: 'market_closure_add', from_date: '2026-10-26', to_date: '2026-10-26', zones: ['โซน B'], reason: 'flood', note: 'น้ำท่วมทางเข้า' }, market);
        expect(add.statusCode).toBe(200);
        expect(read(`${B}/market_closures/${add.body.closure.id}`)).toMatchObject({ reason: 'flood', zones: ['โซน B'], status: 'active', waive_rent: false });
        const r = (await report()).body.report;
        expect(r.excused.market_closure).toBe(10000);
        expect(r.gaps.not_recorded).toBe(0);

        expect((await call(OWNER, { action: 'market_closure_list' }, market)).body.closures).toHaveLength(1);
        expect((await call(OWNER, { action: 'market_closure_cancel', market_closure_id: add.body.closure.id }, market)).statusCode).toBe(200);
        expect((await call(OWNER, { action: 'market_closure_list' }, market)).body.closures).toHaveLength(0);
    });

    it('market closures: only staff who manage stalls may record them, and the input is checked', async () => {
        expect((await call('acct', { action: 'market_closure_add', from_date: '2026-10-26', to_date: '2026-10-26', reason: 'flood' }, market)).statusCode).toBe(403);
        expect((await call(OWNER, { action: 'market_closure_add', from_date: '2026-10-27', to_date: '2026-10-26', reason: 'flood' }, market)).statusCode).toBe(400);
        expect((await call(OWNER, { action: 'market_closure_add', from_date: '2026-10-26', to_date: '2026-10-26', reason: 'aliens' }, market)).statusCode).toBe(400);
        expect((await call('collector', { action: 'market_closure_add', from_date: '2026-10-26', to_date: '2026-10-26', reason: 'power', waive_rent: true }, market)).statusCode).toBe(200);
    });
});
