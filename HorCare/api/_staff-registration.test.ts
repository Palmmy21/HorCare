import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

const pushed: { to: string; messages: { text?: string }[] }[] = [];
vi.mock('./_line.js', async () => {
    const real = await vi.importActual<typeof import('./_line.js')>('./_line.js');
    return { ...real, staffLineToken: () => 'staff-token', linePush: async (to: string, messages: object[]) => { pushed.push({ to, messages: messages as { text?: string }[] }); } };
});

import handler, { handleStaffChat } from './_staff-registration.js';
import { addAuthUser, fakeReq, fakeRes, listPaths, read, resetFake, seed } from './_fake-firestore.js';
import { permissionsForRole } from '../src/shared/permissions.js';

const OWNER = 'owner-1';
const B1 = 'bld-1';
const B2 = 'bld-2';
const B = `users/${OWNER}/buildings/${B1}`;
const LINE_A = 'U' + 'a'.repeat(32);
const LINE_B = 'U' + 'b'.repeat(32);

beforeEach(() => {
    resetFake(); pushed.length = 0;
    for (const [u, n] of [[OWNER, 'Owner'], ['desk', 'Desk'], ['tech', 'Tech'], ['other', 'Other']]) addAuthUser(u, `${u}@x.com`, n);
    seed(`users/${OWNER}`, { uid: OWNER });
    for (const b of [B1, B2]) { seed(`users/${OWNER}/buildings/${b}`, { id: b }); seed(`users/${OWNER}/buildings/${b}/data/config`, { bill_customization: { dorm_name: `หอ ${b}` } }); }
    for (const [uid, role] of [['desk', 'front_desk'], ['tech', 'technician']] as const)
        seed(`users/${OWNER}/members/${uid}`, { uid, role, permissions: permissionsForRole(role), property_ids: ['*'], status: 'active' });
});

async function call(uid: string | null, body: Record<string, unknown>, building = B1) {
    const res = fakeRes();
    await handler(fakeReq({ owner_uid: OWNER, building_id: building, ...body }, uid ?? undefined), res as never);
    return res as { statusCode: number; body: any };
}
const say = async (line: string, t: string) => ((await handleStaffChat(line, t)) as { text: string }[]).map(m => m.text).join('\n');
const newCode = async (building = B1) => (await call(OWNER, { action: 'code_rotate' }, building)).body.code as string;
const register = async (line = LINE_A, name = 'สมชาย ใจดี', phone = '081-234-5678', role = 'ช่าง') => {
    const code = await newCode();
    await say(line, code); await say(line, role); await say(line, name); await say(line, phone);
    return say(line, 'ใช่');
};
const pending = async () => (await call(OWNER, { action: 'list' })).body.pending as { id: string; name: string; phone: string; role: string; match: string | null }[];

describe('the registration code', () => {
    it('is issued by the owner or front desk, shown again later, rotated and revoked', async () => {
        const first = await call('desk', { action: 'code_rotate' });
        expect(first.statusCode).toBe(200);
        expect(first.body.code).toMatch(/^HCR-[A-HJ-NP-Z2-9]{8}$/);
        expect((await call(OWNER, { action: 'code_get' })).body.code).toBe(first.body.code);
        const second = await call(OWNER, { action: 'code_rotate' });
        expect(second.body.code).not.toBe(first.body.code);
        expect(await say(LINE_A, first.body.code)).toContain('ไม่พบรหัส'); // the old one stops working at once
        expect((await call(OWNER, { action: 'code_revoke' })).body.code).toBeNull();
        expect(await say(LINE_A, second.body.code)).toContain('ไม่พบรหัส');
        expect((await call(OWNER, { action: 'code_get' })).body.code).toBeNull();
    });

    it('technicians and strangers cannot manage it, and one property never sees another\'s', async () => {
        expect((await call('tech', { action: 'code_rotate' })).statusCode).toBe(403);
        expect((await call('other', { action: 'code_get' })).statusCode).toBe(403);
        expect((await call(null, { action: 'list' })).statusCode).toBe(401);
        const code1 = await newCode(B1);
        expect((await call(OWNER, { action: 'code_get' }, B2)).body.code).toBeNull();
        await say(LINE_A, code1);
        await say(LINE_A, 'ช่าง'); await say(LINE_A, 'สมชาย'); await say(LINE_A, '0812345678'); await say(LINE_A, 'ใช่');
        expect((await call(OWNER, { action: 'list' }, B2)).body.pending).toEqual([]);
        expect((await call(OWNER, { action: 'list' }, B1)).body.pending).toHaveLength(1);
    });

    it('an expired code says so', async () => {
        const code = await newCode();
        const { createHash } = await import('node:crypto');
        const key = `staff_reg_codes/${createHash('sha256').update(code).digest('hex')}`;
        seed(key, { ...read(key)!, expires_at: Date.now() - 1000 });
        expect(await say(LINE_A, code)).toContain('หมดอายุ');
    });

    it('guessing codes is limited per LINE account', async () => {
        let last = '';
        for (let i = 0; i < 11; i++) last = await say(LINE_A, `HCR-${'ABCDEFGH'.split('').sort(() => 0.5 - Math.random()).join('')}`);
        expect(last).toContain('หลายครั้ง');
    });
});

describe('the conversation in LINE', () => {
    it('a person registers step by step and the request waits for the manager; the owner is told in the app', async () => {
        const code = await newCode();
        expect(await say(LINE_A, code)).toContain('ทำหน้าที่อะไร');
        expect(await say(LINE_A, 'ช่าง')).toContain('ชื่อ-นามสกุล');
        expect(await say(LINE_A, 'สมชาย ใจดี')).toContain('เบอร์โทร');
        expect(await say(LINE_A, '081-234-5678')).toContain('ถูกต้องไหม');
        expect(await say(LINE_A, 'ใช่')).toContain('ส่งเรื่องให้ผู้จัดการแล้ว');
        expect(await pending()).toEqual([expect.objectContaining({ name: 'สมชาย ใจดี', phone: '0812345678', role: 'technician', match: null })]);
        const notes = listPaths(`${B}/notifications/`).map(p => read(p)!);
        expect(notes).toHaveLength(1);
        expect(notes[0]).toMatchObject({ event: 'staff.registration_pending' });
        // nothing exists yet: no staff record, no LINE link
        expect(listPaths(`${B}/staff/`)).toHaveLength(0);
        expect(await say(LINE_A, 'สวัสดี')).toContain('รอผู้จัดการอนุมัติ');
    });

    it('bad answers repeat the question; ยกเลิก stops; a stranger gets the help text', async () => {
        expect(await say(LINE_B, 'สวัสดี')).toContain('HCR-');
        const code = await newCode();
        await say(LINE_A, code);
        expect(await say(LINE_A, 'คนสวน')).toContain('เลือก "ช่าง" หรือ "แม่บ้าน"');
        await say(LINE_A, 'แม่บ้าน');
        expect(await say(LINE_A, '123')).toContain('ชื่อ-นามสกุล');
        await say(LINE_A, 'สมศรี');
        expect(await say(LINE_A, 'abc')).toContain('เบอร์โทรไม่ถูกต้อง');
        expect(await say(LINE_A, 'ยกเลิก')).toContain('ยกเลิกการลงทะเบียน');
        expect(await pending()).toEqual([]);
    });

    it('does not take a second request from someone already waiting, ', async () => {
        await register();
        const again = await say(LINE_A, await newCode());
        expect(again).toContain('รอผู้จัดการอนุมัติ');
        expect(await pending()).toHaveLength(1);
    });

    it('a half-finished conversation expires', async () => {
        const code = await newCode();
        await say(LINE_A, code);
        const s = read(`staff_reg_sessions/${LINE_A}`)!;
        seed(`staff_reg_sessions/${LINE_A}`, { ...s, updated_at: Date.now() - 31 * 60 * 1000 });
        expect(await say(LINE_A, 'ช่าง')).toContain('HCR-'); // back to the help text, nothing half-saved
    });
});

describe('approval', () => {
    it('approving creates the staff member, links their LINE and tells them in the chat', async () => {
        await register();
        const [p] = await pending();
        const r = await call('desk', { action: 'approve', registration_id: p.id });
        expect(r.statusCode).toBe(200);
        const staff = read(`${B}/staff/${r.body.staff_id}`)!;
        expect(staff).toMatchObject({ name: 'สมชาย ใจดี', role: 'technician', phone: '0812345678', active: true, line_user_id: LINE_A });
        expect(pushed).toHaveLength(1);
        expect(pushed[0].to).toBe(LINE_A);
        expect(pushed[0].messages[0].text).toContain('อนุมัติแล้ว');
        expect(await pending()).toEqual([]);
        expect(await say(LINE_A, 'สวัสดี')).toContain('ลงทะเบียนเรียบร้อย');
        expect((await call('desk', { action: 'approve', registration_id: p.id })).body.error).toBe('already_decided');
        expect(listPaths(`users/${OWNER}/audit_logs/`).length).toBeGreaterThan(0);
    });

    it('suggests an existing staff record with the same phone, and can link to it instead of duplicating', async () => {
        seed(`${B}/staff/s1`, { id: 's1', name: 'ช่างสมชาย', phone: '081-234-5678', role: 'technician', active: true, line_user_id: null, linked_at: null, created_at: 'x' });
        await register();
        const [p] = await pending();
        expect(p.match).toBe('s1');
        const r = await call(OWNER, { action: 'approve', registration_id: p.id, link_staff_id: 's1' });
        expect(r.body.staff_id).toBe('s1');
        expect(read(`${B}/staff/s1`)).toMatchObject({ line_user_id: LINE_A, name: 'ช่างสมชาย' });
        expect(listPaths(`${B}/staff/`)).toHaveLength(1);
    });

    it('will not steal a staff record that is linked to another LINE account unless told to replace it', async () => {
        seed(`${B}/staff/s1`, { id: 's1', name: 'ช่างเอ', phone: '0899999999', role: 'technician', active: true, line_user_id: LINE_B, linked_at: 'x', created_at: 'x' });
        await register();
        const [p] = await pending();
        expect((await call(OWNER, { action: 'approve', registration_id: p.id, link_staff_id: 's1' })).body.error).toBe('staff_already_linked');
        expect((await call(OWNER, { action: 'approve', registration_id: p.id, link_staff_id: 'ghost' })).body.error).toBe('staff_not_found');
        expect((await call(OWNER, { action: 'approve', registration_id: p.id, link_staff_id: 's1', replace: true })).statusCode).toBe(200);
        expect(read(`${B}/staff/s1`)?.line_user_id).toBe(LINE_A);
    });

    it('rejecting tells them why, links nothing, and a rejected person is told so', async () => {
        await register();
        const [p] = await pending();
        expect((await call(OWNER, { action: 'reject', registration_id: p.id, reason: 'ไม่ใช่ช่างของเรา' })).statusCode).toBe(200);
        expect(pushed[0].messages[0].text).toContain('ไม่ได้รับอนุมัติ');
        expect(pushed[0].messages[0].text).toContain('ไม่ใช่ช่างของเรา');
        expect(listPaths(`${B}/staff/`)).toHaveLength(0);
        expect(await say(LINE_A, 'สวัสดี')).toContain('ไม่ได้รับอนุมัติ');
        const recent = (await call(OWNER, { action: 'list' })).body.recent;
        expect(recent[0]).toMatchObject({ status: 'rejected', reject_reason: 'ไม่ใช่ช่างของเรา' });
    });

    it('a technician cannot approve, and another property cannot decide this one\'s requests', async () => {
        await register();
        const [p] = await pending();
        expect((await call('tech', { action: 'approve', registration_id: p.id })).statusCode).toBe(403);
        expect((await call(OWNER, { action: 'approve', registration_id: p.id }, B2)).statusCode).toBe(404);
        expect((await call(OWNER, { action: 'approve' })).statusCode).toBe(400);
        expect((await call(OWNER, { action: 'nuke' })).statusCode).toBe(400);
    });
});

describe('connection status', () => {
    it('says whether the staff OA credentials exist, and what LINE itself reports', async () => {
        const realFetch = globalThis.fetch;
        globalThis.fetch = (async (url: string) => {
            if (url.endsWith('/info')) return { ok: true, json: async () => ({ basicId: '@horcare-staff', displayName: 'HorCare Maintenance' }) };
            return { ok: true, json: async () => ({ endpoint: 'https://hor-care.vercel.app/api/line-staff-webhook', active: true }) };
        }) as never;
        process.env.LINE_STAFF_CHANNEL_SECRET = 's';
        try {
            const r = await call(OWNER, { action: 'status' });
            expect(r.body).toMatchObject({ token_set: true, secret_set: true, basic_id: '@horcare-staff', display_name: 'HorCare Maintenance', webhook_active: true, webhook_matches: true });
            globalThis.fetch = (async () => { throw new Error('offline'); }) as never;
            const down = await call(OWNER, { action: 'status' });
            expect(down.body).toMatchObject({ token_set: true, basic_id: null, webhook_matches: null });
        } finally { globalThis.fetch = realFetch; delete process.env.LINE_STAFF_CHANNEL_SECRET; }
    });
});
