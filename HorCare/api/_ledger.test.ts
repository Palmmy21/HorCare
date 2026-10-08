import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import handler, { cleanLedger } from './_ledger.js';
import { addAuthUser, fakeReq, fakeRes, listPaths, read, resetFake, seed } from './_fake-firestore.js';
import { permissionsForRole } from '../src/shared/permissions.js';
import { emptyLedger, trialBalance, trialTotals, type JournalEntry, type Ledger } from '../src/shared/ledger.js';
import { todayTh } from '../src/shared/market.js';

const OWNER = 'owner-1';
const B1 = 'bld-1';
const B2 = 'bld-2';
const b1 = `users/${OWNER}/buildings/${B1}`;
const today = todayTh();

const bill = (id: string, room: string, over: Record<string, unknown> = {}) => ({
    id, room_id: room, room_number: room.toUpperCase(), month: '2026-10', room_rent: 3000, elec_bill: 400, water_bill: 100, common_fee: 0, total_bill: 3500,
    is_saved: true, created_at: '2026-10-05T03:00:00Z', updated_at: '2026-10-05T03:00:00Z', payment_status: 'unpaid', ...over,
});
const goodLedger = (over: Partial<Ledger> = {}): Ledger => ({ ...emptyLedger('x'), name: 'บัญชีตลาด', legal_entity_name: 'บริษัททดสอบ', property_ids: [B1], ...over });

beforeEach(() => {
    resetFake();
    for (const [u, n] of [[OWNER, 'Owner'], ['fin', 'Fin'], ['desk', 'Desk'], ['mgr', 'Mgr'], ['stranger', 'S']]) addAuthUser(u, `${u}@x.com`, n);
    seed(`users/${OWNER}`, { uid: OWNER });
    for (const b of [B1, B2]) seed(`users/${OWNER}/buildings/${b}`, { id: b });
    seed(`${b1}/rooms/r1`, { room_number: 'R1' });
    seed(`${b1}/rooms/r2`, { room_number: 'R2' });
    seed(`${b1}/bills/b1`, bill('b1', 'r1'));
    seed(`${b1}/bills/b2`, bill('b2', 'r2', { month: '2026-09', created_at: '2026-09-05T03:00:00Z' }));
    seed(`${b1}/bills/draft`, bill('draft', 'r1', { is_saved: false }));
    for (const [uid, role, props] of [['fin', 'finance', ['*']], ['desk', 'front_desk', ['*']], ['mgr', 'property_manager', [B2]]] as const)
        seed(`users/${OWNER}/members/${uid}`, { uid, role, permissions: permissionsForRole(role), property_ids: props, status: 'active' });
});

async function call(uid: string | null, body: Record<string, unknown>) {
    const res = fakeRes();
    await handler(fakeReq({ owner_uid: OWNER, ...body }, uid ?? undefined), res as never);
    return res as { statusCode: number; body: any };
}
const save = (over: Partial<Ledger> = {}, uid: string | null = OWNER) => call(uid, { action: 'ledger_save', ledger_id: 'led1', ledger: goodLedger(over) });
const run = (action: string, over: Record<string, unknown> = {}, uid: string | null = OWNER) =>
    call(uid, { action, ledger_id: 'led1', kind: 'invoice', from: '2026-09-01', to: '2026-10-31', ...over });
const entries = () => listPaths(`users/${OWNER}/ledgers/led1/entries/`).map(p => read(p)! as unknown as JournalEntry);

describe('ledger_save', () => {
    it('owner and manager (ledger.manage) may save; finance, desk, strangers and anonymous may not', async () => {
        expect((await save()).statusCode).toBe(200);
        expect((await save({}, 'fin')).statusCode).toBe(403);
        expect((await save({}, 'desk')).statusCode).toBe(403);
        expect((await save({}, 'stranger')).statusCode).toBe(403);
        expect((await save({}, null)).statusCode).toBe(401);
        expect(read(`users/${OWNER}/ledgers/led1`)).toMatchObject({ name: 'บัญชีตลาด', locked_through: null });
        expect(listPaths(`users/${OWNER}/audit_logs/`).length).toBeGreaterThan(0);
    });

    it('a member must be allowed on every property of the ledger', async () => {
        expect((await save({ property_ids: [B1, B2] }, 'mgr')).statusCode).toBe(403);
    });

    it('rejects a broken chart and malformed input; a property belongs to one ledger', async () => {
        const dup = [...goodLedger().accounts, { code: '1101', name: 'ซ้ำ', type: 'asset' as const, active: true }];
        expect((await save({ accounts: dup })).body.error).toBe('invalid_chart');
        expect((await save({ property_ids: [] })).statusCode).toBe(400);
        expect((await call(OWNER, { action: 'ledger_save', ledger: 'nope' })).statusCode).toBe(400);
        await save();
        const other = await call(OWNER, { action: 'ledger_save', ledger_id: 'led2', ledger: goodLedger({ name: 'อื่น' }) });
        expect(other.body.error).toBe('property_in_other_ledger');
    });

    it('an incomplete ledger can be saved as a draft and reports its gaps', async () => {
        const r = await save({ legal_entity_name: '' });
        expect(r.statusCode).toBe(200);
        expect(r.body.gaps.map((g: any) => g.code)).toContain('entity');
    });

    it('cannot drop or retype an account that already has entries', async () => {
        await save();
        await run('post');
        const without = goodLedger().accounts.filter(a => a.code !== '4101');
        expect((await save({ accounts: without })).body.error).toBe('account_in_use');
        const retyped = goodLedger().accounts.map(a => (a.code === '4101' ? { ...a, type: 'expense' as const } : a));
        expect((await save({ accounts: retyped })).body.error).toBe('account_in_use');
        const renamed = goodLedger().accounts.map(a => (a.code === '4101' ? { ...a, name: 'ค่าเช่า (ใหม่)', active: false } : a));
        expect((await save({ accounts: renamed })).statusCode).toBe(200);
    });

    it('saving never changes the period lock', async () => {
        await save();
        await call(OWNER, { action: 'lock_period', ledger_id: 'led1', through: today });
        await save({ name: 'เปลี่ยนชื่อ', locked_through: null });
        expect(read(`users/${OWNER}/ledgers/led1`)!.locked_through).toBe(today);
    });
});

describe('posting', () => {
    beforeEach(async () => { await save(); });

    it('preview shows what would be posted without writing anything', async () => {
        const r = await run('post_preview');
        expect(r.statusCode).toBe(200);
        expect(r.body.summary).toMatchObject({ documents: 2, dr_satang: 700000, cr_satang: 700000, problems: 0 });
        expect(r.body.excluded.map((e: any) => e.reason)).toEqual(['draft']);
        expect(entries()).toHaveLength(0);
    });

    it('posts balanced entries with receivable lines tagged by room, and the trial balance balances', async () => {
        const r = await run('post');
        expect(r.body).toMatchObject({ posted: 2, skipped: 0 });
        const es = entries();
        expect(es).toHaveLength(2);
        const e = es.find(x => x.sources[0].id === 'b1')!;
        expect(e).toMatchObject({ kind: 'invoice', date: '2026-10-05', total_satang: 350000, posted_by: OWNER });
        expect(e.lines[0]).toMatchObject({ account: '1140', dr_satang: 350000, party_id: 'r1' });
        expect(e.lines.slice(1).map(l => [l.account, l.cr_satang])).toEqual([['4101', 300000], ['4102', 40000], ['4103', 10000]]);
        const t = trialTotals(trialBalance(es, goodLedger().accounts));
        expect(t.dr_satang).toBe(t.cr_satang);
    });

    it('needs no customer codes, and posting twice never duplicates (idempotent)', async () => {
        await run('post');
        const again = await run('post');
        expect(again.statusCode).toBe(409);
        expect(again.body.error).toBe('nothing_to_post');
        expect(entries()).toHaveLength(2);
        expect((await run('post_preview')).body.summary.documents).toBe(0);
    });

    it('blocks the whole run when anything is blocked, and says why', async () => {
        await save({ posting: { ...goodLedger().posting, revenue_accounts: { rent: '4101' } } });
        const r = await run('post');
        expect(r.statusCode).toBe(409);
        expect(r.body.error).toBe('blocked');
        expect(r.body.detail.problems.map((p: any) => p.code)).toContain('no_revenue_account');
        expect(entries()).toHaveLength(0);
    });

    it('refuses to post from an incomplete ledger', async () => {
        await save({ legal_entity_name: '' });
        expect((await run('post')).body.error).toBe('ledger_incomplete');
    });

    it('permissions: finance may post, front desk and strangers may not, anonymous is 401', async () => {
        expect((await run('post_preview', {}, 'fin')).statusCode).toBe(200);
        expect((await run('post', {}, 'desk')).statusCode).toBe(403);
        expect((await run('post', {}, 'stranger')).statusCode).toBe(403);
        expect((await run('post', {}, null)).statusCode).toBe(401);
        expect((await run('post', { ledger_id: 'ghost' })).statusCode).toBe(404);
        for (const bad of [{ kind: 'credit' }, { from: 'x' }, { to: '2026-01-01' }]) expect((await run('post', bad)).statusCode).toBe(400);
    });

    it('a closed period accepts no new entries', async () => {
        await call(OWNER, { action: 'lock_period', ledger_id: 'led1', through: today });
        const r = await run('post');
        expect(r.statusCode).toBe(409);
        expect(r.body.detail.problems.map((p: any) => p.code)).toContain('period_locked');
        expect(entries()).toHaveLength(0);
    });

    it('a bill edited after posting is flagged, and can be posted again after the old entry is reversed', async () => {
        await run('post');
        seed(`${b1}/bills/b1`, bill('b1', 'r1', { room_rent: 3100, total_bill: 3600 }));
        const flagged = await run('post_preview');
        expect(flagged.body.problems.map((p: any) => p.code)).toContain('revised_after_export');
        const old = entries().find(e => e.sources[0].id === 'b1')!;
        expect((await call('fin', { action: 'reverse', ledger_id: 'led1', entry_id: old.id, reason: 'แก้ยอดบิล' })).statusCode).toBe(200);
        const again = await run('post');
        expect(again.body.posted).toBe(1);
        const net = trialBalance(entries(), goodLedger().accounts).find(r => r.account.code === '1140')!;
        expect(net.balance_satang).toBe(360000 + 350000); // b1 new + b2
    });
});

describe('receipts post against posted invoices', () => {
    beforeEach(async () => {
        await save({ posting: { ...goodLedger().posting, channels: { cash: '1101', 'bank:acc1': '1102' } } });
        seed(`${b1}/bank_accounts/acc1`, { id: 'acc1', status: 'active', bank_short: 'KBANK' });
    });
    // record_payment lives in /api/accounting; it only writes data the ledger then reads
    it('a recorded payment posts as Dr cash / Cr receivable once its invoice is in the books', async () => {
        const acct = (await import('./_accounting.js')).default;
        const res = fakeRes();
        await acct(fakeReq({ owner_uid: OWNER, action: 'record_payment', building_id: B1, room_id: 'r1', method: 'cash', paid_at: '2026-10-07T03:00:00Z', allocations: [{ kind: 'bill', id: 'b1', amount: 1500 }] }, OWNER), res as never);
        expect(res.statusCode).toBe(200);
        const early = await run('post', { kind: 'receipt' });
        expect(early.body.detail.problems.map((p: any) => p.code)).toContain('invoice_not_in_mango');
        await run('post');
        const r = await run('post', { kind: 'receipt' });
        expect(r.body.posted).toBe(1);
        const e = entries().find(x => x.kind === 'receipt')!;
        expect(e.lines.map(l => [l.account, l.dr_satang, l.cr_satang, l.party_id])).toEqual([['1101', 150000, 0, null], ['1140', 0, 150000, 'r1']]);
        const t = trialBalance(entries(), goodLedger().accounts);
        expect(t.find(x => x.account.code === '1140')!.balance_satang).toBe(700000 - 150000);
    });
});

describe('reverse', () => {
    let id: string;
    beforeEach(async () => { await save(); await run('post'); id = entries().find(e => e.sources[0].id === 'b1')!.id; });
    const rev = (over: Record<string, unknown> = {}, uid: string | null = OWNER) => call(uid, { action: 'reverse', ledger_id: 'led1', entry_id: id, reason: 'ผิดบิล', ...over });

    it('posts the opposite entry, marks the original, and net effect is zero', async () => {
        const r = await rev();
        expect(r.statusCode).toBe(200);
        expect(r.body.entry).toMatchObject({ kind: 'reversal', reversal_of: id, total_satang: 350000 });
        expect(read(`users/${OWNER}/ledgers/led1/entries/${id}`)!.reversed_by).toBe(r.body.entry.id);
        const es = entries().filter(e => e.id === id || e.reversal_of === id);
        const ar = trialBalance(es, goodLedger().accounts).find(x => x.account.code === '1140')!;
        expect(ar.balance_satang).toBe(0);
    });

    it('once only; never a reversal of a reversal; reason required; permissions', async () => {
        expect((await rev({ reason: '' })).body.error).toBe('reason_required');
        const first = await rev();
        expect((await rev()).body.error).toBe('already_reversed');
        expect((await call(OWNER, { action: 'reverse', ledger_id: 'led1', entry_id: first.body.entry.id, reason: 'x' })).body.error).toBe('cannot_reverse_a_reversal');
        expect((await call(OWNER, { action: 'reverse', ledger_id: 'led1', entry_id: 'ghost', reason: 'x' })).statusCode).toBe(404);
        expect((await rev({}, 'desk')).statusCode).toBe(403);
    });

    it('refuses dates in a closed period, before the original, or in the future', async () => {
        expect((await rev({ date: '2026-10-01' })).statusCode).toBe(400); // before the entry's own date
        expect((await rev({ date: '2999-01-01' })).statusCode).toBe(400);
        await call(OWNER, { action: 'lock_period', ledger_id: 'led1', through: today });
        expect((await rev()).body.error).toBe('period_locked');
    });
});

describe('manual entries', () => {
    beforeEach(async () => { await save(); });
    const manual = (over: Record<string, unknown> = {}, uid: string | null = OWNER) => call(uid, {
        action: 'manual_entry', ledger_id: 'led1', date: today, memo: 'ค่าใช้จ่ายทั่วไป',
        lines: [{ account: '5101', debit: 250.5 }, { account: '1101', credit: 250.5 }], ...over,
    });

    it('records a balanced adjustment in satang', async () => {
        const r = await manual();
        expect(r.statusCode).toBe(200);
        expect(r.body.entry).toMatchObject({ kind: 'manual', total_satang: 25050 });
        expect(r.body.entry.lines.map((l: any) => [l.account, l.dr_satang, l.cr_satang])).toEqual([['5101', 25050, 0], ['1101', 0, 25050]]);
    });

    it('rejects unbalanced, unknown-account, both-sided, huge, future, missing-memo entries', async () => {
        for (const bad of [
            { lines: [{ account: '5101', debit: 100 }, { account: '1101', credit: 99 }] },
            { lines: [{ account: '9999', debit: 100 }, { account: '1101', credit: 100 }] },
            { lines: [{ account: '5101', debit: 100, credit: 100 }, { account: '1101' }] },
            { lines: [{ account: '5101', debit: 1e12 }, { account: '1101', credit: 1e12 }] },
            { lines: [{ account: '5101', debit: -5 }, { account: '1101', credit: -5 }] },
            { lines: [{ account: '5101', debit: 100 }] },
            { lines: 'x' }, { date: '2999-01-01' }, { memo: '' },
        ]) expect((await manual(bad)).statusCode).toBe(400);
        expect(entries()).toHaveLength(0);
    });

    it('needs ledger.post and an open period', async () => {
        expect((await manual({}, 'desk')).statusCode).toBe(403);
        expect((await manual({}, 'fin')).statusCode).toBe(200);
        await call(OWNER, { action: 'lock_period', ledger_id: 'led1', through: today });
        expect((await manual()).body.error).toBe('period_locked');
    });
});

describe('periods', () => {
    beforeEach(async () => { await save(); });
    it('locking moves forward only; reopening needs a reason, is audited, and lowers the lock', async () => {
        const lock = (through: string, uid: string | null = OWNER) => call(uid, { action: 'lock_period', ledger_id: 'led1', through });
        expect((await lock('2026-09-30')).statusCode).toBe(200);
        expect((await lock('2026-09-01')).body.error).toBe('use_unlock_to_reopen');
        expect((await lock('2999-01-01')).statusCode).toBe(400);
        expect((await lock('2026-09-30', 'fin')).statusCode).toBe(403);
        expect((await call(OWNER, { action: 'unlock_period', ledger_id: 'led1', through: '2026-08-31' })).body.error).toBe('reason_required');
        expect((await call(OWNER, { action: 'unlock_period', ledger_id: 'led1', through: '2026-10-31', reason: 'x' })).statusCode).toBe(400);
        expect((await call(OWNER, { action: 'unlock_period', ledger_id: 'led1', through: '2026-08-31', reason: 'พบรายการตกหล่น' })).statusCode).toBe(200);
        expect(read(`users/${OWNER}/ledgers/led1`)!.locked_through).toBe('2026-08-31');
        expect(listPaths(`users/${OWNER}/audit_logs/`).map(p => read(p)!).some(l => String(l.note).includes('reopened'))).toBe(true);
    });
});

describe('cleanLedger', () => {
    it('keeps valid ledgers and rejects bad fields', () => {
        expect(cleanLedger(goodLedger(), 'x')).not.toBeNull();
        for (const bad of [{ name: 5 }, { accounts: 'x' }, { posting: { ar_account: 5 } }, { options: { invoice_date_basis: 'now', count_unverified_transfers: false } }]) {
            expect(cleanLedger({ ...goodLedger(), ...bad }, 'x')).toBeNull();
        }
    });
});