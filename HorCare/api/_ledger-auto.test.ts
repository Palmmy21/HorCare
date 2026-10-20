import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./_firebase.js', async () => (await import('./_fake-firestore.js')).firebaseMock);

import ledgerHandler from './_ledger.js';
import { autoPostBuilding } from './_ledger-auto.js';
import { addAuthUser, fakeReq, fakeRes, listPaths, read, resetFake, seed } from './_fake-firestore.js';
import { emptyLedger, type JournalEntry, type Ledger } from '../src/shared/ledger.js';

const OWNER = 'owner-1';
const B1 = 'bld-1';
const b1 = `users/${OWNER}/buildings/${B1}`;
const NOW = new Date('2026-10-20T05:00:00Z');

const bill = (id: string, room: string, over: Record<string, unknown> = {}) => ({
    id, room_id: room, room_number: room.toUpperCase(), month: '2026-10', room_rent: 3000, elec_bill: 400, water_bill: 100, common_fee: 0, total_bill: 3500,
    is_saved: true, created_at: '2026-10-05T03:00:00Z', updated_at: '2026-10-05T03:00:00Z', payment_status: 'unpaid', ...over,
});
const goodLedger = (over: Partial<Ledger> = {}): Ledger => ({ ...emptyLedger('x'), name: 'บัญชีหอ', legal_entity_name: 'บริษัททดสอบ', property_ids: [B1], ...over });
const entries = () => listPaths(`users/${OWNER}/ledgers/led1/entries/`).map(p => read(p)! as unknown as JournalEntry);

async function saveLedger(over: Partial<Ledger> = {}) {
    const res = fakeRes();
    await ledgerHandler(fakeReq({ owner_uid: OWNER, action: 'ledger_save', ledger_id: 'led1', ledger: goodLedger(over) }, OWNER), res as never);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(200);
}

beforeEach(() => {
    resetFake();
    addAuthUser(OWNER, 'o@x.com', 'Owner');
    seed(`users/${OWNER}`, { uid: OWNER });
    seed(b1, { id: B1 });
    seed(`${b1}/rooms/r1`, { room_number: 'R1' });
    seed(`${b1}/rooms/r2`, { room_number: 'R2' });
    seed(`${b1}/bills/b1`, bill('b1', 'r1'));
    seed(`${b1}/bills/b2`, bill('b2', 'r2', {
        payment_status: 'paid', payment_method: 'cash', paid_method: 'manual', paid_amount: 3500, paid_at: '2026-10-10T04:00:00Z',
    }));
});

describe('autoPostBuilding', () => {
    it('posts new invoices and receipts once, and records how the run went on the ledger', async () => {
        await saveLedger();
        const r = await autoPostBuilding(OWNER, B1, NOW);
        expect(r?.posted).toBeGreaterThanOrEqual(2);
        const kinds = entries().map(e => e.kind).sort();
        expect(kinds.filter(k => k === 'invoice')).toHaveLength(2);
        expect(kinds.filter(k => k === 'receipt')).toHaveLength(1); // the cash payment
        expect(entries().every(e => e.posted_by === 'system')).toBe(true);
        expect(read(`users/${OWNER}/ledgers/led1`)).toMatchObject({ auto_post: { posted: r!.posted } });

        const again = await autoPostBuilding(OWNER, B1, NOW);
        expect(again?.posted).toBe(0);
        expect(entries()).toHaveLength(r!.posted);
    });

    it('does nothing when the ledger turned it off, or the building has no ledger', async () => {
        await saveLedger({ options: { ...emptyLedger('x').options, auto_post: false } });
        expect(read(`users/${OWNER}/ledgers/led1`)).toMatchObject({ options: { auto_post: false } });
        expect(await autoPostBuilding(OWNER, B1, NOW)).toBeNull();
        expect(await autoPostBuilding(OWNER, 'other-bld', NOW)).toBeNull();
        expect(entries()).toHaveLength(0);
    });

    it('an incomplete ledger posts nothing but says why', async () => {
        await saveLedger({ legal_entity_name: '' });
        const r = await autoPostBuilding(OWNER, B1, NOW);
        expect(r?.posted).toBe(0);
        expect(r?.problems.length).toBeGreaterThan(0);
        expect(read(`users/${OWNER}/ledgers/led1`)).toMatchObject({ auto_post: { posted: 0 } });
    });

    it('never posts into a closed period', async () => {
        await saveLedger();
        seed(`users/${OWNER}/ledgers/led1`, { ...read(`users/${OWNER}/ledgers/led1`)!, locked_through: '2026-10-31' });
        expect((await autoPostBuilding(OWNER, B1, NOW))?.posted).toBe(0);
    });
});
