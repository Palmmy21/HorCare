import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import { FakeSupabase } from './_fake-supabase.js';
const sb = new FakeSupabase();
let configured = true;
vi.mock('./_supabase.js', async () => {
    const real = await vi.importActual<typeof import('./_supabase.js')>('./_supabase.js');
    return { ...real, supabase: () => { if (!configured) throw new real.SupabaseNotConfigured(); return sb; } };
});

// AI slip reading is replaced: the tests decide what the "AI" saw
let slipResult: Record<string, unknown> = {};
vi.mock('./_slip-flow.js', () => ({
    evaluateSlip: async () => slipResult,
}));
let slipQr: string | null = 'QR-PAYLOAD-1';
vi.mock('./_slip.js', () => ({
    decodeSlipQR: async () => ({ payload: slipQr, looksLikeSlip: !!slipQr }),
    slipFingerprint: (p: string) => `fp-${p}`,
    compressSlipToDataUrl: async () => 'data:image/jpeg;base64,AAAA',
}));

import handler from './_collections.js';
import { addAuthUser, fakeReq, fakeRes, listPaths, read, resetFake, seed } from './_fake-firestore.js';
import { permissionsForRole } from '../src/shared/permissions.js';
import { addDays, todayTh } from '../src/shared/market.js';
import { emptyLedger } from '../src/shared/ledger.js';
import { weekStart } from '../src/shared/collections.js';

const OWNER = 'owner-1';
const B1 = 'bld-1';
const B2 = 'bld-2';
const today = todayTh();
const d = (n: number) => addDays(today, n);
const IMG = 'data:image/jpeg;base64,/9j/AAAA';

beforeEach(() => {
    resetFake(); sb.reset(); configured = true; slipQr = 'QR-PAYLOAD-1'; slipResult = {};
    for (const [u, n] of [[OWNER, 'Owner'], ['desk', 'Desk'], ['fin', 'Fin'], ['tech', 'Tech'], ['mkt', 'Market'], ['other', 'Other']]) addAuthUser(u, `${u}@x.com`, n);
    seed(`users/${OWNER}`, { uid: OWNER, license: 'active' });
    for (const b of [B1, B2]) seed(`users/${OWNER}/buildings/${b}`, { id: b });
    const rb = `users/${OWNER}/buildings/${B1}`;
    seed(`${rb}/rooms/r1`, { room_number: 'R1', is_active: true, zone: 'ริมสระ' });
    seed(`${rb}/rooms/r2`, { room_number: 'R2', is_active: true });
    seed(`${rb}/rooms/old`, { room_number: 'R9', is_active: false });
    seed(`users/${OWNER}/buildings/${B2}/rooms/x1`, { room_number: 'X1', is_active: true });
    seed(`${rb}/bank_accounts/acc1`, { id: 'acc1', status: 'active', account_name: 'Resort Co', account_number: '1234567890', bank_code: '004', bank_short: 'KBANK' });
    seed(`${rb}/bank_accounts/acc-off`, { id: 'acc-off', status: 'inactive' });
    for (const [uid, role, props] of [['desk', 'front_desk', ['*']], ['fin', 'finance', ['*']], ['tech', 'technician', ['*']], ['mkt', 'market_admin', ['*']]] as const)
        seed(`users/${OWNER}/members/${uid}`, { uid, role, permissions: permissionsForRole(role), property_ids: props, status: 'active' });
});

async function call(uid: string | null, body: Record<string, unknown>, building = B1) {
    const res = fakeRes();
    await handler(fakeReq({ owner_uid: OWNER, building_id: building, ...body }, uid ?? undefined), res as never);
    return res as { statusCode: number; body: any };
}
const stayRate = (amount = 1500, over: Record<string, unknown> = {}) =>
    call(OWNER, { action: 'rate_save', name: 'ห้องมาตรฐาน', purpose: 'stay', unit: 'night', amount, ...over });
const book = (over: Record<string, unknown> = {}, uid: string | null = OWNER) =>
    call(uid, { action: 'booking_create', room_id: 'r1', guest_name: 'สมชาย ใจดี', guest_phone: '0812345678', check_in: d(2), check_out: d(4), deposit: 0, ...over });
const chargeOf = (id: string) => sb.rows('charges').find(c => c.id === id)!;

describe('access', () => {
    it('front desk takes bookings and money; finance reads and closes; technician and strangers are refused', async () => {
        const week = { from: today, to: d(7) };
        expect((await call('desk', { action: 'snapshot', ...week })).statusCode).toBe(200);
        expect((await call('fin', { action: 'snapshot', ...week })).statusCode).toBe(200);
        expect((await call('mkt', { action: 'snapshot', ...week })).statusCode).toBe(200);
        expect((await call('tech', { action: 'snapshot', ...week })).statusCode).toBe(403);
        expect((await call('other', { action: 'snapshot', ...week })).statusCode).toBe(403);
        expect((await call(null, { action: 'snapshot', ...week })).statusCode).toBe(401);
        await stayRate();
        expect((await book({}, 'fin')).statusCode).toBe(403);               // finance cannot create bookings
        expect((await book({}, 'desk')).statusCode).toBe(200);
        expect((await call('desk', { action: 'rate_save', name: 'x1', purpose: 'stay', unit: 'night', amount: 1 })).statusCode).toBe(403); // rates are a manager's call
        expect((await call('mkt', { action: 'booking_create' })).statusCode).toBe(403);
        expect((await call(OWNER, { action: 'nuke' })).statusCode).toBe(400);
    });

    it('answers 503 while Supabase is not configured and 502 on database failure', async () => {
        configured = false;
        expect((await call(OWNER, { action: 'snapshot', from: today, to: d(1) })).statusCode).toBe(503);
        configured = true; sb.failWith = { code: 'XX000', message: 'boom' };
        const r = await call(OWNER, { action: 'snapshot', from: today, to: d(1) });
        expect(r.statusCode).toBe(502);
        expect(JSON.stringify(r.body)).not.toContain('boom');
    });

    it('never shows or touches another property', async () => {
        await stayRate();
        const b = (await book()).body.booking;
        const other = await call(OWNER, { action: 'snapshot', from: today, to: d(10) }, B2);
        expect(other.body.bookings).toHaveLength(0);
        expect((await call(OWNER, { action: 'booking_status', booking_id: b.id, to: 'check_in' }, B2)).statusCode).toBe(404);
        expect((await call(OWNER, { action: 'snapshot', from: today, to: d(100) })).statusCode).toBe(400); // window cap
    });
});

describe('stays', () => {
    it('prices a stay on the server, night by night, with the seasonal rate winning', async () => {
        await stayRate(1500);
        await stayRate(2500, { name: 'ช่วงเทศกาล', valid_from: d(3), valid_to: d(3) });
        const q = await call(OWNER, { action: 'quote', room_id: 'r1', check_in: d(2), check_out: d(4) });
        expect(q.body.quote.total_satang).toBe((1500 + 2500) * 100);
        const b = await book();
        expect(b.body.total_satang).toBe(400000);
        expect(chargeOf(b.body.booking.charge_id)).toMatchObject({ kind: 'stay', amount_satang: 400000, paid_satang: 0, party_name: 'สมชาย ใจดี' });
    });

    it('a front desk cannot invent a price; a manager can when no rate exists', async () => {
        expect((await book({ total: 1 }, 'desk')).body.error).toBe('no_rate');
        expect((await book({}, OWNER)).body.error).toBe('no_rate');
        const r = await book({ total: 3000 }, OWNER);
        expect(r.body.total_satang).toBe(300000);
        await stayRate(1500);
        const ignored = await book({ room_id: 'r2', total: 1 }, 'desk'); // desk's "total" is ignored, the rate applies
        expect(ignored.body.total_satang).toBe(300000);
    });

    it('refuses to double-book a room but frees the check-out day', async () => {
        await stayRate();
        expect((await book({ check_in: d(2), check_out: d(5) })).statusCode).toBe(200);
        const clash = await book({ check_in: d(4), check_out: d(6), guest_name: 'อีกคน' });
        expect(clash.statusCode).toBe(409);
        expect(clash.body.error).toBe('room_not_available');
        expect((await book({ check_in: d(5), check_out: d(7), guest_name: 'ต่อคิว' })).statusCode).toBe(200);
        expect((await book({ room_id: 'r2', check_in: d(2), check_out: d(5) })).statusCode).toBe(200); // another room, same nights
        expect(sb.rows('bookings')).toHaveLength(3);
    });

    it('validates the guest, the dates and the room', async () => {
        await stayRate();
        for (const bad of [{ guest_name: 'x' }, { guest_phone: '12' }, { check_in: d(-1) }, { check_out: d(2) }, { check_in: d(2), check_out: d(70) }, { adults: 0 }, { deposit: -5 }]) {
            expect((await book(bad)).statusCode).toBe(400);
        }
        expect((await book({ room_id: 'ghost' })).body.error).toBe('room_not_found');
        expect((await book({ room_id: 'old' })).body.error).toBe('room_not_found');
        expect((await book({ room_id: 'x1' })).body.error).toBe('room_not_found'); // another property's room
        expect((await book({ deposit: 99999 })).body.error).toBe('deposit_exceeds_total');
        expect(sb.rows('bookings')).toHaveLength(0);
    });

    it('takes the deposit with the booking, in cash or into a real account only', async () => {
        await stayRate(1500);
        const cash = await book({ deposit: 500 });
        expect(chargeOf(cash.body.booking.charge_id)).toMatchObject({ paid_satang: 50000, status: 'open' });
        expect(sb.rows('charge_payments')[0]).toMatchObject({ kind: 'deposit', method: 'cash', amount_satang: 50000 });
        expect((await book({ room_id: 'r2', deposit: 500, deposit_method: 'transfer' })).statusCode).toBe(400);
        expect((await book({ room_id: 'r2', deposit: 500, deposit_method: 'transfer', deposit_bank_account_id: 'acc-off' })).body.error).toBe('bank_account_invalid');
        expect((await book({ room_id: 'r2', deposit: 500, deposit_method: 'transfer', deposit_bank_account_id: 'acc1' })).statusCode).toBe(200);
    });

    it('check-in only on the day, check-out only when paid; no-show only after the arrival day starts', async () => {
        await stayRate(1000);
        const future = (await book({ check_in: d(2), check_out: d(3) })).body.booking;
        expect((await call(OWNER, { action: 'booking_status', booking_id: future.id, to: 'check_in' })).body.error).toBe('too_early');
        expect((await call(OWNER, { action: 'booking_status', booking_id: future.id, to: 'no_show' })).body.error).toBe('not_allowed');
        // a stay that starts today
        const now = (await book({ room_id: 'r2', check_in: today, check_out: d(2) })).body.booking;
        expect((await call(OWNER, { action: 'booking_status', booking_id: now.id, to: 'check_out' })).body.error).toBe('not_checked_in');
        expect((await call(OWNER, { action: 'booking_status', booking_id: now.id, to: 'check_in' })).body.booking.status).toBe('checked_in');
        expect((await call(OWNER, { action: 'booking_status', booking_id: now.id, to: 'check_in' })).body.error).toBe('not_reserved');
        expect((await call(OWNER, { action: 'booking_status', booking_id: now.id, to: 'check_out' })).body.error).toBe('unpaid_balance');
        const pay = await call(OWNER, { action: 'charge_pay', charge_id: now.charge_id, amount: 2000, method: 'cash' });
        expect(pay.statusCode).toBe(200);
        expect((await call(OWNER, { action: 'booking_status', booking_id: now.id, to: 'check_out' })).body.booking.status).toBe('checked_out');
    });

    it('cancelling settles the money: void if nothing paid, keep or refund what was paid', async () => {
        await stayRate(1000);
        const unpaid = (await book({ check_in: d(2), check_out: d(3) })).body.booking;
        expect((await call(OWNER, { action: 'booking_cancel', booking_id: unpaid.id, mode: 'void' })).body.booking.status).toBe('cancelled');
        expect(chargeOf(unpaid.charge_id).status).toBe('void');

        const paid = (await book({ check_in: d(2), check_out: d(4), deposit: 500 })).body.booking;
        expect((await call(OWNER, { action: 'booking_cancel', booking_id: paid.id, mode: 'void' })).body.error).toBe('has_payments');
        const f = await call(OWNER, { action: 'booking_cancel', booking_id: paid.id, mode: 'forfeit' });
        expect(f.statusCode).toBe(200);
        expect(chargeOf(paid.charge_id)).toMatchObject({ amount_satang: 50000, status: 'paid' });

        const refund = (await book({ room_id: 'r2', check_in: d(2), check_out: d(4), deposit: 500 })).body.booking;
        expect((await call(OWNER, { action: 'booking_cancel', booking_id: refund.id, mode: 'refund' })).statusCode).toBe(200);
        expect(sb.rows('charge_payments').some(p => p.kind === 'refund' && p.amount_satang === -50000)).toBe(true);
        expect((await call(OWNER, { action: 'booking_cancel', booking_id: refund.id, mode: 'void' })).body.error).toBe('cannot_cancel');
    });
});

describe('payments', () => {
    const makeCharge = async () => {
        await stayRate(1000);
        return (await book({ check_in: d(2), check_out: d(3) })).body.booking.charge_id as string; // 1,000 baht
    };

    it('records cash and transfer, refuses overpayment, zero and unknown accounts', async () => {
        const id = await makeCharge();
        const pay = (over: Record<string, unknown>, uid: string | null = OWNER) => call(uid, { action: 'charge_pay', charge_id: id, method: 'cash', amount: 400, ...over });
        expect((await pay({})).body.charge).toMatchObject({ paid_satang: 40000, status: 'open' });
        expect((await pay({ amount: 700 })).body.error).toBe('exceeds_outstanding');
        for (const bad of [{ amount: 0 }, { amount: -1 }, { method: 'bitcoin' }, { method: 'transfer' }]) expect((await pay(bad)).statusCode).toBe(400);
        expect((await pay({ method: 'transfer', bank_account_id: 'acc-off' })).body.error).toBe('bank_account_invalid');
        expect((await pay({ method: 'transfer', bank_account_id: 'ghost' })).body.error).toBe('bank_account_invalid');
        const last = await pay({ method: 'transfer', bank_account_id: 'acc1', amount: 600 }, 'desk');
        expect(last.body.charge).toMatchObject({ paid_satang: 100000, status: 'paid' });
        expect(sb.rows('charge_payments').map(p => [p.method, p.received_by])).toEqual([['cash', OWNER], ['transfer', 'desk']]);
        expect((await call('tech', { action: 'charge_pay', charge_id: id, method: 'cash', amount: 1 })).statusCode).toBe(403);
    });

    it('cannot pay another property\'s charge or a voided one', async () => {
        const id = await makeCharge();
        expect((await call(OWNER, { action: 'charge_pay', charge_id: id, method: 'cash', amount: 100 }, B2)).statusCode).toBe(404);
        const voided = (await call(OWNER, { action: 'charge_extra', amount: 50, description: 'ผ้าเช็ดตัว', party_name: 'คุณเอ' })).body.charge;
        expect((await call(OWNER, { action: 'charge_void', charge_id: voided.id, reason: 'คิดผิด' })).body.charge.status).toBe('void');
        expect((await call(OWNER, { action: 'charge_pay', charge_id: voided.id, method: 'cash', amount: 50 })).body.error).toBe('charge_void');
    });

    it('a stay\'s charge is voided by cancelling the booking, and a paid charge cannot be voided', async () => {
        const id = await makeCharge();
        expect((await call(OWNER, { action: 'charge_void', charge_id: id, reason: 'ลองดู' })).body.error).toBe('cancel_the_booking_instead');
        const extra = (await call(OWNER, { action: 'charge_extra', amount: 100, description: 'อาหารเช้า', party_name: 'คุณบี' })).body.charge;
        await call(OWNER, { action: 'charge_pay', charge_id: extra.id, method: 'cash', amount: 100 });
        expect((await call(OWNER, { action: 'charge_void', charge_id: extra.id, reason: 'ขอคืน' })).body.error).toBe('has_payments');
        expect((await call('desk', { action: 'charge_void', charge_id: extra.id, reason: 'x' })).statusCode).toBe(403);
    });
});

describe('slips read by AI', () => {
    const makeCharge = async () => {
        await stayRate(1000);
        return (await book({ check_in: d(2), check_out: d(3) })).body.booking.charge_id as string;
    };
    const slip = (id: string, over: Record<string, unknown> = {}) => call('desk', { action: 'charge_slip', charge_id: id, image: IMG, ...over });

    it('an approved slip records the transfer into the matched account, keeps the evidence and the picture', async () => {
        const id = await makeCharge();
        slipResult = { autoApprove: true, details: { amount: 1000 }, verdict: { checks: [{ name: 'amount', ok: true }] }, fields: { slip_account_id: 'acc1' }, verifyNote: 'ok', aiAmount: 1000 };
        const r = await slip(id);
        expect(r.statusCode).toBe(200);
        expect(r.body).toMatchObject({ recorded: true, auto: true });
        expect(chargeOf(id)).toMatchObject({ paid_satang: 100000, status: 'paid' });
        const p = sb.rows('charge_payments')[0];
        expect(p).toMatchObject({ method: 'transfer', bank_account_id: 'acc1', verification: 'unverified', slip_ref: 'fp-QR-PAYLOAD-1', amount_satang: 100000 });
        expect(p.slip_details.checks).toBeTruthy();
        expect(read(`users/${OWNER}/buildings/${B1}/slip_images/charge-pay-${p.id}`)).toMatchObject({ charge_id: id });
    });

    it('the same slip can never pay twice, not even another charge', async () => {
        const id = await makeCharge();
        slipResult = { autoApprove: true, details: { amount: 400 }, verdict: { checks: [] }, fields: { slip_account_id: 'acc1' }, verifyNote: 'ok', aiAmount: 400 };
        // the AI approves the whole outstanding amount only when the slip matches it; here the slip pays it all
        expect((await slip(id)).body.recorded).toBe(true);
        const second = (await call(OWNER, { action: 'charge_extra', amount: 100, description: 'น้ำดื่ม', party_name: 'คุณซี' })).body.charge;
        const again = await slip(second.id);
        expect(again.statusCode).toBe(409);
        expect(again.body.error).toBe('duplicate_slip');
    });

    it('a slip the AI could not match records nothing, and shows what it saw for staff to decide', async () => {
        const id = await makeCharge();
        slipResult = { autoApprove: false, details: { amount: 900, receiver_name: 'ใครก็ไม่รู้' }, verdict: { checks: [{ name: 'receiver', ok: false }] }, fields: {}, verifyNote: 'โปรดตรวจด้วยตา', aiAmount: 900 };
        const r = await slip(id);
        expect(r.body).toMatchObject({ recorded: false, needs_review: true, ai_amount: 900, outstanding_satang: 100000 });
        expect(sb.rows('charge_payments')).toHaveLength(0);
        expect(chargeOf(id).paid_satang).toBe(0);
    });

    it('staff can confirm a reviewed slip, with the amount and the receiving account, but never above what is owed', async () => {
        const id = await makeCharge();
        slipResult = { autoApprove: false, details: { amount: 900 }, verdict: { checks: [] }, fields: {}, verifyNote: 'review', aiAmount: 900 };
        expect((await slip(id, { confirm: true, amount: 900 })).body.needs_review).toBe(true); // no account chosen
        expect((await slip(id, { confirm: true, amount: 5000, bank_account_id: 'acc1' })).body.needs_review).toBe(true); // more than owed
        const ok = await slip(id, { confirm: true, amount: 900, bank_account_id: 'acc1' });
        expect(ok.body).toMatchObject({ recorded: true, auto: false });
        expect(chargeOf(id).paid_satang).toBe(90000);
        const next = (await call(OWNER, { action: 'charge_extra', amount: 100, description: 'ซักรีด', party_name: 'คุณดี' })).body.charge;
        slipQr = 'QR-PAYLOAD-2';
        expect((await slip(next.id, { confirm: true, amount: 100, bank_account_id: 'acc-off' })).body.error).toBe('bank_account_invalid');
    });

    it('rejects things that are not a slip image, and an already settled charge', async () => {
        const id = await makeCharge();
        expect((await slip(id, { image: 'not-a-picture' })).body.error).toBe('invalid_image');
        expect((await slip(id, { image: `data:text/html;base64,${'A'.repeat(20)}` })).body.error).toBe('invalid_image');
        expect((await slip(id, { image: undefined })).body.error).toBe('invalid_image');
        await call(OWNER, { action: 'charge_pay', charge_id: id, method: 'cash', amount: 1000 });
        expect((await slip(id)).body.error).toBe('nothing_to_collect');
    });

    it('a slip without a QR is never auto-recorded (no duplicate protection), staff must confirm', async () => {
        const id = await makeCharge();
        slipQr = null;
        slipResult = { autoApprove: false, details: { amount: 1000 }, verdict: { checks: [] }, fields: {}, verifyNote: 'อ่าน QR ไม่ได้', aiAmount: 1000 };
        expect((await slip(id)).body.recorded).toBe(false);
        const ok = await slip(id, { confirm: true, amount: 1000, bank_account_id: 'acc1' });
        expect(ok.body.recorded).toBe(true);
        expect(sb.rows('charge_payments')[0].slip_ref).toBeNull();
    });
});

describe('markets: stall plans, weekly and daily charges', () => {
    const MON = weekStart(today);
    const plan = (over: Record<string, unknown> = {}) =>
        call(OWNER, { action: 'plan_save', room_id: 'r1', mode: 'weekly_advance', unit: 'day', rate: 100, open_days: [1, 2, 3, 4, 5, 6, 0], starts_on: d(-30), ends_on: null, ...over });

    it('a plan is one per stall; saving again changes it, ending it stops charges', async () => {
        const a = await plan();
        expect(a.statusCode).toBe(200);
        const b = await plan({ rate: 120 });
        expect(b.body.plan.id).toBe(a.body.plan.id);
        expect(sb.rows('stall_plans')).toHaveLength(1);
        expect(b.body.plan.rate_satang).toBe(12000);
        expect((await plan({ mode: 'daily_actual', unit: 'week' })).statusCode).toBe(400);
        expect((await call('mkt', { action: 'plan_save' })).statusCode).toBe(403); // market admin collects, the owner sets plans
        expect((await call(OWNER, { action: 'plan_end', plan_id: a.body.plan.id })).body.plan.status).toBe('ended');
        expect((await call(OWNER, { action: 'stall_charge', room_id: 'r1', date: today })).body.error).toBe('no_stall_plan');
    });

    it('charges a weekly stall for its open days only, once, skipping days it announced it is closed', async () => {
        await plan({ open_days: [1, 2, 3], rate: 100 }); // Mon-Wed, 100/day → 300
        const first = await call('mkt', { action: 'stall_charge', room_id: 'r1', date: today });
        expect(first.body.charge).toMatchObject({ kind: 'stall_week', amount_satang: 30000, dedupe_key: `stall-week:r1:${MON}` });
        const again = await call('mkt', { action: 'stall_charge', room_id: 'r1', date: d(1) <= addDays(MON, 6) ? d(1) : today });
        expect(sb.rows('charges').filter(c => c.kind === 'stall_week')).toHaveLength(1);
        expect(again.body.charge.id).toBe(first.body.charge.id);

        seed(`users/${OWNER}/buildings/${B1}/shop_closures/c1`, { id: 'c1', room_id: 'r2', from_date: MON, to_date: MON, reason: 'sick', status: 'active' });
        await call(OWNER, { action: 'plan_save', room_id: 'r2', mode: 'weekly_advance', unit: 'day', rate: 100, open_days: [1, 2, 3], starts_on: d(-30), ends_on: null });
        const r2 = await call('mkt', { action: 'stall_charge', room_id: 'r2', date: today });
        expect(r2.body.charge.amount_satang).toBe(20000); // Monday closed
    });

    it('uses the market rate when the plan has none, zone rate beating the general one', async () => {
        await plan({ rate: undefined });
        expect((await call('mkt', { action: 'stall_charge', room_id: 'r1', date: today })).body.error).toBe('nothing_to_collect');
        await call(OWNER, { action: 'rate_save', name: 'แผงทั่วไป', purpose: 'stall', unit: 'day', amount: 80 });
        await call(OWNER, { action: 'rate_save', name: 'ริมสระ', purpose: 'stall', unit: 'day', amount: 150, scope: 'zone', zone: 'ริมสระ' });
        const c = (await call('mkt', { action: 'stall_charge', room_id: 'r1', date: today })).body.charge;
        expect(c.amount_satang).toBe(15000 * 7);
    });

    it('daily-actual stalls pay per visit: charge for the day once, can be marked absent instead', async () => {
        await plan({ mode: 'daily_actual', rate: 90 });
        const c = (await call('mkt', { action: 'stall_charge', room_id: 'r1', date: today })).body.charge;
        expect(c).toMatchObject({ kind: 'stall_day', amount_satang: 9000, dedupe_key: `stall-day:r1:${today}` });
        expect((await call('mkt', { action: 'stall_charge', room_id: 'r1', date: today })).body.charge.id).toBe(c.id);
        expect((await call('mkt', { action: 'stall_attendance', room_id: 'r1', date: today, present: false })).statusCode).toBe(200);
        expect((await call('mkt', { action: 'stall_attendance', room_id: 'r1', date: today, present: true })).statusCode).toBe(200); // changed mind: updates, not duplicates
        expect(sb.rows('stall_attendance')).toHaveLength(1);
        expect(sb.rows('stall_attendance')[0].present).toBe(true);
        expect((await call('mkt', { action: 'stall_attendance', room_id: 'r1', date: d(1), present: true })).statusCode).toBe(400); // not in the future
        await call(OWNER, { action: 'plan_save', room_id: 'r2', mode: 'weekly_advance', unit: 'day', rate: 100, open_days: [1], starts_on: d(-30), ends_on: null });
        expect((await call('mkt', { action: 'stall_attendance', room_id: 'r2', date: today, present: true })).statusCode).toBe(400); // weekly stalls have no attendance
    });

    it('generates the whole week for every weekly stall, and a second run adds nothing', async () => {
        await plan({ rate: 100 });
        await call(OWNER, { action: 'plan_save', room_id: 'r2', mode: 'weekly_advance', unit: 'week', rate: 500, open_days: [6, 0], starts_on: d(-30), ends_on: null });
        const a = await call('mkt', { action: 'week_generate', date: today });
        expect(a.body.created).toBe(2);
        const b = await call('mkt', { action: 'week_generate', date: today });
        expect(b.body.created).toBe(0);
        expect(sb.rows('charges').filter(c => c.kind === 'stall_week')).toHaveLength(2);
        expect((await call('mkt', { action: 'week_generate', date: d(40) })).statusCode).toBe(400);
    });

    it('walk-ins pay once for the day; their name and amount are required', async () => {
        const w = await call('mkt', { action: 'walk_in_charge', name: 'ป้าแดง', amount: 60 });
        expect(w.body.charge).toMatchObject({ kind: 'walk_in', amount_satang: 6000, party_name: 'ป้าแดง' });
        expect((await call('mkt', { action: 'walk_in_charge', name: '', amount: 60 })).statusCode).toBe(400);
        expect((await call('mkt', { action: 'walk_in_charge', name: 'ลุงดำ', amount: 0 })).statusCode).toBe(400);
        expect((await call('mkt', { action: 'charge_pay', charge_id: w.body.charge.id, method: 'cash', amount: 60 })).body.charge.status).toBe('paid');
    });
});

describe('day close', () => {
    it('compares counted cash with what the system says was taken, once per day', async () => {
        await stayRate(1000);
        const id = (await book({ check_in: d(2), check_out: d(3) })).body.booking.charge_id;
        await call(OWNER, { action: 'charge_pay', charge_id: id, method: 'cash', amount: 300 });
        await call(OWNER, { action: 'charge_pay', charge_id: id, method: 'transfer', bank_account_id: 'acc1', amount: 200 });
        const c = await call('fin', { action: 'day_close', date: today, counted_cash: 250 });
        expect(c.statusCode).toBe(200);
        expect(c.body.close).toMatchObject({ expected_cash_satang: 30000, counted_cash_satang: 25000, transfer_satang: 20000, difference_satang: -5000, payments_count: 2 });
        expect((await call('fin', { action: 'day_close', date: today, counted_cash: 300 })).body.error).toBe('already_closed');
        expect((await call('fin', { action: 'day_close', date: d(1), counted_cash: 0 })).statusCode).toBe(400);
        expect((await call('desk', { action: 'day_close', date: today, counted_cash: 0 })).statusCode).toBe(403);
    });
});

describe('snapshot', () => {
    it('returns what the screens need for the window, with open charges even from before it', async () => {
        await stayRate();
        const b = (await book()).body.booking;
        const snap = await call('desk', { action: 'snapshot', from: today, to: d(7) });
        expect(snap.body.rooms.map((r: { id: string }) => r.id).sort()).toEqual(['r1', 'r2']); // inactive room hidden
        expect(snap.body.bookings.map((x: { id: string }) => x.id)).toEqual([b.id]);
        expect(snap.body.charges[0].id).toBe(b.charge_id);
        expect(snap.body.rates).toHaveLength(1);
        sb.seed('charges', { id: 'old-charge', owner_uid: OWNER, building_id: B1, kind: 'extra', party_name: 'ค้าง', period_start: d(-90), period_end: d(-90), amount_satang: 100, dedupe_key: 'extra:old' });
        const later = await call('desk', { action: 'snapshot', from: today, to: d(7) });
        expect(later.body.charges.some((c: { id: string }) => c.id === 'old-charge')).toBe(true);
    });
});

describe('finance series', () => {
    it('gives the owner 13 months of charges and receipts without personal details, and open charges from any age', async () => {
        await stayRate(1000);
        const id = (await book({ check_in: d(2), check_out: d(3), guest_phone: '0812345678' })).body.booking.charge_id;
        await call(OWNER, { action: 'charge_pay', charge_id: id, method: 'cash', amount: 400 });
        sb.seed('charges', { id: 'ancient', owner_uid: OWNER, building_id: B1, kind: 'extra', party_name: 'ค้างนาน', period_start: '2024-01-01', period_end: '2024-01-01', amount_satang: 500, dedupe_key: 'extra:ancient' });
        const r = await call('fin', { action: 'finance_series' });
        expect(r.statusCode).toBe(200);
        expect(r.body.charges.map((c: { id: string }) => c.id)).toContain('ancient');
        expect(r.body.charges.find((c: { id: string }) => c.id === id)).toMatchObject({ amount_satang: 100000, paid_satang: 40000 });
        expect(JSON.stringify(r.body)).not.toContain('0812345678');
        expect(r.body.payments).toEqual([expect.objectContaining({ amount_satang: 40000, method: 'cash' })]);
        expect((await call('tech', { action: 'finance_series' })).statusCode).toBe(403);
        expect((await call(OWNER, { action: 'finance_series' }, B2)).body.charges).toEqual([]);
    });
});

describe('the books', () => {
    const ledger = () => {
        const l = emptyLedger('L1');
        l.name = 'Resort'; l.legal_entity_name = 'Resort Co'; l.property_ids = [B1];
        l.posting.channels = { cash: '1101', 'bank:acc1': '1102' };
        seed(`users/${OWNER}/ledgers/L1`, { ...l, created_at: 'x', updated_at: 'x' });
    };
    const entries = () => listPaths(`users/${OWNER}/ledgers/L1/entries/`).map(p => read(p) as { kind: string; total_satang: number; lines: { account: string; debit?: number; dr_satang?: number }[]; sources: { kind: string }[] });

    it('money taken is posted to the ledger straight away: receivable first, then the receipt', async () => {
        ledger();
        await stayRate(1000);
        const id = (await book({ check_in: today, check_out: d(1) })).body.booking.charge_id;
        const r = await call(OWNER, { action: 'charge_pay', charge_id: id, method: 'cash', amount: 1000 });
        expect(r.statusCode).toBe(200);
        const all = entries();
        expect(all.map(e => e.kind).sort()).toEqual(['invoice', 'receipt']);
        expect(all.every(e => e.total_satang === 100000)).toBe(true);
        expect(all.find(e => e.kind === 'invoice')!.sources[0].kind).toBe('charge');
        // paying the same charge again changes nothing in the books
        await call(OWNER, { action: 'booking_status', booking_id: sb.rows('bookings')[0].id, to: 'check_in' });
        expect(entries()).toHaveLength(2);
    });

    it('a transfer slip is posted as a receivable, but its receipt waits until the bank confirms it', async () => {
        ledger();
        await stayRate(1000);
        const id = (await book({ check_in: today, check_out: d(1) })).body.booking.charge_id;
        slipResult = { autoApprove: true, details: { amount: 1000 }, verdict: { checks: [] }, fields: { slip_account_id: 'acc1' }, verifyNote: 'ok', aiAmount: 1000 };
        const r = await call('desk', { action: 'charge_slip', charge_id: id, image: IMG });
        expect(r.body.recorded).toBe(true);
        expect(entries().map(e => e.kind)).toEqual(['invoice']);
    });

    it('without a ledger the money is still recorded and nothing is posted; collection never fails because of the books', async () => {
        await stayRate(1000);
        const id = (await book({ check_in: today, check_out: d(1) })).body.booking.charge_id;
        const r = await call(OWNER, { action: 'charge_pay', charge_id: id, method: 'cash', amount: 1000 });
        expect(r.statusCode).toBe(200);
        expect(r.body.posted).toMatchObject({ posted: 0, reason: 'no_ledger' });
        expect(chargeOf(id).status).toBe('paid');
    });

    it('audits who did what', async () => {
        await stayRate(1000);
        await book();
        expect(listPaths(`users/${OWNER}/audit_logs/`).length).toBeGreaterThanOrEqual(2);
    });
});
