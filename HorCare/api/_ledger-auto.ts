/**
 * Automatic posting into the owner's ledger as soon as something happens, so nobody has to press "post":
 *
 *   autoPostCharges   – daily / weekly collection charges and their receipts (collections flow)
 *   autoPostBuilding  – bills / fines issued (invoices) and money received for them (receipts)
 *
 * Both use exactly the rules of a manual post (buildVouchers + voucherToLines) and the same entry ids, so they are
 * idempotent and a manual post afterwards finds nothing new. They never throw into the caller: a missing / incomplete
 * ledger or a closed period just leaves the entries for the normal post run, which shows exactly why.
 */
import { createHash } from 'node:crypto';
import { db } from './_firebase.js';
import { loadBuilding, loadCharges } from './_accounting-data.js';
import { buildVouchers, thDate, type VoucherKind } from '../src/shared/accounting.js';
import { isLocked, ledgerGaps, postedSources, postingProfile, validateEntryLines, voucherToLines, type JournalEntry, type Ledger } from '../src/shared/ledger.js';

export interface AutoPostResult { posted: number; reason?: 'no_ledger' | 'ledger_incomplete' | 'blocked' | 'error' }

export const entryId = (ledgerId: string, key: string) => createHash('sha1').update(`${ledgerId}|${key}`).digest('hex').slice(0, 24);
const DAY_MS = 86_400_000;

export async function autoPostCharges(owner: string, buildingId: string, who: { uid: string; displayName: string }): Promise<AutoPostResult> {
    try {
        const ledgers = (await db.collection(`users/${owner}/ledgers`).get()).docs.map(d => d.data() as Ledger);
        const ledger = ledgers.find(l => l.property_ids.includes(buildingId));
        if (!ledger) return { posted: 0, reason: 'no_ledger' };
        if (ledgerGaps(ledger).length) return { posted: 0, reason: 'ledger_incomplete' };

        const nowIso = new Date().toISOString();
        const to = thDate(nowIso);
        const from = thDate(new Date(Date.now() - 120 * DAY_MS).toISOString());
        const { docs, payments } = await loadCharges(owner, buildingId, ledger.property_codes[buildingId]);
        const base = `users/${owner}/ledgers/${ledger.id}`;
        const entries = (await db.collection(`${base}/entries`).get()).docs.map(d => d.data() as JournalEntry);

        let posted = 0;
        // invoices first: a receipt is only accepted once the invoice it settles is in the books
        for (const kind of ['invoice', 'receipt'] as const) {
            const result = buildVouchers({
                profile: postingProfile(ledger), kind, from, to, docs, payments, exported: postedSources(entries), requireCustomerCode: false,
            });
            for (const v of result.vouchers) {
                if (isLocked(v.voucher_date, ledger.locked_through)) continue;
                const id = entryId(ledger.id, v.key);
                const ref = db.doc(`${base}/entries/${id}`);
                if ((await ref.get()).exists) continue;
                const lines = voucherToLines(v);
                if (validateEntryLines(lines, ledger.accounts).length) continue;
                const entry: JournalEntry = {
                    id, ledger_id: ledger.id, kind: v.kind, key: v.key, doc_ref: v.doc_ref, date: v.voucher_date,
                    memo: v.kind === 'invoice' ? `ตั้งลูกหนี้ ${v.room_number}` : `รับชำระ ${v.room_number}`, lines, total_satang: v.total_dr_satang,
                    sources: v.sources, posted_at: nowIso, posted_by: who.uid, posted_by_name: who.displayName,
                };
                await ref.set(entry);
                entries.push(entry);
                posted++;
            }
            if (kind === 'invoice' && result.problems.length) return { posted, reason: 'blocked' };
        }
        return { posted };
    } catch (e) {
        console.error('autoPostCharges failed', e);
        return { posted: 0, reason: 'error' };
    }
}

// ── bills / fines ─────────────────────────────────────────────────────────────
// Triggers: every server-side payment (slip auto-approval, split payment, recorded payment, reconciliation),
// bills sent on LINE, the owner app after marking a bill paid, and a daily cron. A ledger opts out with
// options.auto_post === false.

/** How far back an automatic run looks; older items are left to a manual post. */
const LOOKBACK_DAYS = 93;

export interface BuildingAutoPostResult {
    ledger_id: string;
    posted: number;
    skipped: number;
    problems: string[];
}

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** Post everything new for the ledger that holds this building. Returns null when there is none / it is off. */
export async function autoPostBuilding(owner: string, buildingId: string, now = new Date()): Promise<BuildingAutoPostResult | null> {
    const ledgers = (await db.collection(`users/${owner}/ledgers`).get()).docs.map(d => d.data() as Ledger & { options: { auto_post?: boolean } });
    const l = ledgers.find(x => x.property_ids?.includes(buildingId));
    if (!l || l.options?.auto_post === false) return null;

    const nowIso = now.toISOString();
    const today = thDate(nowIso);
    const result: BuildingAutoPostResult = { ledger_id: l.id, posted: 0, skipped: 0, problems: [] };
    const gaps = ledgerGaps(l);
    if (gaps.length) {
        result.problems = gaps.map(g => g.message);
    } else {
        let from = addDays(today, -LOOKBACK_DAYS);
        if (l.locked_through && l.locked_through >= from) from = addDays(l.locked_through, 1);
        if (from <= today) {
            const loaded = await Promise.all(l.property_ids.map(b => loadBuilding(owner, b, l.property_codes?.[b])));
            const entriesCol = db.collection(`${`users/${owner}/ledgers/${l.id}`}/entries`);
            const entries = (await entriesCol.get()).docs.map(d => d.data() as JournalEntry);
            for (const kind of ['invoice', 'receipt'] as VoucherKind[]) {
                const run = buildVouchers({
                    profile: postingProfile(l), kind, from, to: today,
                    docs: loaded.flatMap(x => x.docs), payments: loaded.flatMap(x => x.payments), exported: postedSources(entries), requireCustomerCode: false,
                });
                result.problems.push(...run.problems.map(p => p.message));
                for (const v of run.vouchers) {
                    if (isLocked(v.voucher_date, l.locked_through)) continue;
                    const id = entryId(l.id, v.key);
                    const ref = db.doc(`${`users/${owner}/ledgers/${l.id}`}/entries/${id}`);
                    if ((await ref.get()).exists) { result.skipped++; continue; }
                    const lines = voucherToLines(v);
                    const issues = validateEntryLines(lines, l.accounts);
                    if (issues.length) { result.problems.push(`${v.doc_ref}: ${issues[0].message}`); continue; }
                    const entry: JournalEntry = {
                        id, ledger_id: l.id, kind: v.kind, key: v.key, doc_ref: v.doc_ref, date: v.voucher_date,
                        memo: v.kind === 'invoice' ? `ตั้งลูกหนี้ ${v.room_number}` : `รับชำระ ${v.room_number}`, lines, total_satang: v.total_dr_satang,
                        sources: v.sources, posted_at: nowIso, posted_by: 'system', posted_by_name: 'ลงบัญชีอัตโนมัติ',
                    };
                    await ref.set(entry);
                    entries.push(entry);
                    result.posted++;
                }
            }
        }
    }
    await db.doc(`users/${owner}/ledgers/${l.id}`).update({
        auto_post: { at: nowIso, posted: result.posted, problems: result.problems.length, first_problem: result.problems[0] ?? null },
    });
    return result;
}

/** For payment flows: post in the background of the request, never failing it. */
export async function autoPostSafe(owner: string, buildingId: string): Promise<void> {
    try {
        await autoPostBuilding(owner, buildingId);
    } catch (e) {
        console.error('[auto-post]', owner, buildingId, (e as Error).message);
    }
}
