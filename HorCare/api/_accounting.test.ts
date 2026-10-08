import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import ExcelJS from 'exceljs';
import handler, { billToDoc, legacyPayment } from './_accounting.js';
import { addAuthUser, fakeReq, fakeRes, listPaths, read, resetFake, seed } from './_fake-firestore.js';
import { permissionsForRole } from '../src/shared/permissions.js';
import { emptyProfile, type MangoProfile } from '../src/shared/accounting.js';

const OWNER = 'owner-1';
const B1 = 'bld-1';
const B2 = 'bld-2';
const b1 = `users/${OWNER}/buildings/${B1}`;

const goodProfile = (over: Partial<MangoProfile> = {}): Record<string, unknown> => {
    const p = emptyProfile('x');
    return {
        ...p, name: 'ตลาดทดสอบ', legal_entity_name: 'บริษัททดสอบ จำกัด', template_version: 'test-v1', property_ids: [B1], status: 'approved',
        codes: { ...p.codes, ar_account: 'AR-1', project: 'P1', job: 'J1' },
        revenue_accounts: { rent: 'REV-R', electric: 'REV-E', water: 'REV-W', common_fee: 'REV-C', fine: 'REV-F' },
        channels: { cash: { account: 'CASH-1', option_code: null }, 'bank:acc1': { account: 'BANK-1', option_code: 'OP1' } },
        customers: { r1: { code: 'C-001' }, r2: { code: 'C-002' } },
        ...over,
    };
};
const bill = (id: string, room: string, over: Record<string, unknown> = {}) => ({
    id, room_id: room, room_number: room.toUpperCase(), month: '2026-10', room_rent: 3000, elec_bill: 400, water_bill: 100, common_fee: 0, total_bill: 3500,
    is_saved: true, created_at: '2026-10-05T03:00:00Z', updated_at: '2026-10-05T03:00:00Z', payment_status: 'unpaid', ...over,
});

beforeEach(() => {
    resetFake();
    for (const [u, n] of [[OWNER, 'Owner'], ['fin', 'Fin'], ['desk', 'Desk'], ['mgr', 'Mgr'], ['stranger', 'S']]) addAuthUser(u, `${u}@x.com`, n);
    seed(`users/${OWNER}`, { uid: OWNER });
    for (const b of [B1, B2]) seed(`users/${OWNER}/buildings/${b}`, { id: b });
    seed(`${b1}/rooms/r1`, { room_number: 'R1' });
    seed(`${b1}/rooms/r2`, { room_number: 'R2' });
    seed(`${b1}/bank_accounts/acc1`, { id: 'acc1', status: 'active', bank_short: 'KBANK' });
    seed(`${b1}/bills/b1`, bill('b1', 'r1'));
    seed(`${b1}/bills/b2`, bill('b2', 'r2', { month: '2026-09', created_at: '2026-09-05T03:00:00Z' }));
    seed(`${b1}/bills/draft`, bill('draft', 'r1', { is_saved: false }));
    seed(`${b1}/fines/f1`, { id: 'f1', room_id: 'r1', room_number: 'R1', reason: 'x', amount: 500, date: '2026-10-07', status: 'unpaid', created_at: '2026-10-07T03:00:00Z' });
    for (const [uid, role, props] of [['fin', 'finance', ['*']], ['desk', 'front_desk', ['*']], ['mgr', 'property_manager', [B2]]] as const)
        seed(`users/${OWNER}/members/${uid}`, { uid, role, permissions: permissionsForRole(role), property_ids: props, status: 'active' });
});

async function call(uid: string | null, body: Record<string, unknown>) {
    const res = fakeRes();
    await handler(fakeReq({ owner_uid: OWNER, ...body }, uid ?? undefined), res as never);
    return res as { statusCode: number; body: any };
}
async function saveProfile(over: Partial<MangoProfile> = {}, uid: string | null = OWNER) {
    return call(uid, { action: 'profile_save', profile_id: 'prof1', profile: goodProfile(over) });
}
const run = (action: string, over: Record<string, unknown> = {}, uid: string | null = OWNER) =>
    call(uid, { action, profile_id: 'prof1', kind: 'invoice', from: '2026-09-01', to: '2026-10-31', ...over });
const batchDocs = () => listPaths(`users/${OWNER}/accounting_batches/`).filter(p => !p.includes('/items/'));

describe('profile_save', () => {
    it('owner may save; finance and desk may not (accounting.manage); anonymous is 401', async () => {
        expect((await saveProfile()).statusCode).toBe(200);
        expect((await saveProfile({}, 'fin')).statusCode).toBe(403);
        expect((await saveProfile({}, 'desk')).statusCode).toBe(403);
        expect((await saveProfile({}, null)).statusCode).toBe(401);
        expect(read(`users/${OWNER}/accounting_profiles/prof1`)).toMatchObject({ legal_entity_name: 'บริษัททดสอบ จำกัด', status: 'approved' });
        expect(listPaths(`users/${OWNER}/audit_logs/`).length).toBeGreaterThan(0);
    });

    it('a member must be allowed on EVERY property the profile covers', async () => {
        expect((await saveProfile({ property_ids: [B1, B2] }, 'mgr')).statusCode).toBe(403); // mgr only has B2
        expect((await saveProfile({ property_ids: [B2], status: 'draft' }, 'mgr')).statusCode).toBe(200);
    });

    it('cannot approve an incomplete profile, but can save it as a draft', async () => {
        const incomplete = { codes: { ...(goodProfile().codes as object), ar_account: 'AR', project: null, job: null } } as Partial<MangoProfile>;
        const r = await saveProfile(incomplete);
        expect(r.statusCode).toBe(409);
        expect(r.body.error).toBe('profile_incomplete');
        expect((await saveProfile({ ...incomplete, status: 'draft' })).body.gaps.map((g: any) => g.code)).toContain('dimension');
    });

    it('a property can belong to only one profile', async () => {
        await saveProfile();
        const r = await call(OWNER, { action: 'profile_save', profile_id: 'prof2', profile: goodProfile({ name: 'อื่น' }) });
        expect(r.body.error).toBe('property_in_other_profile');
    });

    it('rejects malformed input', async () => {
        for (const bad of [
            { name: 5 }, { property_ids: [] }, { property_ids: [1] }, { options: { invoice_date_basis: 'x' } },
            { revenue_accounts: { bogus: 'A' } }, { remarks: { invoice: 'x'.repeat(101), receipt: 'x' } },
        ]) {
            const p = { ...goodProfile(), ...bad };
            expect((await call(OWNER, { action: 'profile_save', profile_id: 'prof1', profile: p })).statusCode).toBe(400);
        }
        expect((await call(OWNER, { action: 'profile_save', profile: 'nope' })).statusCode).toBe(400);
    });
});

describe('preview', () => {
    beforeEach(async () => { await saveProfile(); });

    it('lists vouchers, exclusions and totals without storing anything', async () => {
        const r = await run('preview');
        expect(r.statusCode).toBe(200);
        expect(r.body.problems).toEqual([]);
        expect(r.body.summary).toMatchObject({ documents: 3, dr_satang: 350000 * 2 + 50000 });
        expect(r.body.excluded.map((e: any) => e.reason)).toEqual(['draft']);
        expect(batchDocs()).toHaveLength(0);
    });

    it('reports missing mappings instead of guessing', async () => {
        await saveProfile({ customers: { r1: { code: 'C-001' } } as never });
        const r = await run('preview');
        expect(r.body.problems.map((p: any) => p.code)).toContain('no_customer_code');
    });

    it('needs accounting.export: finance yes, front desk no, stranger no', async () => {
        expect((await run('preview', {}, 'fin')).statusCode).toBe(200);
        expect((await run('preview', {}, 'desk')).statusCode).toBe(403);
        expect((await run('preview', {}, 'stranger')).statusCode).toBe(403);
        expect((await run('preview', {}, null)).statusCode).toBe(401);
    });

    it('validates dates and kind', async () => {
        for (const bad of [{ from: 'x' }, { to: '2026-08-01' }, { kind: 'credit_note' }]) expect((await run('preview', bad)).statusCode).toBe(400);
        expect((await call(OWNER, { action: 'preview', profile_id: 'ghost', kind: 'invoice', from: '2026-10-01', to: '2026-10-31' })).statusCode).toBe(404);
    });
});

describe('create_batch / download / confirm_import', () => {
    beforeEach(async () => { await saveProfile(); });

    it('creates a ready batch with items, and the downloaded workbook matches the totals', async () => {
        const r = await run('create_batch');
        expect(r.statusCode).toBe(200);
        expect(r.body.batch).toMatchObject({ status: 'ready', import_outcome: 'unknown', vouchers_count: 3, dr_satang: 750000, cr_satang: 750000 });
        expect(listPaths(`users/${OWNER}/accounting_batches/${r.body.batch.id}/items/`)).toHaveLength(3);
        const dl = await call('fin', { action: 'download', batch_id: r.body.batch.id });
        expect(dl.statusCode).toBe(200);
        const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(dl.body.base64, 'base64') as unknown as ArrayBuffer);
        const ws = wb.getWorksheet('My sheet')!;
        let dr = 0, cr = 0;
        ws.eachRow((row, n) => { if (n >= 8) { dr += Number(row.getCell(18).value ?? 0); cr += Number(row.getCell(19).value ?? 0); } });
        expect([dr, cr]).toEqual([7500, 7500]);
        expect(listPaths(`users/${OWNER}/audit_logs/`).map(p => read(p)!).some(l => l.action === 'DOWNLOAD')).toBe(true);
    });

    it('the same request twice (double click) reuses the batch; a later run excludes what was exported', async () => {
        const a = await run('create_batch');
        const b = await run('create_batch');
        expect(b.body.reused).toBe(true);
        expect(batchDocs()).toHaveLength(1);
        expect(b.body.batch.id).toBe(a.body.batch.id);
        const again = await run('create_batch');
        expect(again.statusCode).toBe(200);
        const preview = await run('preview');
        expect(preview.body.summary.documents).toBe(0);
        expect(preview.body.excluded.filter((e: any) => e.reason === 'already_exported')).toHaveLength(3);
        expect((await run('create_batch')).body.reused).toBe(true);
    });

    it('nothing is exported when anything is blocked (no silent partial export)', async () => {
        await saveProfile({ customers: { r1: { code: 'C-001' } } as never });
        const r = await run('create_batch');
        expect(r.statusCode).toBe(409);
        expect(r.body.error).toBe('blocked');
        expect(batchDocs()).toHaveLength(0);
    });

    it('a draft profile cannot create files, and a bill edited after export is blocked', async () => {
        await saveProfile({ status: 'draft' });
        expect((await run('create_batch')).body.error).toBe('profile_not_approved');
        await saveProfile();
        await run('create_batch');
        seed(`${b1}/bills/b1`, bill('b1', 'r1', { room_rent: 3100, total_bill: 3600 }));
        const p = await run('preview');
        expect(p.body.problems.map((x: any) => x.code)).toContain('revised_after_export');
    });

    it('confirm_import records the outcome; failed needs a note; a failed batch lets the documents be exported again', async () => {
        const id = (await run('create_batch')).body.batch.id;
        expect((await call(OWNER, { action: 'confirm_import', batch_id: id, outcome: 'failed' })).body.error).toBe('note_required');
        expect((await call(OWNER, { action: 'confirm_import', batch_id: id, outcome: 'maybe' })).statusCode).toBe(400);
        expect((await call(OWNER, { action: 'confirm_import', batch_id: id, outcome: 'failed', note: 'Mango ไม่รับรหัสบัญชี' })).statusCode).toBe(200);
        expect(read(`users/${OWNER}/accounting_batches/${id}`)).toMatchObject({ import_outcome: 'failed', import_note: 'Mango ไม่รับรหัสบัญชี' });
        expect((await run('preview')).body.summary.documents).toBe(3);
        expect((await call('desk', { action: 'confirm_import', batch_id: id, outcome: 'confirmed' })).statusCode).toBe(403);
    });

    it('changing the profile afterwards does not change an existing batch (snapshot)', async () => {
        const id = (await run('create_batch')).body.batch.id;
        await saveProfile({ revenue_accounts: { rent: 'CHANGED', electric: 'E', water: 'W', common_fee: 'C', fine: 'F' } });
        const dl = await call(OWNER, { action: 'download', batch_id: id });
        const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(dl.body.base64, 'base64') as unknown as ArrayBuffer);
        const accounts: string[] = [];
        wb.getWorksheet('My sheet')!.eachRow((row, n) => { if (n >= 8) accounts.push(String(row.getCell(9).value)); });
        expect(accounts).toContain('REV-R');
        expect(accounts).not.toContain('CHANGED');
    });

    it('another owner cannot touch this batch', async () => {
        const id = (await run('create_batch')).body.batch.id;
        addAuthUser('other', 'o@x.com');
        const res = fakeRes();
        await handler(fakeReq({ action: 'download', owner_uid: OWNER, batch_id: id }, 'other'), res as never);
        expect(res.statusCode).toBe(403);
    });
});

describe('receipts end to end (AT-03, AT-04)', () => {
    beforeEach(async () => { await saveProfile(); });
    const pay = (over: Record<string, unknown> = {}, uid: string | null = OWNER) =>
        call(uid, { action: 'record_payment', building_id: B1, room_id: 'r1', method: 'cash', paid_at: '2026-10-07T03:00:00Z', allocations: [{ kind: 'bill', id: 'b1', amount: 3500 }], ...over });

    it('a legacy paid bill is exported as a receipt once its invoice is exported', async () => {
        seed(`${b1}/bills/b1`, bill('b1', 'r1', { payment_status: 'paid', paid_at: '2026-10-07T03:00:00Z', payment_method: 'cash', paid_amount: 3500 }));
        const blocked = await run('preview', { kind: 'receipt' });
        expect(blocked.body.problems.map((p: any) => p.code)).toContain('invoice_not_in_mango');
        await run('create_batch');
        const r = await run('create_batch', { kind: 'receipt' });
        expect(r.statusCode).toBe(200);
        expect(r.body.batch.dr_satang).toBe(350000);
    });

    it('partial payment: only what was received is exported, the bill stays unpaid until fully allocated', async () => {
        await run('create_batch');
        expect((await pay({ allocations: [{ kind: 'bill', id: 'b1', amount: 1500 }] })).statusCode).toBe(200);
        expect(read(`${b1}/bills/b1`)).toMatchObject({ allocated_satang: 150000, payment_status: 'unpaid', payments_recorded: true });
        const r = await run('create_batch', { kind: 'receipt' });
        expect(r.body.batch.dr_satang).toBe(150000);
        expect((await pay({ allocations: [{ kind: 'bill', id: 'b1', amount: 2000 }] })).statusCode).toBe(200);
        expect(read(`${b1}/bills/b1`)).toMatchObject({ allocated_satang: 350000, payment_status: 'paid' });
        const second = await run('create_batch', { kind: 'receipt' });
        expect(second.body.batch.dr_satang).toBe(200000);
    });

    it('one payment can settle several bills of the same customer', async () => {
        seed(`${b1}/bills/b3`, bill('b3', 'r1', { month: '2026-08', created_at: '2026-08-05T03:00:00Z' }));
        await run('create_batch', { from: '2026-08-01' });
        const r = await pay({ allocations: [{ kind: 'bill', id: 'b1', amount: 3500 }, { kind: 'bill', id: 'b3', amount: 3500 }] });
        expect(r.statusCode).toBe(200);
        expect(r.body.payment.gross_satang).toBe(700000);
        const batch = await run('create_batch', { kind: 'receipt' });
        expect(batch.body.batch).toMatchObject({ vouchers_count: 1, dr_satang: 700000 });
    });

    it('rejects over-payment, wrong room, drafts, bad amounts, future dates, duplicates, and missing bank account', async () => {
        expect((await pay({ allocations: [{ kind: 'bill', id: 'b1', amount: 3500.01 }] })).body.error).toBe('exceeds_outstanding');
        expect((await pay({ allocations: [{ kind: 'bill', id: 'b2', amount: 10 }] })).body.error).toBe('target_wrong_room');
        expect((await pay({ allocations: [{ kind: 'bill', id: 'draft', amount: 10 }] })).body.error).toBe('target_not_issued');
        expect((await pay({ allocations: [{ kind: 'bill', id: 'ghost', amount: 10 }] })).body.error).toBe('target_not_found');
        for (const bad of [
            { allocations: [] }, { allocations: [{ kind: 'bill', id: 'b1', amount: 0 }] }, { allocations: [{ kind: 'bill', id: 'b1', amount: -5 }] },
            { allocations: [{ kind: 'room', id: 'b1', amount: 5 }] }, { allocations: [{ kind: 'bill', id: 'b1', amount: 5 }, { kind: 'bill', id: 'b1', amount: 5 }] },
            { paid_at: '2999-01-01T00:00:00Z' }, { paid_at: 'nope' }, { method: 'barter' }, { note: 'x'.repeat(201) },
        ]) expect((await pay(bad)).statusCode).toBe(400);
        expect((await pay({ method: 'bank_transfer' })).body.error).toBe('bank_account_required');
        expect((await pay({ method: 'bank_transfer', bank_account_id: 'ghost' })).body.error).toBe('bank_account_invalid');
        expect(listPaths(`${b1}/payments/`)).toHaveLength(0);
    });

    it('recording a payment needs payment.create on that property', async () => {
        expect((await pay({}, 'desk')).statusCode).toBe(200); // front desk has payment.create
        expect((await pay({}, 'stranger')).statusCode).toBe(403);
        expect((await pay({}, null)).statusCode).toBe(401);
        expect((await call('mgr', { action: 'record_payment', building_id: B1, room_id: 'r1', method: 'cash', paid_at: '2026-10-07T03:00:00Z', allocations: [{ kind: 'bill', id: 'b1', amount: 1 }] })).statusCode).toBe(403);
    });

    it('a bank transfer is not exported as money until verified against a real bank transaction', async () => {
        await run('create_batch');
        const p = (await pay({ method: 'bank_transfer', bank_account_id: 'acc1' })).body.payment;
        expect(p.verification).toBe('unverified');
        expect((await run('preview', { kind: 'receipt' })).body.excluded.map((e: any) => e.reason)).toContain('unverified');
        // wrong amount / account / already used
        seed(`${b1}/bank_transactions/t-bad`, { id: 't-bad', amount: 3499, bank_account_id: 'acc1', status: 'unmatched' });
        seed(`${b1}/bank_transactions/t-acc`, { id: 't-acc', amount: 3500, bank_account_id: 'other', status: 'unmatched' });
        seed(`${b1}/bank_transactions/t-ok`, { id: 't-ok', amount: 3500, bank_account_id: 'acc1', status: 'matched' });
        const verify = (tx: string, uid: string | null = 'fin') => call(uid, { action: 'verify_payment', building_id: B1, payment_id: p.id, bank_transaction_id: tx });
        expect((await verify('t-bad')).body.error).toBe('amount_mismatch');
        expect((await verify('t-acc')).body.error).toBe('account_mismatch');
        expect((await verify('t-ok', 'desk')).statusCode).toBe(403);
        expect((await verify('t-ok')).statusCode).toBe(200);
        expect(read(`${b1}/bank_transactions/t-ok`)).toMatchObject({ status: 'reconciled', payment_id: p.id });
        expect((await verify('t-ok')).body.error).toBe('transaction_already_used');
        const r = await run('create_batch', { kind: 'receipt' });
        expect(r.body.batch.dr_satang).toBe(350000);
        expect(r.body.batch.profile_snapshot.channels['bank:acc1'].option_code).toBe('OP1');
    });
});

describe('conversion helpers', () => {
    it('billToDoc builds lines that add up to the total, ignoring zero components', () => {
        const d = billToDoc(bill('x', 'r1') as never);
        expect(d.lines.map(l => [l.category, l.amount_satang])).toEqual([['rent', 300000], ['electric', 40000], ['water', 10000]]);
        expect(d.lines.reduce((s, l) => s + l.amount_satang, 0)).toBe(d.total_satang);
    });
    it('the revision ignores payment fields so paying a bill never looks like an edit', () => {
        const a = billToDoc(bill('x', 'r1') as never).revision;
        const b = billToDoc(bill('x', 'r1', { payment_status: 'paid', paid_at: 'now', updated_at: 'later' }) as never).revision;
        expect(a).toBe(b);
    });
    it('legacyPayment only exists for paid, not-yet-migrated items', () => {
        expect(legacyPayment('bill', bill('x', 'r1') as never)).toBeNull();
        expect(legacyPayment('bill', bill('x', 'r1', { payment_status: 'paid', payments_recorded: true }) as never)).toBeNull();
        const l = legacyPayment('bill', bill('x', 'r1', { payment_status: 'paid', paid_amount: 3500, slip_ref: 'r', verification_status: 'verified', bank_account_id: 'acc1', paid_at: '2026-10-07T00:00:00Z' }) as never)!;
        expect(l).toMatchObject({ method: 'bank_transfer', channel: 'bank:acc1', gross_satang: 350000, verification: 'verified' });
    });
});