import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);
const pushed: { to: string; messages: any[] }[] = [];
vi.mock('./_line.js', async () => {
    const real = await vi.importActual<typeof import('./_line.js')>('./_line.js');
    return { ...real, roomLineToken: async () => 'tenant-token', linePush: async (to: string, messages: object[]) => { pushed.push({ to, messages }); } };
});

import handler from './_portal.js';
import { buildContractFlex, contractPeriod } from './_contract-line.js';
import { addAuthUser, fakeReq, fakeRes, listPaths, read, resetFake, seed } from './_fake-firestore.js';
import { permissionsForRole } from '../src/shared/permissions.js';

const OWNER = 'owner-1';
const BLD = 'bld-A';
const B = `users/${OWNER}/buildings/${BLD}`;
const LINE = 'U' + 'a'.repeat(32);
const draft = { id: 'c1', contract_number: 'C-1', title: 'สัญญาเช่าห้องพัก', contract_type: 'residential', lessee_name: 'สมชาย', unit_number: '101', rent_amount: 3500, rent_cycle: 'monthly', deposit_amount: 7000, start_date: '2026-12-01', end_date: '2027-11-30', clauses: [], status: 'draft' };

async function call(body: Record<string, unknown>, uid?: string) {
    const res = fakeRes();
    await handler(fakeReq({ action: 'contract_send', owner_uid: OWNER, building_id: BLD, room_id: 'r1', ...body }, uid), res as never);
    return res as { statusCode: number; body: any };
}

beforeEach(() => {
    resetFake(); pushed.length = 0;
    addAuthUser(OWNER, 'o@x.com', 'Owner');
    addAuthUser('tech', 't@x.com', 'Tech');
    seed(`users/${OWNER}`, { uid: OWNER });
    seed(B, { id: BLD, name: 'ตึก A' });
    seed(`${B}/data/config`, { bill_customization: { dorm_name: 'หอ A' } });
    seed(`${B}/rooms/r1`, { room_number: '101', line_user_id: LINE });
    seed(`${B}/rooms/r2`, { room_number: '102' });
    seed(`${B}/tenants/r1`, { full_name: 'สมชาย', signed_contract: draft });
    seed(`${B}/tenants/r2`, { full_name: 'สมหญิง', signed_contract: draft });
    seed(`users/${OWNER}/members/tech`, { uid: 'tech', role: 'technician', permissions: permissionsForRole('technician'), property_ids: ['*'], status: 'active' });
});

describe('contract_send', () => {
    it('pushes a sign card to the room\'s LINE and marks the draft as waiting for the tenant', async () => {
        const res = await call({}, OWNER);
        expect(res.statusCode).toBe(200);
        expect(pushed).toHaveLength(1);
        expect(pushed[0].to).toBe(LINE);
        const button = pushed[0].messages[0].contents.footer.contents[0].action;
        expect(button.uri).toMatch(/\?p=.+&action=sign$/);
        const saved = read(`${B}/tenants/r1`) as any;
        expect(saved.signed_contract.status).toBe('pending_lessee');
        expect(saved.signed_contract.sent_via_line_at).toBeTruthy();
        expect(listPaths(`${B}/tenants/r1/events/`).length).toBe(1);
    });

    it('says when the room has no LINE, so the app can offer the link instead', async () => {
        const res = await call({ room_id: 'r2' }, OWNER);
        expect(res.statusCode).toBe(409);
        expect(res.body.error).toBe('line_not_linked');
        expect(pushed).toHaveLength(0);
    });

    it('will not resend a contract the tenant already signed', async () => {
        seed(`${B}/tenants/r1`, { signed_contract: { ...draft, status: 'signed', lessee_signature: 'data:image/png;base64,x' } });
        expect((await call({}, OWNER)).statusCode).toBe(409);
        expect(pushed).toHaveLength(0);
    });

    it('needs tenant.update', async () => {
        expect((await call({}, 'tech')).statusCode).toBe(403);
        expect((await call({})).statusCode).toBe(401);
    });
});

describe('contract card', () => {
    it('shows the period with an open end', () => {
        expect(contractPeriod({ start_date: '2026-12-01' })).toMatch(/ไม่มีกำหนด$/);
        const flex = buildContractFlex(draft, 'หอ A', 'https://x/?p=a&action=sign') as any;
        expect(flex.altText).toContain('ห้อง 101');
    });
});
