import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);
vi.mock('./_supabase.js', async () => {
    const real = await vi.importActual<typeof import('./_supabase.js')>('./_supabase.js');
    return { ...real, supabase: () => { throw new real.SupabaseNotConfigured(); } };
});

import handler, { handleOwnerCommand, redeemOwnerLink } from './_owner-line.js';
import { addAuthUser, fakeReq, fakeRes, read, resetFake, seed } from './_fake-firestore.js';
import { permissionsForRole } from '../src/shared/permissions.js';
import { todayTh } from '../src/shared/market.js';

const OWNER = 'owner-1';
const month = todayTh().slice(0, 7);
const LINE_U = 'U' + 'a'.repeat(32);

async function call(body: object, uid: string) {
    const res = fakeRes();
    await handler(fakeReq({ owner_uid: OWNER, ...body }, uid), res as never);
    return res as unknown as { statusCode: number; body: Record<string, any> };
}
const replyText = (msgs: object[] | null) => (msgs ?? []).map(m => (m as { text: string }).text).join('\n---\n');

beforeEach(() => {
    resetFake();
    addAuthUser(OWNER, 'o@x.com', 'Owner');
    addAuthUser('acct', 'a@x.com', 'Accountant');
    addAuthUser('desk', 'd@x.com', 'Desk');
    seed(`users/${OWNER}`, { uid: OWNER });
    for (const [b, name] of [['bA', 'หอ A'], ['bB', 'หอ B']]) {
        seed(`users/${OWNER}/buildings/${b}`, { id: b });
        seed(`users/${OWNER}/buildings/${b}/data/config`, { bill_customization: { dorm_name: name } });
    }
    seed(`users/${OWNER}/buildings/bA/rooms/r1`, { room_number: '101', is_active: true });
    seed(`users/${OWNER}/buildings/bA/rooms/r2`, { room_number: '102', is_active: true });
    seed(`users/${OWNER}/buildings/bA/tenants/r1`, { full_name: 'X', move_in_date: '2025-01-01' });
    seed(`users/${OWNER}/buildings/bA/bills/b1`, { room_number: '101', month, total_bill: 4000, payment_status: 'paid', is_saved: true });
    seed(`users/${OWNER}/buildings/bA/bills/b2`, { room_number: '102', month, total_bill: 3000, is_saved: true });
    seed(`users/${OWNER}/members/acct`, { uid: 'acct', role: 'finance', permissions: permissionsForRole('finance'), property_ids: ['bB'], status: 'active' });
    seed(`users/${OWNER}/members/desk`, { uid: 'desk', role: 'front_desk', permissions: permissionsForRole('front_desk'), property_ids: ['*'], status: 'active' });
});

async function link(uid: string, lineUser = LINE_U) {
    const issued = await call({ action: 'code' }, uid);
    return { issued, reply: issued.statusCode === 200 ? await redeemOwnerLink(lineUser, issued.body.code) : '' };
}

describe('owner LINE commands', () => {
    it('links the owner and answers #ยอด, #ค้าง, #ห้องว่าง for every property', async () => {
        const { issued, reply } = await link(OWNER);
        expect(issued.body.code).toMatch(/^HCO-[A-HJ-NP-Z2-9]{8}$/);
        expect(reply).toContain('เชื่อม LINE กับบัญชี HorCare แล้ว');
        expect((await call({ action: 'status' }, OWNER)).body.linked).toBe(true);

        const sum = replyText(await handleOwnerCommand(LINE_U, '#ยอด'));
        expect(sum).toContain('หอ A');
        expect(sum).toContain('เก็บแล้ว ฿4,000 จาก ฿7,000');
        expect(sum).toContain('หอ B');

        expect(replyText(await handleOwnerCommand(LINE_U, '#ค้าง'))).toContain('• 102');
        expect(replyText(await handleOwnerCommand(LINE_U, '#ห้องว่าง'))).toContain('ว่าง 1 ห้อง\n102');
        expect(await handleOwnerCommand(LINE_U, 'สวัสดี')).toBeNull();
    });

    it('a code works once and only within 15 minutes', async () => {
        const { issued } = await link(OWNER);
        expect(await redeemOwnerLink('U' + 'b'.repeat(32), issued.body.code)).toContain('ถูกใช้ไปแล้ว');
        const fresh = await call({ action: 'code' }, OWNER);
        const vi_now = Date.now;
        Date.now = () => vi_now() + 16 * 60 * 1000;
        try { expect(await redeemOwnerLink('U' + 'c'.repeat(32), fresh.body.code)).toContain('หมดอายุ'); } finally { Date.now = vi_now; }
        expect(await redeemOwnerLink(LINE_U, 'HCO-ZZZZZZZZ')).toContain('ไม่พบรหัส');
    });

    it('staff see only the properties they were given, and need finance access', async () => {
        await link('acct');
        const sum = replyText(await handleOwnerCommand(LINE_U, '#ยอด'));
        expect(sum).toContain('หอ B');
        expect(sum).not.toContain('หอ A');

        expect((await call({ action: 'code' }, 'desk')).statusCode).toBe(403);
    });

    it('forgets the binding when access is taken away, or on #ยกเลิก', async () => {
        await link('acct');
        seed(`users/${OWNER}/members/acct`, { uid: 'acct', role: 'finance', property_ids: ['bB'], status: 'disabled' });
        expect(replyText(await handleOwnerCommand(LINE_U, '#ยอด'))).toContain('ไม่มีสิทธิ์ดูยอดเงินแล้ว');
        expect(read(`owner_line/${LINE_U}`)).toBeUndefined();

        await link(OWNER);
        expect(replyText(await handleOwnerCommand(LINE_U, '#ยกเลิก'))).toContain('เลิกเชื่อม');
        expect(replyText(await handleOwnerCommand(LINE_U, '#ยอด'))).toContain('ยังไม่ได้เชื่อม');
    });

    it('unlinks from the app', async () => {
        await link(OWNER);
        expect((await call({ action: 'unlink' }, OWNER)).statusCode).toBe(200);
        expect((await call({ action: 'status' }, OWNER)).body.linked).toBe(false);
    });
});
