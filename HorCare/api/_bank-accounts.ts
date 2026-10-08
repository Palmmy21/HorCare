/**
 * /api/bank-accounts — the accounts a property receives rent into.
 *
 * Writes only (create / update / set_default). Reading goes straight to Firestore under rules
 * that need `finance.read` on the property. Every write needs `bank_account.manage`, is checked
 * against the property, and is audited (with the last 4 digits only, never the full number).
 *
 * Accounts are never deleted: payments keep pointing at them. "Remove" means status = inactive.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import { db } from './_firebase.js';
import { authorize, buildingExists } from './_rbac.js';
import { writeAudit } from './_audit.js';
import { bankByCode, digitsOnly, isValidAccountNumber, type BankAccount } from '../src/shared/banks.js';

export const config = { maxDuration: 15 };

interface Body {
    action?: 'create' | 'update' | 'set_default' | 'tenant_list';
    room_id?: string;
    owner_uid?: string;
    building_id?: string;
    account_id?: string;
    bank_code?: string;
    account_name?: string;
    account_number?: string;
    nickname?: string;
    status?: string;
}

const last4 = (n: string) => `••••${digitsOnly(n).slice(-4)}`;

function cleanText(v: unknown, min: number, max: number): string | null | undefined {
    if (v === undefined || v === null) return null;
    if (typeof v !== 'string') return undefined;
    const t = v.replace(/\s+/g, ' ').trim();
    if (t.length === 0) return null;
    return t.length >= min && t.length <= max ? t : undefined;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const body = (req.body ?? {}) as Body;
    const buildingId = body.building_id;
    if (!buildingId || typeof buildingId !== 'string') { res.status(400).json({ error: 'building_id is required' }); return; }
    // Tenant portal: the active accounts a tenant can transfer to. No login (like parcels
    // `tenant_list`), so it proves the room exists and returns only what a bill already shows.
    if (body.action === 'tenant_list') {
        const owner = body.owner_uid;
        if (typeof owner !== 'string' || !owner || typeof body.room_id !== 'string' || !body.room_id) { res.status(400).json({ error: 'invalid_input' }); return; }
        const base = `users/${owner}/buildings/${buildingId}`;
        if (!(await db.doc(`${base}/rooms/${body.room_id}`).get()).exists) { res.status(404).json({ error: 'not_found' }); return; }
        const snap = await db.collection(`${base}/bank_accounts`).get();
        const accounts = snap.docs.map(d => d.data() as BankAccount)
            .filter(a => a.status === 'active')
            .sort((a, b) => Number(b.is_default) - Number(a.is_default))
            .map(a => ({ id: a.id, bank_code: a.bank_code, bank_short: a.bank_short, account_name: a.account_name, account_number: a.account_number, nickname: a.nickname ?? null, is_default: a.is_default }));
        res.status(200).json({ accounts });
        return;
    }
    if (body.action !== 'create' && body.action !== 'update' && body.action !== 'set_default') {
        res.status(400).json({ error: 'unknown_action' });
        return;
    }

    const ctx = await authorize(req, res, { ownerUid: body.owner_uid, buildingId, permission: 'bank_account.manage' });
    if (!ctx) return;
    if (!(await buildingExists(ctx.ownerUid, buildingId))) { res.status(404).json({ error: 'property_not_found' }); return; }

    const col = `users/${ctx.ownerUid}/buildings/${buildingId}/bank_accounts`;
    const audit = (action: 'CREATE' | 'UPDATE', acc: BankAccount, extra: object = {}) => writeAudit({
        ownerUid: ctx.ownerUid, propertyId: buildingId, userId: ctx.uid, userName: ctx.displayName, role: ctx.role,
        action, resourceType: 'bank_account', resourceId: acc.id, resourceLabel: `${acc.bank_short} ${last4(acc.account_number)}`, req, ...extra,
    });

    // ── create ───────────────────────────────────────────────────────────────
    if (body.action === 'create') {
        const bank = bankByCode(body.bank_code);
        const name = cleanText(body.account_name, 2, 100);
        const nick = cleanText(body.nickname, 1, 40);
        if (!bank || !name || nick === undefined || typeof body.account_number !== 'string' || !isValidAccountNumber(body.account_number)) {
            res.status(400).json({ error: 'invalid_input' });
            return;
        }
        const number = digitsOnly(body.account_number);

        const existing = await db.collection(col).get();
        const docs = existing.docs.map(d => d.data() as BankAccount);
        if (docs.some(a => a.bank_code === bank.code && a.account_number === number)) {
            res.status(409).json({ error: 'duplicate_account', message: 'มีบัญชีนี้อยู่แล้ว' });
            return;
        }
        const now = new Date().toISOString();
        const account: BankAccount = {
            id: randomUUID(), bank_code: bank.code, bank_short: bank.short, account_name: name, account_number: number,
            nickname: nick, status: 'active',
            // the first account becomes the default automatically
            is_default: !docs.some(a => a.status === 'active' && a.is_default),
            created_at: now, updated_at: now,
        };
        await db.doc(`${col}/${account.id}`).set(account);
        await audit('CREATE', account, { after: { bank: bank.short, name } });
        res.status(200).json({ account });
        return;
    }

    // everything else targets an existing account
    if (!body.account_id || typeof body.account_id !== 'string') { res.status(400).json({ error: 'account_id is required' }); return; }
    const ref = db.doc(`${col}/${body.account_id}`);
    const snap = await ref.get();
    if (!snap.exists) { res.status(404).json({ error: 'not_found' }); return; }
    const current = snap.data() as BankAccount;
    const now = new Date().toISOString();

    // ── set_default ──────────────────────────────────────────────────────────
    if (body.action === 'set_default') {
        if (current.status !== 'active') { res.status(409).json({ error: 'account_inactive' }); return; }
        const all = await db.collection(col).get();
        for (const d of all.docs) {
            const a = d.data() as BankAccount;
            if (a.id !== current.id && a.is_default) await db.doc(`${col}/${a.id}`).update({ is_default: false, updated_at: now });
        }
        await ref.update({ is_default: true, updated_at: now });
        await audit('UPDATE', current, { note: 'set as default' });
        res.status(200).json({ ok: true });
        return;
    }

    // ── update ───────────────────────────────────────────────────────────────
    const updates: Partial<BankAccount> = {};
    if (body.bank_code !== undefined) {
        const bank = bankByCode(body.bank_code);
        if (!bank) { res.status(400).json({ error: 'invalid_input' }); return; }
        updates.bank_code = bank.code;
        updates.bank_short = bank.short;
    }
    if (body.account_name !== undefined) {
        const n = cleanText(body.account_name, 2, 100);
        if (!n) { res.status(400).json({ error: 'invalid_input' }); return; }
        updates.account_name = n;
    }
    if (body.account_number !== undefined) {
        if (typeof body.account_number !== 'string' || !isValidAccountNumber(body.account_number)) { res.status(400).json({ error: 'invalid_input' }); return; }
        updates.account_number = digitsOnly(body.account_number);
    }
    if (body.nickname !== undefined) {
        const n = cleanText(body.nickname, 1, 40);
        if (n === undefined) { res.status(400).json({ error: 'invalid_input' }); return; }
        updates.nickname = n;
    }
    if (body.status !== undefined) {
        if (body.status !== 'active' && body.status !== 'inactive') { res.status(400).json({ error: 'invalid_input' }); return; }
        updates.status = body.status;
        // a disabled account can't stay the default
        if (body.status === 'inactive' && current.is_default) updates.is_default = false;
    }
    if (Object.keys(updates).length === 0) { res.status(400).json({ error: 'nothing_to_update' }); return; }

    const bankCode = updates.bank_code ?? current.bank_code;
    const number = updates.account_number ?? current.account_number;
    if (updates.bank_code || updates.account_number) {
        const all = await db.collection(col).get();
        if (all.docs.some(d => { const a = d.data() as BankAccount; return a.id !== current.id && a.bank_code === bankCode && a.account_number === number; })) {
            res.status(409).json({ error: 'duplicate_account', message: 'มีบัญชีนี้อยู่แล้ว' });
            return;
        }
    }
    await ref.update({ ...updates, updated_at: now });
    await audit('UPDATE', { ...current, ...updates } as BankAccount, {
        before: { status: current.status, name: current.account_name, number: last4(current.account_number) },
        after: { ...updates, ...(updates.account_number ? { account_number: last4(updates.account_number) } : {}) },
    });
    res.status(200).json({ ok: true });
}
