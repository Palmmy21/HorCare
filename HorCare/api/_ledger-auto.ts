/**
 * Posts daily / weekly collection charges and their receipts into the owner's ledger as soon as money is recorded,
 * so a slip read by AI (or cash taken in the field) lands in the books without a separate "post" run.
 *
 * Deliberately narrow: only collection charges and their payments are posted here — bills and fines still go through
 * the accountant's own post run. It never throws into the caller: a missing / incomplete ledger or a closed period just
 * leaves the entries for the normal post run, which shows exactly why.
 */
import { createHash } from 'node:crypto';
import { db } from './_firebase.js';
import { loadCharges } from './_accounting-data.js';
import { buildVouchers, thDate } from '../src/shared/accounting.js';
import { isLocked, ledgerGaps, postedSources, postingProfile, validateEntryLines, voucherToLines, type JournalEntry, type Ledger } from '../src/shared/ledger.js';

export interface AutoPostResult { posted: number; reason?: 'no_ledger' | 'ledger_incomplete' | 'blocked' | 'error' }

const entryId = (ledgerId: string, key: string) => createHash('sha1').update(`${ledgerId}|${key}`).digest('hex').slice(0, 24);
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