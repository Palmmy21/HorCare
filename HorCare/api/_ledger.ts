/**
 * /api/ledger — HorCare's own books.
 *
 * The only writer of ledgers and journal entries (clients can read under rules that need `ledger.read`).
 * Entries are immutable: a mistake is fixed by a reversal. Posting uses the same rules as the Mango
 * export (src/shared/accounting.ts) so what lands in the books is what an export would have contained.
 *
 * Actions: ledger_save | lock_period | unlock_period | post_preview | post | reverse | manual_entry
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash, randomUUID } from 'node:crypto';
import { db } from './_firebase.js';
import { authorize, buildingExists, type AuthContext } from './_rbac.js';
import { writeAudit } from './_audit.js';
import { loadBuilding } from './_accounting.js';
import {
    buildVouchers, sumCr, sumDr, thDate, toSatang, type PostingResult, type VoucherKind,
} from '../src/shared/accounting.js';
import {
    ACCOUNT_TYPES, isLocked, ledgerGaps, MAX_MEMO, postedSources, postingProfile, reversalLines, validateChart, validateEntryLines, voucherToLines,
    type Account, type EntryLine, type JournalEntry, type Ledger,
} from '../src/shared/ledger.js';
import type { Permission } from '../src/shared/permissions.js';

export const config = { maxDuration: 60 };

type Action = 'ledger_save' | 'lock_period' | 'unlock_period' | 'post_preview' | 'post' | 'reverse' | 'manual_entry';
const ACTIONS: Action[] = ['ledger_save', 'lock_period', 'unlock_period', 'post_preview', 'post', 'reverse', 'manual_entry'];
const PERMISSION: Record<Action, Permission> = {
    ledger_save: 'ledger.manage', lock_period: 'ledger.manage', unlock_period: 'ledger.manage',
    post_preview: 'ledger.post', post: 'ledger.post', reverse: 'ledger.post', manual_entry: 'ledger.post',
};

interface Body {
    action?: Action;
    owner_uid?: string;
    ledger?: unknown;
    ledger_id?: string;
    kind?: string;
    from?: string;
    to?: string;
    through?: string | null;
    entry_id?: string;
    reason?: unknown;
    date?: string;
    memo?: unknown;
    lines?: { account?: unknown; debit?: unknown; credit?: unknown; description?: unknown; party_id?: unknown }[];
}

class HttpError extends Error {
    constructor(public status: number, public code: string, public detail?: unknown) { super(code); }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BAHT = 100_000_000;
const ledgerPath = (o: string, id: string) => `users/${o}/ledgers/${id}`;
const entryId = (ledgerId: string, key: string) => createHash('sha1').update(`${ledgerId}|${key}`).digest('hex').slice(0, 24);

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim().length <= max ? v.trim() : null);

/** Validate untrusted ledger JSON; returns a clean Ledger (without timestamps) or null. */
export function cleanLedger(raw: unknown, id: string): Ledger | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const name = str(r.name, 80), entity = str(r.legal_entity_name, 120);
    if (name === null || entity === null) return null;
    if (!Array.isArray(r.property_ids) || r.property_ids.length > 50 || r.property_ids.some((p: unknown) => typeof p !== 'string' || !p || p.length > 128)) return null;
    if (!Array.isArray(r.accounts) || r.accounts.length > 300) return null;
    const accounts: Account[] = [];
    for (const a of r.accounts) {
        const code = str(a?.code, 20), nm = str(a?.name, 100);
        if (code === null || nm === null || !ACCOUNT_TYPES.includes(a?.type) || typeof a?.active !== 'boolean') return null;
        const external: Record<string, string> = {};
        for (const [k, v] of Object.entries(a?.external ?? {})) { const c = str(v, 40); if (c === null || !k || k.length > 20) return null; if (c) external[k] = c; }
        accounts.push({ code, name: nm, type: a.type, active: a.active, ...(Object.keys(external).length ? { external } : {}) });
    }
    const p = r.posting ?? {}, o = r.options ?? {};
    const ar = str(p.ar_account, 20);
    if (ar === null) return null;
    const rev: Ledger['posting']['revenue_accounts'] = {};
    for (const [k, v] of Object.entries(p.revenue_accounts ?? {})) {
        if (!['rent', 'electric', 'water', 'common_fee', 'fine'].includes(k)) return null;
        const c = str(v, 20); if (c === null) return null; if (c) rev[k as keyof typeof rev] = c;
    }
    const channels: Record<string, string> = {};
    for (const [k, v] of Object.entries(p.channels ?? {})) { const c = str(v, 20); if (!k || k.length > 80 || c === null) return null; if (c) channels[k] = c; }
    const property_codes: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.property_codes ?? {})) { const c = str(v, 12); if (c === null) return null; if (c) property_codes[k] = c; }
    const cutoff = o.opening_cutoff_month === null || o.opening_cutoff_month === undefined || o.opening_cutoff_month === '' ? null : String(o.opening_cutoff_month);
    if (cutoff !== null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(cutoff)) return null;
    if (!['issued_at', 'month_end'].includes(o.invoice_date_basis) || typeof o.count_unverified_transfers !== 'boolean') return null;
    return {
        id, name, legal_entity_name: entity, property_ids: [...new Set<string>(r.property_ids)], property_codes, accounts,
        posting: { ar_account: ar, revenue_accounts: rev, channels },
        options: { invoice_date_basis: o.invoice_date_basis, count_unverified_transfers: o.count_unverified_transfers, opening_cutoff_month: cutoff },
        locked_through: null, created_at: '', updated_at: '',
    };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const body = (req.body ?? {}) as Body;
    const action = body.action;
    if (!action || !ACTIONS.includes(action)) { res.status(400).json({ error: 'unknown_action' }); return; }
    if (typeof body.owner_uid !== 'string' || !body.owner_uid) { res.status(400).json({ error: 'invalid_input' }); return; }
    const owner = body.owner_uid;

    let ledger: Ledger | null = null;
    let incoming: Ledger | null = null;
    let properties: string[] = [];
    try {
        if (action === 'ledger_save') {
            const id = typeof body.ledger_id === 'string' && body.ledger_id ? body.ledger_id : randomUUID();
            incoming = cleanLedger(body.ledger, id);
            if (!incoming || incoming.property_ids.length === 0) throw new HttpError(400, 'invalid_input');
            const issues = validateChart(incoming.accounts);
            if (issues.length) throw new HttpError(400, 'invalid_chart', issues);
            properties = incoming.property_ids;
        } else {
            if (typeof body.ledger_id !== 'string' || !body.ledger_id) throw new HttpError(400, 'invalid_input');
            const snap = await db.doc(ledgerPath(owner, body.ledger_id)).get();
            if (!snap.exists) throw new HttpError(404, 'not_found');
            ledger = snap.data() as Ledger;
            properties = ledger.property_ids;
        }
    } catch (e) {
        if (e instanceof HttpError) { res.status(e.status).json({ error: e.code, ...(e.detail ? { detail: e.detail } : {}) }); return; }
        throw e;
    }

    let ctx: AuthContext | null = null;
    for (const bld of properties) {
        ctx = await authorize(req, res, { ownerUid: owner, buildingId: bld, permission: PERMISSION[action] });
        if (!ctx) return;
        if (!(await buildingExists(owner, bld))) { res.status(404).json({ error: 'property_not_found' }); return; }
    }
    if (!ctx) { res.status(400).json({ error: 'invalid_input' }); return; }
    const who = ctx;
    const nowIso = new Date().toISOString();
    const today = thDate(nowIso);
    const audit = (act: 'CREATE' | 'UPDATE', type: 'ledger' | 'journal_entry', id: string, label: string, extra: object = {}) =>
        writeAudit({
            ownerUid: owner, propertyId: properties[0], userId: who.uid, userName: who.displayName, role: who.role,
            action: act, resourceType: type, resourceId: id, resourceLabel: label, req, ...extra,
        });
    const entriesOf = async (l: Ledger) =>
        (await db.collection(`${ledgerPath(owner, l.id)}/entries`).get()).docs.map(d => d.data() as JournalEntry);

    try {
        switch (action) {
            case 'ledger_save': return await saveLedger();
            case 'lock_period': return await lockPeriod();
            case 'unlock_period': return await unlockPeriod();
            case 'post_preview':
            case 'post': return await postRun();
            case 'reverse': return await reverseEntry();
            case 'manual_entry': return await manualEntry();
        }
    } catch (e) {
        if (e instanceof HttpError) { res.status(e.status).json({ error: e.code, ...(e.detail ? { detail: e.detail } : {}) }); return; }
        throw e;
    }

    // ── ledger_save ──────────────────────────────────────────────────────────
    async function saveLedger() {
        const next = incoming!;
        const col = `users/${owner}/ledgers`;
        const all = (await db.collection(col).get()).docs.map(d => d.data() as Ledger);
        const clash = all.find(o => o.id !== next.id && o.property_ids.some(p => next.property_ids.includes(p)));
        if (clash) throw new HttpError(409, 'property_in_other_ledger', clash.name);
        const prev = all.find(o => o.id === next.id) ?? null;
        if (prev) {
            // posted money must stay explainable: no account that has entries may disappear or change type
            const used = new Map<string, Account>();
            for (const e of await entriesOf(prev)) for (const l of e.lines) used.set(l.account, prev.accounts.find(a => a.code === l.account) ?? { code: l.account, name: '', type: 'asset', active: true });
            const bad = [...used.keys()].filter(code => {
                const n = next.accounts.find(a => a.code === code);
                const old = prev.accounts.find(a => a.code === code);
                return !n || (old && n.type !== old.type);
            });
            if (bad.length) throw new HttpError(409, 'account_in_use', bad);
        }
        const saved: Ledger = { ...next, locked_through: prev?.locked_through ?? null, created_at: prev?.created_at ?? nowIso, updated_at: nowIso };
        await db.doc(ledgerPath(owner, saved.id)).set(saved);
        await audit(prev ? 'UPDATE' : 'CREATE', 'ledger', saved.id, saved.name, { note: `${saved.accounts.length} accounts` });
        res.status(200).json({ ledger: saved, gaps: ledgerGaps(saved) });
    }

    // ── periods ──────────────────────────────────────────────────────────────
    async function lockPeriod() {
        const l = ledger!;
        if (typeof body.through !== 'string' || !DATE_RE.test(body.through) || body.through > today) throw new HttpError(400, 'invalid_input');
        if (l.locked_through && body.through < l.locked_through) throw new HttpError(409, 'use_unlock_to_reopen');
        await db.doc(ledgerPath(owner, l.id)).update({ locked_through: body.through, updated_at: nowIso });
        await audit('UPDATE', 'ledger', l.id, l.name, { before: { locked_through: l.locked_through }, after: { locked_through: body.through } });
        res.status(200).json({ locked_through: body.through });
    }
    async function unlockPeriod() {
        const l = ledger!;
        const reason = str(body.reason, 300);
        if (!reason) throw new HttpError(400, 'reason_required');
        const through = body.through === null || body.through === undefined ? null : body.through;
        if (through !== null && (typeof through !== 'string' || !DATE_RE.test(through))) throw new HttpError(400, 'invalid_input');
        if (through !== null && l.locked_through && through >= l.locked_through) throw new HttpError(400, 'invalid_input'); // that is a lock, not an unlock
        await db.doc(ledgerPath(owner, l.id)).update({ locked_through: through, updated_at: nowIso });
        await audit('UPDATE', 'ledger', l.id, l.name, { before: { locked_through: l.locked_through }, after: { locked_through: through }, note: `reopened: ${reason}` });
        res.status(200).json({ locked_through: through });
    }

    // ── post_preview / post ──────────────────────────────────────────────────
    async function postRun() {
        const l = ledger!;
        const kind = body.kind;
        if ((kind !== 'invoice' && kind !== 'receipt') || typeof body.from !== 'string' || typeof body.to !== 'string'
            || !DATE_RE.test(body.from) || !DATE_RE.test(body.to) || body.from > body.to) throw new HttpError(400, 'invalid_input');
        const gaps = ledgerGaps(l);
        const loaded = await Promise.all(l.property_ids.map(b => loadBuilding(owner, b, l.property_codes[b])));
        const entries = await entriesOf(l);
        const result: PostingResult = buildVouchers({
            profile: postingProfile(l), kind: kind as VoucherKind, from: body.from, to: body.to,
            docs: loaded.flatMap(x => x.docs), payments: loaded.flatMap(x => x.payments), exported: postedSources(entries), requireCustomerCode: false,
        });
        // entries for a closed period are refused, and shown as problems so the user sees why
        const accepted = [];
        for (const v of result.vouchers) {
            if (isLocked(v.voucher_date, l.locked_through)) {
                result.problems.push({ code: 'period_locked', message: `งวดถึง ${l.locked_through} ปิดแล้ว — ลงบัญชีวันที่ ${v.voucher_date} ไม่ได้`, source: { kind: v.sources[0].kind, id: v.sources[0].id, label: v.doc_ref } });
            } else accepted.push(v);
        }
        result.vouchers = accepted;
        const summary = { documents: accepted.length, dr_satang: sumDr(accepted), cr_satang: sumCr(accepted), problems: result.problems.length, excluded: result.excluded.length };

        if (action === 'post_preview') { res.status(200).json({ ...result, summary, gaps }); return; }
        if (gaps.length) throw new HttpError(409, 'ledger_incomplete', gaps);
        if (result.problems.length) throw new HttpError(409, 'blocked', { problems: result.problems, summary });
        if (accepted.length === 0) throw new HttpError(409, 'nothing_to_post');

        let posted = 0; let skipped = 0;
        for (const v of accepted) {
            const id = entryId(l.id, v.key);
            const ref = db.doc(`${ledgerPath(owner, l.id)}/entries/${id}`);
            if ((await ref.get()).exists) { skipped++; continue; }
            const lines = voucherToLines(v);
            const issues = validateEntryLines(lines, l.accounts);
            if (issues.length) throw new HttpError(409, 'blocked', { problems: issues.map(i => ({ code: 'entry_invalid', message: i.message, source: { kind: 'bill', id: v.sources[0].id, label: v.doc_ref } })) });
            const entry: JournalEntry = {
                id, ledger_id: l.id, kind: v.kind, key: v.key, doc_ref: v.doc_ref, date: v.voucher_date,
                memo: v.kind === 'invoice' ? `ตั้งลูกหนี้ ${v.room_number}` : `รับชำระ ${v.room_number}`, lines, total_satang: v.total_dr_satang,
                sources: v.sources, posted_at: nowIso, posted_by: who.uid, posted_by_name: who.displayName,
            };
            await ref.set(entry);
            posted++;
        }
        await audit('CREATE', 'journal_entry', l.id, `${kind} ${body.from}..${body.to}`, { note: `posted ${posted}, already posted ${skipped}` });
        res.status(200).json({ posted, skipped, summary });
    }

    // ── reverse ──────────────────────────────────────────────────────────────
    async function reverseEntry() {
        const l = ledger!;
        const reason = str(body.reason, 200);
        if (!reason) throw new HttpError(400, 'reason_required');
        if (typeof body.entry_id !== 'string' || !body.entry_id) throw new HttpError(400, 'invalid_input');
        const date = body.date ?? today;
        if (typeof date !== 'string' || !DATE_RE.test(date) || date > today) throw new HttpError(400, 'invalid_input');
        if (isLocked(date, l.locked_through)) throw new HttpError(409, 'period_locked');

        const origRef = db.doc(`${ledgerPath(owner, l.id)}/entries/${body.entry_id}`);
        const revId = entryId(l.id, `reversal|${body.entry_id}`);
        const revRef = db.doc(`${ledgerPath(owner, l.id)}/entries/${revId}`);
        const rev = await db.runTransaction(async tx => {
            const [o, r] = await Promise.all([tx.get(origRef), tx.get(revRef)]);
            if (!o.exists) throw new HttpError(404, 'not_found');
            const orig = o.data() as JournalEntry;
            if (orig.kind === 'reversal') throw new HttpError(409, 'cannot_reverse_a_reversal');
            if (orig.reversed_by || r.exists) throw new HttpError(409, 'already_reversed');
            if (date < orig.date) throw new HttpError(400, 'invalid_input');
            const entry: JournalEntry = {
                id: revId, ledger_id: l.id, kind: 'reversal', key: `reversal|${orig.id}`, doc_ref: `REV-${orig.doc_ref}`.slice(0, 40), date,
                memo: `กลับรายการ ${orig.doc_ref}: ${reason}`.slice(0, MAX_MEMO), lines: reversalLines(orig.lines), total_satang: orig.total_satang,
                sources: orig.sources, posted_at: nowIso, posted_by: who.uid, posted_by_name: who.displayName, reversal_of: orig.id, reason,
            };
            tx.set(revRef, entry);
            tx.update(origRef, { reversed_by: revId });
            return entry;
        });
        await audit('CREATE', 'journal_entry', rev.id, rev.doc_ref, { note: `reverses ${body.entry_id}: ${reason}` });
        res.status(200).json({ entry: rev });
    }

    // ── manual_entry ─────────────────────────────────────────────────────────
    async function manualEntry() {
        const l = ledger!;
        const memo = str(body.memo, MAX_MEMO);
        if (!memo) throw new HttpError(400, 'memo_required');
        const date = body.date;
        if (typeof date !== 'string' || !DATE_RE.test(date) || date > today) throw new HttpError(400, 'invalid_input');
        if (isLocked(date, l.locked_through)) throw new HttpError(409, 'period_locked');
        if (!Array.isArray(body.lines)) throw new HttpError(400, 'invalid_input');
        const lines: EntryLine[] = [];
        for (const x of body.lines) {
            const dr = x.debit === undefined || x.debit === null || x.debit === '' ? 0 : x.debit;
            const cr = x.credit === undefined || x.credit === null || x.credit === '' ? 0 : x.credit;
            const desc = str(x.description ?? '', 200), party = x.party_id === undefined || x.party_id === null || x.party_id === '' ? null : str(x.party_id, 128);
            if (typeof x.account !== 'string' || typeof dr !== 'number' || typeof cr !== 'number' || dr < 0 || cr < 0 || dr > MAX_BAHT || cr > MAX_BAHT || desc === null || party === undefined) {
                throw new HttpError(400, 'invalid_input');
            }
            lines.push({ account: x.account, dr_satang: toSatang(dr), cr_satang: toSatang(cr), description: desc || memo, party_id: party });
        }
        const issues = validateEntryLines(lines, l.accounts);
        if (issues.length) throw new HttpError(400, 'invalid_entry', issues);
        const id = randomUUID();
        const entry: JournalEntry = {
            id, ledger_id: l.id, kind: 'manual', key: `manual|${id}`, doc_ref: `JV-${id.slice(0, 8).toUpperCase()}`, date, memo, lines,
            total_satang: lines.reduce((s, x) => s + x.dr_satang, 0), sources: [], posted_at: nowIso, posted_by: who.uid, posted_by_name: who.displayName,
        };
        await db.doc(`${ledgerPath(owner, l.id)}/entries/${id}`).set(entry);
        await audit('CREATE', 'journal_entry', id, entry.doc_ref, { note: memo });
        res.status(200).json({ entry });
    }
}
