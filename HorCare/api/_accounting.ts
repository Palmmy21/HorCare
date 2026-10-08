/**
 * /api/accounting — Mango export: profile + mappings, preview, batches, file download, import outcome,
 * and recording payments that need allocations (partial / several bills).
 *
 * Reading (profiles, batches, payments) is straight from Firestore under rules that need
 * `accounting.export`; every write and the file itself go through here, permission-checked on every
 * property the profile covers. The posting rules are src/shared/accounting.ts (pure, tested).
 *
 * Actions: profile_save | preview | create_batch | download | confirm_import | record_payment | verify_payment
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash, randomUUID } from 'node:crypto';
import { db } from './_firebase.js';
import { authorize, buildingExists, type AuthContext } from './_rbac.js';
import { writeAudit } from './_audit.js';
import { buildMangoWorkbook } from './_mango-xlsx.js';
import {
    buildVouchers, channelOf, profileGaps, sumCr, sumDr, thDate, toSatang,
    type MangoProfile, type PaymentRec, type PostingResult, type ReceivableDoc, type Voucher, type VoucherKind,
} from '../src/shared/accounting.js';
import type { Fine, MonthlyBill } from '../src/types/index.js';
import type { Permission } from '../src/shared/permissions.js';

export const config = { maxDuration: 60 };

type Action = 'profile_save' | 'preview' | 'create_batch' | 'download' | 'confirm_import' | 'record_payment' | 'verify_payment';
const ACTIONS: Action[] = ['profile_save', 'preview', 'create_batch', 'download', 'confirm_import', 'record_payment', 'verify_payment'];

interface Body {
    action?: Action;
    owner_uid?: string;
    building_id?: string;
    profile?: unknown;
    profile_id?: string;
    kind?: string;
    from?: string;
    to?: string;
    batch_id?: string;
    outcome?: string;
    note?: unknown;
    room_id?: string;
    method?: string;
    bank_account_id?: string;
    paid_at?: string;
    allocations?: { kind?: string; id?: string; amount?: number }[];
    transaction_ref?: unknown;
    payment_id?: string;
    bank_transaction_id?: string;
}

class HttpError extends Error {
    constructor(public status: number, public code: string, public detail?: unknown) { super(code); }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_MONEY_BAHT = 10_000_000;
const ownerBase = (o: string) => `users/${o}`;
const bldBase = (o: string, b: string) => `users/${o}/buildings/${b}`;

// ── building documents → accounting inputs ───────────────────────────────────

const lineSatang = (category: ReceivableDoc['lines'][number]['category'], baht: number | undefined) => ({ category, amount_satang: toSatang(baht ?? 0) });

export function docRevision(d: Pick<ReceivableDoc, 'room_id' | 'period' | 'total_satang' | 'lines'>): string {
    return `${d.room_id}|${d.period}|${d.total_satang}|${d.lines.map(l => `${l.category}=${l.amount_satang}`).join(',')}`;
}

export function billToDoc(b: MonthlyBill, propertyCode?: string): ReceivableDoc {
    const lines = [
        lineSatang('rent', b.room_rent), lineSatang('electric', b.elec_bill), lineSatang('water', b.water_bill), lineSatang('common_fee', b.common_fee),
    ].filter(l => l.amount_satang !== 0);
    const doc: ReceivableDoc = {
        kind: 'bill', id: b.id, room_id: b.room_id, room_number: b.room_number, period: b.month, issued_at: b.created_at,
        status: b.is_saved ? 'issued' : 'draft', lines, total_satang: toSatang(b.total_bill), revision: '', property_code: propertyCode,
    };
    doc.revision = docRevision(doc);
    return doc;
}

export function fineToDoc(f: Fine, propertyCode?: string): ReceivableDoc {
    const amount = toSatang(f.amount);
    const doc: ReceivableDoc = {
        kind: 'fine', id: f.id, room_id: f.room_id, room_number: f.room_number, period: (f.date || f.created_at).slice(0, 7),
        issued_at: f.created_at, status: 'issued', lines: [{ category: 'fine', amount_satang: amount }], total_satang: amount,
        revision: '', property_code: propertyCode,
    };
    doc.revision = docRevision(doc);
    return doc;
}

type PaidItem = (MonthlyBill | Fine) & { allocated_satang?: number; payments_recorded?: boolean };

/** A payment recorded the old way (marked paid on the bill itself) seen as a one-allocation payment. */
export function legacyPayment(kind: 'bill' | 'fine', item: PaidItem): PaymentRec | null {
    const paid = kind === 'bill' ? (item as MonthlyBill).payment_status === 'paid' : (item as Fine).status === 'paid';
    if (!paid || item.payments_recorded) return null;
    const total = kind === 'bill' ? (item as MonthlyBill).total_bill : (item as Fine).amount;
    const gross = toSatang(item.paid_amount ?? total);
    const method: PaymentRec['method'] = item.payment_method
        ?? (item.paid_method === 'auto' || item.slip_image || item.slip_ref ? 'bank_transfer' : 'other');
    const paidAt = item.paid_at ?? item.slip_submitted_at ?? item.updated_at ?? item.created_at;
    const channel = channelOf(method, item.bank_account_id ?? item.slip_account_id);
    return {
        id: `legacy-${kind}-${item.id}`, room_id: item.room_id, channel, method, paid_at: paidAt, gross_satang: gross,
        verification: method === 'cash' ? 'n/a' : (item.verification_status ?? 'unverified'), status: 'active',
        allocations: [{ target_kind: kind, target_id: item.id, amount_satang: gross }],
        revision: `${gross}|${paidAt}|${channel}`,
    };
}

async function loadBuilding(owner: string, bld: string, code?: string) {
    const base = bldBase(owner, bld);
    const [bills, fines, pays] = await Promise.all([
        db.collection(`${base}/bills`).get(), db.collection(`${base}/fines`).get(), db.collection(`${base}/payments`).get(),
    ]);
    const docs: ReceivableDoc[] = [];
    const payments: PaymentRec[] = [];
    for (const d of bills.docs) { const b = d.data() as PaidItem & MonthlyBill; docs.push(billToDoc(b, code)); const l = legacyPayment('bill', b); if (l) payments.push(l); }
    for (const d of fines.docs) { const f = d.data() as PaidItem & Fine; docs.push(fineToDoc(f, code)); const l = legacyPayment('fine', f); if (l) payments.push(l); }
    for (const d of pays.docs) payments.push(d.data() as PaymentRec);
    return { docs, payments };
}

/** `${kind}:...` keys of what earlier (non-failed) batches of this profile already contain. */
async function loadExported(owner: string, profileId: string): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const batches = await db.collection(`${ownerBase(owner)}/accounting_batches`).where('profile_id', '==', profileId).get();
    for (const b of batches.docs) {
        const batch = b.data() as { id: string; kind: VoucherKind; import_outcome: string; vouchers_count: number };
        if (batch.import_outcome === 'failed') continue;
        const items = await db.collection(`${ownerBase(owner)}/accounting_batches/${batch.id}/items`).get();
        for (const it of items.docs) {
            for (const s of (it.data() as Voucher).sources) out.set(s.kind === 'payment' ? `receipt:payment:${s.id}` : `invoice:${s.kind}:${s.id}`, s.revision);
        }
    }
    return out;
}

// ── profile ──────────────────────────────────────────────────────────────────

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim().length <= max ? v.trim() : null);
const optStr = (v: unknown, max: number): string | null | undefined => (v === undefined || v === null || v === '' ? null : str(v, max) ?? undefined);

/** Validate untrusted profile JSON field by field; returns a clean MangoProfile or null. */
export function cleanProfile(raw: unknown, id: string): MangoProfile | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const name = str(r.name, 80);
    const entity = str(r.legal_entity_name, 120);
    const tmpl = str(r.template_version, 60);
    if (name === null || entity === null || tmpl === null) return null;
    if (!Array.isArray(r.property_ids) || r.property_ids.length > 50 || r.property_ids.some((p: unknown) => typeof p !== 'string' || !p || p.length > 128)) return null;
    const o = r.options ?? {}, c = r.codes ?? {}, rm = r.remarks ?? {};
    const cutoff = o.opening_cutoff_month === null || o.opening_cutoff_month === undefined || o.opening_cutoff_month === '' ? null : String(o.opening_cutoff_month);
    if (cutoff !== null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(cutoff)) return null;
    if (!['issued_at', 'month_end'].includes(o.invoice_date_basis)) return null;
    if (!['dd/mm/yyyy', 'dd/mm/yyyy_be', 'yyyy-mm-dd'].includes(o.date_format)) return null;
    for (const k of ['count_unverified_transfers', 'customer_code_all_lines', 'voucher_no_from_horcare', 'header_on_every_line']) if (typeof o[k] !== 'boolean') return null;

    const code = (v: unknown) => optStr(v, 40);
    const codes = {
        ar_account: str(c.ar_account, 40), project: code(c.project), job: code(c.job), department: code(c.department), cost_code: code(c.cost_code),
        book: code(c.book), pu_cost_yn: code(c.pu_cost_yn), ac_type: code(c.ac_type), data_type: code(c.data_type),
    };
    if (Object.values(codes).some(v => v === undefined) || codes.ar_account === null) return null;
    const invoice = str(rm.invoice, 100), receipt = str(rm.receipt, 100);
    if (invoice === null || receipt === null) return null;

    const rev: MangoProfile['revenue_accounts'] = {};
    for (const [k, v] of Object.entries(r.revenue_accounts ?? {})) {
        if (!['rent', 'electric', 'water', 'common_fee', 'fine'].includes(k)) return null;
        const a = str(v, 40); if (a === null) return null; if (a) rev[k as keyof typeof rev] = a;
    }
    const channels: MangoProfile['channels'] = {};
    for (const [k, v] of Object.entries(r.channels ?? {})) {
        const ch = v as { account?: unknown; option_code?: unknown };
        const account = str(ch?.account, 40), option = optStr(ch?.option_code, 40);
        if (!k || k.length > 80 || account === null || option === undefined) return null;
        if (account) channels[k] = { account, option_code: option };
    }
    const customers: MangoProfile['customers'] = {};
    for (const [k, v] of Object.entries(r.customers ?? {})) {
        const cc = str((v as { code?: unknown })?.code, 40);
        if (!k || k.length > 128 || cc === null) return null;
        if (cc) customers[k] = { code: cc };
    }
    const property_codes: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.property_codes ?? {})) { const pc = str(v, 12); if (pc === null) return null; if (pc) property_codes[k] = pc; }

    return {
        id, name, legal_entity_name: entity, template_version: tmpl, property_ids: [...new Set<string>(r.property_ids)], property_codes,
        status: r.status === 'approved' ? 'approved' : 'draft',
        options: { invoice_date_basis: o.invoice_date_basis, count_unverified_transfers: o.count_unverified_transfers, opening_cutoff_month: cutoff,
            customer_code_all_lines: o.customer_code_all_lines, voucher_no_from_horcare: o.voucher_no_from_horcare, date_format: o.date_format, header_on_every_line: o.header_on_every_line },
        codes: { ...codes, ar_account: codes.ar_account! } as MangoProfile['codes'],
        remarks: { invoice, receipt }, revenue_accounts: rev, channels, customers,
    };
}

// ── handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const body = (req.body ?? {}) as Body;
    const action = body.action;
    if (!action || !ACTIONS.includes(action)) { res.status(400).json({ error: 'unknown_action' }); return; }
    if (typeof body.owner_uid !== 'string' || !body.owner_uid) { res.status(400).json({ error: 'invalid_input' }); return; }
    const owner = body.owner_uid;

    // Which properties does this call touch? Every one must be authorised.
    let profile: MangoProfile | null = null;
    let properties: string[] = [];
    const payAction = action === 'record_payment' || action === 'verify_payment';
    try {
        if (payAction) {
            if (typeof body.building_id !== 'string' || !body.building_id) throw new HttpError(400, 'invalid_input');
            properties = [body.building_id];
        } else if (action === 'profile_save') {
            const id = typeof body.profile_id === 'string' && body.profile_id ? body.profile_id : randomUUID();
            const clean = cleanProfile(body.profile, id);
            if (!clean) throw new HttpError(400, 'invalid_input');
            profile = clean;
            properties = clean.property_ids;
            if (properties.length === 0) throw new HttpError(400, 'invalid_input');
        } else {
            const key = action === 'download' || action === 'confirm_import' ? 'batch' : 'profile';
            let profileId = body.profile_id;
            if (key === 'batch') {
                if (typeof body.batch_id !== 'string' || !body.batch_id) throw new HttpError(400, 'invalid_input');
                const b = await db.doc(`${ownerBase(owner)}/accounting_batches/${body.batch_id}`).get();
                if (!b.exists) throw new HttpError(404, 'not_found');
                profileId = (b.data() as { profile_id: string }).profile_id;
            }
            if (typeof profileId !== 'string' || !profileId) throw new HttpError(400, 'invalid_input');
            const snap = await db.doc(`${ownerBase(owner)}/accounting_profiles/${profileId}`).get();
            if (!snap.exists) throw new HttpError(404, 'not_found');
            profile = snap.data() as MangoProfile;
            properties = profile.property_ids;
        }
    } catch (e) {
        if (e instanceof HttpError) { res.status(e.status).json({ error: e.code }); return; }
        throw e;
    }

    const permission: Permission = action === 'profile_save' ? 'accounting.manage'
        : action === 'record_payment' ? 'payment.create' : action === 'verify_payment' ? 'payment.reconcile' : 'accounting.export';
    let ctx: AuthContext | null = null;
    for (const bld of properties) {
        ctx = await authorize(req, res, { ownerUid: owner, buildingId: bld, permission });
        if (!ctx) return;
        if (!(await buildingExists(owner, bld))) { res.status(404).json({ error: 'property_not_found' }); return; }
    }
    if (!ctx) { res.status(400).json({ error: 'invalid_input' }); return; }
    const who = ctx;
    const audit = (act: 'CREATE' | 'UPDATE' | 'DOWNLOAD', type: 'accounting_profile' | 'accounting_export' | 'payment', id: string, label: string, extra: object = {}) =>
        writeAudit({
            ownerUid: owner, propertyId: properties[0], userId: who.uid, userName: who.displayName, role: who.role,
            action: act, resourceType: type, resourceId: id, resourceLabel: label, req, ...extra,
        });

    try {
        if (action === 'profile_save') return await saveProfile();
        if (action === 'record_payment') return await recordPayment();
        if (action === 'verify_payment') return await verifyPayment();
        return await exportActions();
    } catch (e) {
        if (e instanceof HttpError) { res.status(e.status).json({ error: e.code, ...(e.detail ? { detail: e.detail } : {}) }); return; }
        throw e;
    }

    // ── profile_save ─────────────────────────────────────────────────────────
    async function saveProfile() {
        const p = profile!;
        const col = `${ownerBase(owner)}/accounting_profiles`;
        // one legal entity per property: a property cannot be exported by two profiles
        const others = (await db.collection(col).get()).docs.map(d => d.data() as MangoProfile).filter(o => o.id !== p.id);
        const clash = others.find(o => o.property_ids.some(x => p.property_ids.includes(x)));
        if (clash) throw new HttpError(409, 'property_in_other_profile', clash.name);
        const gaps = profileGaps(p);
        if (p.status === 'approved' && gaps.length) throw new HttpError(409, 'profile_incomplete', gaps);
        const prev = await db.doc(`${col}/${p.id}`).get();
        await db.doc(`${col}/${p.id}`).set({ ...p, updated_at: new Date().toISOString(), updated_by: who.uid });
        await audit(prev.exists ? 'UPDATE' : 'CREATE', 'accounting_profile', p.id, p.name, {
            note: `status ${p.status}; ${Object.keys(p.customers).length} customers`,
        });
        res.status(200).json({ profile: p, gaps });
    }

    // ── preview / create_batch / download / confirm_import ────────────────────
    async function build(kind: VoucherKind, from: string, to: string): Promise<PostingResult> {
        const p = profile!;
        const all = await Promise.all(p.property_ids.map(b => loadBuilding(owner, b, p.property_codes[b])));
        const docs = all.flatMap(a => a.docs);
        const payments = all.flatMap(a => a.payments);
        const exported = await loadExported(owner, p.id);
        return buildVouchers({ profile: p, kind, from, to, docs, payments, exported });
    }
    function summary(r: PostingResult) {
        return {
            documents: r.vouchers.length, lines: r.vouchers.reduce((n, v) => n + v.lines.length, 0),
            dr_satang: sumDr(r.vouchers), cr_satang: sumCr(r.vouchers), problems: r.problems.length, excluded: r.excluded.length,
        };
    }

    async function exportActions() {
        const p = profile!;
        if (action === 'download' || action === 'confirm_import') {
            const ref = db.doc(`${ownerBase(owner)}/accounting_batches/${body.batch_id}`);
            const batch = (await ref.get()).data() as { id: string; kind: VoucherKind; from: string; to: string; profile_snapshot: MangoProfile; file_name: string; checksum: string };
            if (action === 'confirm_import') {
                if (body.outcome !== 'confirmed' && body.outcome !== 'failed' && body.outcome !== 'partial') throw new HttpError(400, 'invalid_input');
                const note = optStr(body.note, 500);
                if (note === undefined) throw new HttpError(400, 'invalid_input');
                if ((body.outcome === 'failed' || body.outcome === 'partial') && !note) throw new HttpError(400, 'note_required');
                await ref.update({ import_outcome: body.outcome, import_note: note, import_by: who.displayName, import_at: new Date().toISOString() });
                await audit('UPDATE', 'accounting_export', batch.id, batch.file_name, { note: `import ${body.outcome}` });
                res.status(200).json({ ok: true });
                return;
            }
            const items = (await db.collection(`${ownerBase(owner)}/accounting_batches/${batch.id}/items`).get()).docs.map(d => d.data() as Voucher & { seq: number });
            items.sort((a, b) => a.seq - b.seq);
            const buf = await buildMangoWorkbook(batch.profile_snapshot, items);
            // the stored checksum covers the vouchers, so a tampered batch is caught
            if (checksum(items) !== batch.checksum) throw new HttpError(500, 'batch_corrupted');
            await audit('DOWNLOAD', 'accounting_export', batch.id, batch.file_name);
            res.status(200).json({ file_name: batch.file_name, base64: buf.toString('base64') });
            return;
        }

        const kind = body.kind;
        if ((kind !== 'invoice' && kind !== 'receipt') || typeof body.from !== 'string' || typeof body.to !== 'string'
            || !DATE_RE.test(body.from) || !DATE_RE.test(body.to) || body.from > body.to) throw new HttpError(400, 'invalid_input');
        const gaps = profileGaps(p);
        // a preview helps while setting up (it lists what is missing); a file needs an approved, complete profile
        const r = await build(kind, body.from, body.to);
        if (action === 'preview') {
            res.status(200).json({ ...r, summary: summary(r), gaps, approved: p.status === 'approved' });
            return;
        }
        if (p.status !== 'approved') throw new HttpError(409, 'profile_not_approved');
        if (gaps.length) throw new HttpError(409, 'profile_incomplete', gaps);

        // create_batch: nothing is exported if anything in the run is blocked
        if (r.problems.length) throw new HttpError(409, 'blocked', { problems: r.problems, summary: summary(r) });
        if (r.vouchers.length === 0) {
            // everything in this period is already in a batch: a repeated click gets that batch back instead of an error
            if (r.excluded.some(e => e.reason === 'already_exported')) {
                const same = (await db.collection(`${ownerBase(owner)}/accounting_batches`).where('profile_id', '==', p.id).get()).docs
                    .map(d => d.data() as { kind: string; from: string; to: string })
                    .find(b => b.kind === kind && b.from === body.from && b.to === body.to);
                if (same) { res.status(200).json({ batch: same, reused: true }); return; }
            }
            throw new HttpError(409, 'nothing_to_export');
        }
        const sum = checksum(r.vouchers);
        const id = createHash('sha1').update(`${p.id}|${kind}|${sum}`).digest('hex').slice(0, 24);
        const ref = db.doc(`${ownerBase(owner)}/accounting_batches/${id}`);
        const existing = await ref.get();
        if (existing.exists) { res.status(200).json({ batch: existing.data(), reused: true }); return; } // double click / retry
        const fileName = `mango-${kind === 'invoice' ? 'invoice' : 'receipt'}-${body.from.replaceAll('-', '')}-${body.to.replaceAll('-', '')}.xlsx`;
        const s = summary(r);
        const batch = {
            id, profile_id: p.id, profile_snapshot: p, kind, from: body.from, to: body.to, template_version: p.template_version,
            file_name: fileName, checksum: sum, status: 'ready', import_outcome: 'unknown', import_note: null,
            vouchers_count: s.documents, lines_count: s.lines, dr_satang: s.dr_satang, cr_satang: s.cr_satang,
            created_at: new Date().toISOString(), created_by: who.uid, created_by_name: who.displayName,
        };
        await ref.set(batch);
        let seq = 0;
        for (const v of r.vouchers) await db.doc(`${ownerBase(owner)}/accounting_batches/${id}/items/${String(seq).padStart(6, '0')}`).set({ ...v, seq: seq++ });
        await audit('CREATE', 'accounting_export', id, fileName, { note: `${s.documents} vouchers, ${s.lines} lines` });
        res.status(200).json({ batch, reused: false });
    }

    // ── record_payment ───────────────────────────────────────────────────────
    async function recordPayment() {
        const bld = properties[0];
        const base = bldBase(owner, bld);
        const method = body.method;
        if (method !== 'cash' && method !== 'bank_transfer' && method !== 'qr_gateway' && method !== 'other') throw new HttpError(400, 'invalid_input');
        if (typeof body.room_id !== 'string' || !body.room_id) throw new HttpError(400, 'invalid_input');
        const paidAt = typeof body.paid_at === 'string' ? new Date(body.paid_at) : null;
        if (!paidAt || Number.isNaN(paidAt.getTime()) || paidAt.getTime() > Date.now() + 5 * 60_000) throw new HttpError(400, 'invalid_input');
        const allocs = body.allocations;
        if (!Array.isArray(allocs) || allocs.length === 0 || allocs.length > 50) throw new HttpError(400, 'invalid_input');
        const cleaned = allocs.map(a => ({
            kind: a.kind, id: a.id, satang: typeof a.amount === 'number' && a.amount > 0 && a.amount <= MAX_MONEY_BAHT ? toSatang(a.amount) : NaN,
        }));
        if (cleaned.some(a => (a.kind !== 'bill' && a.kind !== 'fine') || typeof a.id !== 'string' || !a.id || !Number.isInteger(a.satang) || a.satang <= 0)) throw new HttpError(400, 'invalid_input');
        if (new Set(cleaned.map(a => `${a.kind}:${a.id}`)).size !== cleaned.length) throw new HttpError(400, 'invalid_input');
        const note = optStr(body.note, 200); const ref = optStr(body.transaction_ref, 80);
        if (note === undefined || ref === undefined) throw new HttpError(400, 'invalid_input');

        let bankName: string | null = null;
        if (method === 'bank_transfer') {
            if (typeof body.bank_account_id !== 'string' || !body.bank_account_id) throw new HttpError(400, 'bank_account_required');
            const acc = await db.doc(`${base}/bank_accounts/${body.bank_account_id}`).get();
            if (!acc.exists || (acc.data() as { status?: string }).status !== 'active') throw new HttpError(400, 'bank_account_invalid');
            bankName = (acc.data() as { bank_short?: string }).bank_short ?? null;
        }
        const roomSnap = await db.doc(`${base}/rooms/${body.room_id}`).get();
        if (!roomSnap.exists) throw new HttpError(404, 'room_not_found');

        const paymentId = randomUUID();
        const now = new Date().toISOString();
        const gross = cleaned.reduce((s, a) => s + a.satang, 0);
        const result = await db.runTransaction(async tx => {
            const refs = cleaned.map(a => db.doc(`${base}/${a.kind === 'bill' ? 'bills' : 'fines'}/${a.id}`));
            const snaps = await Promise.all(refs.map(r => tx.get(r)));
            const updates: { ref: (typeof refs)[number]; data: Record<string, unknown> }[] = [];
            snaps.forEach((s, i) => {
                const a = cleaned[i];
                if (!s.exists) throw new HttpError(404, 'target_not_found');
                const item = s.data() as PaidItem;
                if (item.room_id !== body.room_id) throw new HttpError(400, 'target_wrong_room');
                const doc = a.kind === 'bill' ? billToDoc(item as MonthlyBill) : fineToDoc(item as Fine);
                if (doc.status !== 'issued') throw new HttpError(409, 'target_not_issued');
                const legacyPaid = !!legacyPayment(a.kind as 'bill' | 'fine', item);
                const already = legacyPaid ? doc.total_satang : (item.allocated_satang ?? 0);
                if (a.satang > doc.total_satang - already) throw new HttpError(409, 'exceeds_outstanding', { id: a.id, outstanding_satang: doc.total_satang - already });
                const nowAllocated = already + a.satang;
                const data: Record<string, unknown> = { allocated_satang: nowAllocated, payments_recorded: true, updated_at: now };
                if (nowAllocated >= doc.total_satang) {
                    // fully paid: keep the fields the rest of the app reads in step
                    Object.assign(data, {
                        paid_at: paidAt.toISOString(), paid_method: 'manual', payment_method: method, paid_amount: doc.total_satang / 100,
                        ...(a.kind === 'bill' ? { payment_status: 'paid' } : { status: 'paid' }),
                        ...(method === 'bank_transfer' ? { bank_account_id: body.bank_account_id, bank_account: bankName, verification_status: 'unverified' } : {}),
                    });
                }
                updates.push({ ref: refs[i], data });
            });
            const payment: PaymentRec & Record<string, unknown> = {
                id: paymentId, room_id: body.room_id!, channel: channelOf(method, body.bank_account_id), method, paid_at: paidAt.toISOString(),
                gross_satang: gross, verification: method === 'cash' ? 'n/a' : 'unverified', status: 'active',
                allocations: cleaned.map(a => ({ target_kind: a.kind as 'bill' | 'fine', target_id: a.id as string, amount_satang: a.satang })),
                revision: '', bank_account_id: method === 'bank_transfer' ? body.bank_account_id : null, transaction_ref: ref,
                note, created_at: now, created_by: who.uid, received_by: who.displayName,
            };
            payment.revision = `${gross}|${payment.paid_at}|${payment.channel}|${payment.allocations.map(x => `${x.target_kind}:${x.target_id}=${x.amount_satang}`).join(',')}`;
            tx.set(db.doc(`${base}/payments/${paymentId}`), payment);
            for (const u of updates) tx.update(u.ref, u.data);
            return payment;
        });
        await audit('CREATE', 'payment', paymentId, `Room ${(roomSnap.data() as { room_number?: string }).room_number} ${gross / 100} THB`, {
            note: `${method}, ${cleaned.length} allocation(s), date ${thDate(result.paid_at)}`,
        });
        res.status(200).json({ payment: result });
    }

    // ── verify_payment: confirm a recorded transfer against a real bank transaction ──
    async function verifyPayment() {
        const base = bldBase(owner, properties[0]);
        if (typeof body.payment_id !== 'string' || !body.payment_id || typeof body.bank_transaction_id !== 'string' || !body.bank_transaction_id) throw new HttpError(400, 'invalid_input');
        const payRef = db.doc(`${base}/payments/${body.payment_id}`);
        const txRef = db.doc(`${base}/bank_transactions/${body.bank_transaction_id}`);
        const [paySnap, txSnap] = await Promise.all([payRef.get(), txRef.get()]);
        if (!paySnap.exists || !txSnap.exists) throw new HttpError(404, 'not_found');
        const pay = paySnap.data() as PaymentRec & { bank_account_id?: string };
        const bt = txSnap.data() as { amount: number; bank_account_id: string; status: string; payment_id?: string };
        if (pay.method !== 'bank_transfer' || pay.status !== 'active') throw new HttpError(409, 'not_a_transfer');
        if (toSatang(bt.amount) !== pay.gross_satang) throw new HttpError(400, 'amount_mismatch');
        if (bt.bank_account_id !== pay.bank_account_id) throw new HttpError(400, 'account_mismatch');
        if (bt.status === 'reconciled' || bt.payment_id) throw new HttpError(409, 'transaction_already_used');
        const taken = await db.collection(`${base}/payments`).where('bank_transaction_id', '==', body.bank_transaction_id).get();
        if (taken.docs.length) throw new HttpError(409, 'transaction_already_used');
        const now = new Date().toISOString();
        await payRef.update({ verification: 'verified', bank_transaction_id: body.bank_transaction_id, verified_at: now, verified_by: who.uid });
        await txRef.update({ status: 'reconciled', payment_id: pay.id, matched: null, reconciled_at: now, reconciled_by: who.uid });
        await audit('UPDATE', 'payment', pay.id, `verified ${pay.gross_satang / 100} THB`, { note: `bank transaction ${body.bank_transaction_id}` });
        res.status(200).json({ ok: true });
    }
}

/** Order-independent digest of vouchers (their keys and amounts). */
export function checksum(vs: Pick<Voucher, 'key' | 'total_dr_satang' | 'total_cr_satang' | 'lines'>[]): string {
    const h = createHash('sha256');
    for (const v of [...vs].sort((a, b) => a.key.localeCompare(b.key))) {
        h.update(`${v.key}|${v.total_dr_satang}|${v.total_cr_satang}|${v.lines.map(l => `${l.account}:${l.dr_satang}:${l.cr_satang}:${l.customer_code ?? ''}`).join(';')}\n`);
    }
    return h.digest('hex');
}
