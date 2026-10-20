// @vitest-environment node
// firestore.rules against the real rules engine (Firestore emulator). Run with `npm run test:rules`, which starts the
// emulator; in a plain `npm test` (no FIRESTORE_EMULATOR_HOST) the suite is skipped.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where, type Firestore } from 'firebase/firestore';
import { permissionsForRole, type Permission } from '../src/shared/permissions.js';

const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST;
const OWNER = 'owner';
const A = `users/${OWNER}/buildings/bA`;
const B = `users/${OWNER}/buildings/bB`;

let env: RulesTestEnvironment;
const as = (uid: string | null, claims: Record<string, unknown> = {}): Firestore =>
    (uid ? env.authenticatedContext(uid, claims) : env.unauthenticatedContext()).firestore() as unknown as Firestore;
const maid = (over: Record<string, unknown> = {}) => as('hk_m1', { hk_owner: OWNER, hk_building: 'bA', hk_maid: 'm1', hk_ver: 0, ...over });

function member(uid: string, role: string, permissions: Permission[], propertyIds: string[]) {
    return { uid, role, permissions, property_ids: propertyIds, status: 'active' };
}

describe.skipIf(!EMULATOR)('firestore.rules (emulator)', () => {
    beforeAll(async () => {
        const [host, port] = (EMULATOR ?? '127.0.0.1:8080').split(':');
        env = await initializeTestEnvironment({
            projectId: 'demo-horcare',
            firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host, port: Number(port) },
        });
    });
    afterAll(async () => { await env?.cleanup(); });

    beforeEach(async () => {
        await env.clearFirestore();
        await env.withSecurityRulesDisabled(async ctx => {
            const db = ctx.firestore();
            const put = (path: string, data: object) => setDoc(doc(db, path), data);
            await put(`users/${OWNER}`, { uid: OWNER, license: 'active', access_until: 0 });
            await put(`users/${OWNER}/members/desk`, member('desk', 'front_desk', permissionsForRole('front_desk'), ['bA']));
            await put(`users/${OWNER}/members/fin`, member('fin', 'finance', permissionsForRole('finance'), ['*']));
            await put(`users/${OWNER}/members/meter`, member('meter', 'technician', ['room.read', 'meter.read', 'meter.record'], ['bA']));
            await put(`users/${OWNER}/members/techB`, member('techB', 'technician', permissionsForRole('technician'), ['bB']));
            await put(`users/${OWNER}/members/mgr`, member('mgr', 'property_manager', permissionsForRole('property_manager'), ['bA']));
            for (const b of [A, B]) {
                await put(b, { name: b.endsWith('bA') ? 'A' : 'B', order: 0 });
                await put(`${b}/data/config`, { building_type: 'dormitory', portal_pin: '1234' });
                await put(`${b}/rooms/r1`, { room_number: '101', rent_amount: 3500, current_meter_elec: 100, current_meter_water: 10 });
                await put(`${b}/tenants/r1`, { full_name: 'สมชาย', phone: '0811111111', id_card_number: '1234567890123' });
                await put(`${b}/bills/b1`, { id: 'b1', room_id: 'r1', month: '2026-10', curr_elec: 150, total_bill: 4000, is_locked: false, payment_status: 'unpaid' });
                await put(`${b}/bills/paid`, { id: 'paid', room_id: 'r1', month: '2026-09', total_bill: 3900, is_locked: false, payment_status: 'paid', paid_amount: 3900 });
                await put(`${b}/bills/locked`, { id: 'locked', room_id: 'r1', month: '2026-08', total_bill: 3800, is_locked: true, payment_status: 'unpaid' });
                await put(`${b}/common_fees/f1`, { name: 'ขยะ', amount: 50, created_at: '2026-01-01' });
                await put(`${b}/fines/f1`, { room_id: 'r1', amount: 100 });
                await put(`${b}/maintenance/x1`, { room_id: 'r1', status: 'open' });
                await put(`${b}/cleaning/c1`, { room_id: 'r1', status: 'pending', description: 'ห้องน้ำ' });
                await put(`${b}/cleaning/c2`, { room_id: 'r1', status: 'in_progress', assigned_maid_id: 'm2' });
                await put(`${b}/cleaning_images/c1`, { data: 'data:image/png;base64,AA==' });
                await put(`${b}/housekeepers/m1`, { name: 'แม่บ้าน 1', phone: '0812345678', is_active: true, session_version: 0 });
                await put(`${b}/housekeepers/m2`, { name: 'แม่บ้าน 2', phone: '0899999999', is_active: true, session_version: 0 });
                await put(`${b}/tenants/r1/events/e1`, { type: 'move_in', date: '2026-01-01' });
            }
            await put('housekeepers_auth/0812345678', { owner_uid: OWNER, building_id: 'bA', maid_id: 'm1', passcode_hash: 'scrypt$x$y' });
        });
    });

    describe('anonymous visitors (no portal reads Firestore any more)', () => {
        it('cannot read any property data, by id or by query', async () => {
            const anon = as(null);
            for (const path of [A, `${A}/rooms/r1`, `${A}/bills/b1`, `${A}/tenants/r1`, `${A}/data/config`, `${A}/fines/f1`,
                `${A}/maintenance/x1`, `${A}/cleaning/c1`, `${A}/cleaning_images/c1`, `${A}/housekeepers/m1`, 'housekeepers_auth/0812345678',
                `${A}/tenants/r1/events/e1`]) {
                await assertFails(getDoc(doc(anon, path)));
            }
            await assertFails(getDocs(query(collection(anon, `${A}/bills`), where('room_id', '==', 'r1'))));
            await assertFails(getDocs(collection(anon, `${A}/tenants`)));
        });

        it('cannot create or change requests, photos or housekeeper sign-ins', async () => {
            const anon = as(null);
            await assertFails(setDoc(doc(anon, `${A}/cleaning/new`), { room_id: 'r1', status: 'pending' }));
            await assertFails(updateDoc(doc(anon, `${A}/cleaning/c1`), { status: 'completed' }));
            await assertFails(setDoc(doc(anon, `${A}/cleaning_images/c1`), { data: 'x' }));
            await assertFails(setDoc(doc(anon, `${A}/maintenance/new`), { room_id: 'r1', room_number: '101', category: 'ac', description: 'x', urgency: 'normal', status: 'open', created_at: 'x' }));
            await assertFails(setDoc(doc(anon, 'housekeepers_auth/0812345678'), { owner_uid: 'evil' }));
        });

        it('a signed-in stranger is no better off', async () => {
            const stranger = as('stranger');
            await assertFails(getDoc(doc(stranger, `${A}/tenants/r1`)));
            await assertFails(getDoc(doc(stranger, `${A}/bills/b1`)));
            await assertFails(getDoc(doc(stranger, 'housekeepers_auth/0812345678')));
            await assertFails(setDoc(doc(stranger, 'housekeepers_auth/0812345678'), { owner_uid: 'stranger', building_id: 'x', maid_id: 'y' }));
        });
    });

    describe('the owner', () => {
        it('reads and writes everything of their own', async () => {
            const o = as(OWNER);
            await assertSucceeds(getDoc(doc(o, `${A}/tenants/r1`)));
            await assertSucceeds(getDocs(collection(o, `${A}/bills`)));
            await assertSucceeds(updateDoc(doc(o, `${A}/bills/b1`), { total_bill: 4100 }));
            await assertSucceeds(updateDoc(doc(o, `${A}/cleaning/c1`), { status: 'cancelled' }));
        });

        it('a closed bill keeps its amounts, but takes payments and can be reopened', async () => {
            const o = as(OWNER);
            await assertFails(updateDoc(doc(o, `${A}/bills/locked`), { total_bill: 1 }));
            await assertFails(deleteDoc(doc(o, `${A}/bills/locked`)));
            await assertSucceeds(updateDoc(doc(o, `${A}/bills/locked`), { payment_status: 'paid', paid_amount: 3800 }));
            await assertSucceeds(updateDoc(doc(o, `${A}/bills/locked`), { is_locked: false }));
            await assertSucceeds(updateDoc(doc(o, `${A}/bills/locked`), { total_bill: 1 }));
        });

        it('housekeeper records are written only by the API', async () => {
            await assertFails(setDoc(doc(as(OWNER), `${A}/housekeepers/m3`), { name: 'x', passcode: '1234' }));
        });
    });

    describe('staff are limited to their buildings and permissions', () => {
        it('read their building, not another', async () => {
            const desk = as('desk');
            await assertSucceeds(getDoc(doc(desk, `${A}/rooms/r1`)));
            await assertSucceeds(getDocs(collection(desk, `${A}/bills`)));
            await assertFails(getDoc(doc(desk, `${B}/rooms/r1`)));
            await assertFails(getDocs(collection(desk, `${B}/bills`)));
            // the building picker lists the organisation's buildings
            await assertSucceeds(getDocs(collection(desk, `users/${OWNER}/buildings`)));
        });

        it('tenant profiles need tenant.read on that building', async () => {
            await assertSucceeds(getDoc(doc(as('desk'), `${A}/tenants/r1`)));
            await assertFails(getDoc(doc(as('meter'), `${A}/tenants/r1`)));
            await assertFails(getDoc(doc(as('techB'), `${B}/tenants/r1`)));
        });

        it('payment.create records a payment on an unpaid bill, nothing more', async () => {
            const desk = as('desk');
            await assertFails(updateDoc(doc(desk, `${A}/bills/b1`), { total_bill: 1 }));
            await assertFails(updateDoc(doc(desk, `${A}/bills/b1`), { payment_status: 'paid', total_bill: 1 }));
            await assertFails(updateDoc(doc(desk, `${A}/bills/locked`), { is_locked: false }));
            await assertFails(updateDoc(doc(desk, `${A}/bills/paid`), { payment_status: 'unpaid', paid_at: '' }));
            await assertSucceeds(updateDoc(doc(desk, `${A}/bills/b1`), { payment_status: 'paid', paid_amount: 4000, payment_method: 'cash', paid_method: 'manual' }));
        });

        it('payment.update may undo a payment but not change amounts', async () => {
            const fin = as('fin');
            await assertSucceeds(updateDoc(doc(fin, `${A}/bills/paid`), { payment_status: 'unpaid', paid_at: '' }));
            await assertFails(updateDoc(doc(fin, `${A}/bills/b1`), { total_bill: 1 }));
        });

        it('meter recording changes readings on open bills only, never payments', async () => {
            const meter = as('meter');
            await assertSucceeds(updateDoc(doc(meter, `${A}/bills/b1`), { curr_elec: 160, elec_units: 60, total_bill: 4080 }));
            await assertFails(updateDoc(doc(meter, `${A}/bills/locked`), { curr_elec: 1 }));
            await assertFails(updateDoc(doc(meter, `${A}/bills/b1`), { payment_status: 'paid' }));
            await assertSucceeds(setDoc(doc(meter, `${A}/bills/new`), { id: 'new', room_id: 'r1', month: '2026-11', curr_elec: 170, total_bill: 4100, is_locked: false, is_saved: true }));
            await assertFails(setDoc(doc(meter, `${A}/bills/new2`), { id: 'new2', room_id: 'r1', month: '2026-12', is_locked: true }));
            await assertFails(setDoc(doc(meter, `${A}/bills/new3`), { id: 'new3', room_id: 'r1', month: '2026-12', payment_status: 'paid' }));
            await assertSucceeds(updateDoc(doc(meter, `${A}/rooms/r1`), { current_meter_elec: 170 }));
            await assertFails(updateDoc(doc(meter, `${A}/rooms/r1`), { rent_amount: 1 }));
        });

        it('closing a month needs property.update', async () => {
            await assertSucceeds(updateDoc(doc(as('mgr'), `${A}/bills/b1`), { is_locked: true }));
            await assertFails(updateDoc(doc(as('fin'), `${A}/bills/paid`), { is_locked: true }));
        });

        it('tenant history is append-only for staff', async () => {
            const mgr = as('mgr');
            await assertSucceeds(getDocs(collection(mgr, `${A}/tenants/r1/events`)));
            await assertSucceeds(setDoc(doc(mgr, `${A}/tenants/r1/events/e2`), { type: 'note', date: '2026-10-20' }));
            await assertFails(updateDoc(doc(mgr, `${A}/tenants/r1/events/e1`), { note: 'changed' }));
            await assertFails(deleteDoc(doc(mgr, `${A}/tenants/r1/events/e1`)));
            await assertSucceeds(deleteDoc(doc(as(OWNER), `${A}/tenants/r1/events/e1`)));
        });
    });

    describe('housekeepers (custom-token sessions)', () => {
        it('read what their work needs in their own building only', async () => {
            const m = maid();
            for (const path of [A, `${A}/rooms/r1`, `${A}/bills/b1`, `${A}/data/config`, `${A}/common_fees/f1`, `${A}/cleaning/c1`, `${A}/cleaning_images/c1`, `${A}/housekeepers/m1`]) {
                await assertSucceeds(getDoc(doc(m, path)));
            }
            await assertSucceeds(getDocs(collection(m, `${A}/cleaning`)));
            await assertFails(getDoc(doc(m, `${A}/tenants/r1`)));
            await assertFails(getDoc(doc(m, `${A}/housekeepers/m2`)));
            await assertFails(getDoc(doc(m, `${B}/rooms/r1`)));
            await assertFails(getDocs(collection(m, `users/${OWNER}/buildings`)));
            await assertFails(getDoc(doc(m, 'housekeepers_auth/0812345678')));
        });

        it('accept and complete open jobs or their own, and nothing else', async () => {
            const m = maid();
            await assertSucceeds(updateDoc(doc(m, `${A}/cleaning/c1`), { status: 'in_progress', assigned_maid_id: 'm1', assigned_maid_name: 'แม่บ้าน 1', accepted_at: 'now', updated_at: 'now' }));
            await assertSucceeds(updateDoc(doc(m, `${A}/cleaning/c1`), { status: 'completed', completed_at: 'now', completed_by: 'maid', completion_notes: 'เรียบร้อย', updated_at: 'now' }));
            await assertFails(updateDoc(doc(m, `${A}/cleaning/c2`), { status: 'completed' }));
            await assertFails(updateDoc(doc(m, `${A}/cleaning/c1`), { description: 'changed' }));
            await assertFails(updateDoc(doc(m, `${A}/cleaning/c1`), { status: 'cancelled' }));
            await assertFails(setDoc(doc(m, `${A}/cleaning/new`), { room_id: 'r1', status: 'pending' }));
        });

        it('may record meters like a meter reader', async () => {
            const m = maid();
            await assertSucceeds(updateDoc(doc(m, `${A}/bills/b1`), { curr_elec: 155, total_bill: 4040 }));
            await assertFails(updateDoc(doc(m, `${A}/bills/b1`), { payment_status: 'paid' }));
            await assertSucceeds(updateDoc(doc(m, `${A}/rooms/r1`), { current_meter_elec: 155 }));
        });

        it('lose access when the passcode changes or the account is switched off', async () => {
            await assertFails(getDoc(doc(maid({ hk_ver: 1 }), `${A}/rooms/r1`)));
            await env.withSecurityRulesDisabled(ctx => updateDoc(doc(ctx.firestore(), `${A}/housekeepers/m1`), { is_active: false }));
            await assertFails(getDoc(doc(maid(), `${A}/rooms/r1`)));
        });

        it('a token for one building does not open another', async () => {
            await assertFails(getDoc(doc(maid({ hk_building: 'bB' }), `${A}/rooms/r1`)));
            await assertFails(getDoc(doc(maid({ hk_owner: 'someone-else' }), `${A}/rooms/r1`)));
        });
    });
});
