/**
 * Owners (and staff who may see finances) read their numbers in LINE: #ยอด, #ค้าง, #ห้องว่าง.
 *
 * Linking uses the STAFF Official Account (the team's channel, not the tenants'): the app issues a one-time code
 * (HCO-XXXXXXXX, 15 minutes), the person sends it to that OA, and owner_line/{lineUserId} remembers who they are.
 * Every command re-checks access: the owner sees all their properties; a staff account needs finance.read and only
 * sees the properties it was given. Codes and bindings are server-only (Firestore rules deny clients).
 *
 * /api/owner-line (signed in): code | status | unlink
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash, randomInt } from 'node:crypto';
import { db } from './_firebase.js';
import { authorize } from './_rbac.js';
import { writeAudit } from './_audit.js';
import { rateLimitBy } from './_abuse-guard.js';
import { thaiMonthLabel } from './_line.js';
import { vacantRooms } from './_listing.js';
import { isRole, permissionsForRole } from '../src/shared/permissions.js';
import { todayTh } from '../src/shared/market.js';
import {
    formatSummary, formatUnpaid, formatVacant, isOwnerLinkCode, monthFigures, OWNER_HELP, parseOwnerCommand, type BillFacts,
} from '../src/shared/ownerCommands.js';

export const config = { maxDuration: 30 };

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_TTL_MS = 15 * 60 * 1000;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const text = (t: string) => ({ type: 'text', text: t.slice(0, 4900) });

interface Binding { account_uid: string; owner_uid: string; linked_at: string }

/** The properties this account may see figures for, by id → name. Empty = no access (anymore). */
async function visibleProperties(b: Binding): Promise<{ id: string; name: string }[]> {
    let allowed: string[] | '*' = '*';
    if (b.account_uid !== b.owner_uid) {
        const m = (await db.doc(`users/${b.owner_uid}/members/${b.account_uid}`).get()).data() as
            { status?: string; role?: string; property_ids?: string[] } | undefined;
        // recomputed from the role, never trusted from the stored copy
        if (!m || m.status !== 'active' || !isRole(m.role) || !permissionsForRole(m.role).includes('finance.read')) return [];
        allowed = (m.property_ids ?? []).includes('*') ? '*' : (m.property_ids ?? []);
    }
    const owner = (await db.doc(`users/${b.owner_uid}`).get()).data();
    if (owner?.status === 'banned') return [];
    const snap = await db.collection(`users/${b.owner_uid}/buildings`).get();
    const out: { id: string; name: string }[] = [];
    for (const d of snap.docs) {
        if (allowed !== '*' && !allowed.includes(d.id)) continue;
        const cfg = (await db.doc(`users/${b.owner_uid}/buildings/${d.id}/data/config`).get()).data();
        out.push({ id: d.id, name: cfg?.bill_customization?.dorm_name || (d.data() as { name?: string }).name || 'อาคาร' });
    }
    return out;
}

/** A LINE user sends their HCO- code to the staff OA. */
export async function redeemOwnerLink(lineUserId: string, rawCode: string): Promise<string> {
    if (!isOwnerLinkCode(rawCode)) return '❌ ไม่พบรหัสนี้ กรุณาสร้างรหัสใหม่ในแอป HorCare';
    // every try counts, right or wrong, so codes cannot be guessed at
    if (!(await rateLimitBy(`line:${lineUserId}`, 'ownerlink-code', 10, 3600)).ok) return '⚠️ ลองรหัสบ่อยเกินไป กรุณารอ 1 ชั่วโมงแล้วลองใหม่';
    const codeRef = db.doc(`owner_line_codes/${sha256(rawCode.trim().toUpperCase())}`);
    const code = (await codeRef.get()).data() as { account_uid: string; owner_uid: string; expires_at: number; used?: boolean } | undefined;
    if (!code) return '❌ ไม่พบรหัสนี้ กรุณาสร้างรหัสใหม่ในแอป HorCare';
    if (code.used) return '⚠️ รหัสนี้ถูกใช้ไปแล้ว กรุณาสร้างรหัสใหม่ในแอป';
    if (code.expires_at <= Date.now()) return '⌛ รหัสหมดอายุแล้ว (ใช้ได้ 15 นาที) กรุณาสร้างรหัสใหม่ในแอป';

    const binding: Binding = { account_uid: code.account_uid, owner_uid: code.owner_uid, linked_at: new Date().toISOString() };
    if ((await visibleProperties(binding)).length === 0) return '⚠️ บัญชีนี้ไม่มีสิทธิ์ดูยอดเงิน กรุณาติดต่อเจ้าของ';
    await codeRef.update({ used: true, used_by_line_user: lineUserId });
    await db.doc(`owner_line/${lineUserId}`).set(binding);
    await writeAudit({
        ownerUid: code.owner_uid, propertyId: null, userId: code.account_uid, role: code.account_uid === code.owner_uid ? 'owner' : 'staff',
        action: 'UPDATE', resourceType: 'line_link', resourceId: lineUserId, resourceLabel: 'owner LINE', note: 'owner commands linked',
    });
    return `✅ เชื่อม LINE กับบัญชี HorCare แล้ว\n\n${OWNER_HELP}`;
}

/** Replies for a '#…' message, or null when the text is not a command (the caller handles it). */
export async function handleOwnerCommand(lineUserId: string, raw: string): Promise<object[] | null> {
    const cmd = parseOwnerCommand(raw);
    if (!cmd) return null;
    const ref = db.doc(`owner_line/${lineUserId}`);
    const binding = (await ref.get()).data() as Binding | undefined;
    if (!binding) return [text('LINE นี้ยังไม่ได้เชื่อมกับบัญชีเจ้าของ\nเปิดแอป HorCare → ตั้งค่า → การเชื่อมต่อ → "ดูยอดผ่าน LINE" แล้วส่งรหัส HCO- มาในแชทนี้')];
    if (cmd === 'help') return [text(OWNER_HELP)];
    if (cmd === 'unlink') {
        await ref.delete();
        return [text('เลิกเชื่อม LINE นี้กับบัญชี HorCare แล้ว')];
    }

    const props = await visibleProperties(binding);
    if (props.length === 0) {
        await ref.delete(); // access was taken away: forget the binding too
        return [text('บัญชีนี้ไม่มีสิทธิ์ดูยอดเงินแล้ว จึงเลิกเชื่อม LINE ให้อัตโนมัติ')];
    }

    const today = todayTh();
    const month = today.slice(0, 7);
    const parts: string[] = [];
    for (const p of props.slice(0, 10)) {
        const base = `users/${binding.owner_uid}/buildings/${p.id}`;
        if (cmd === 'vacant') {
            parts.push(formatVacant(p.name, await vacantRooms(binding.owner_uid, p.id, false)));
            continue;
        }
        const bills = (await db.collection(`${base}/bills`).where('month', '==', month).get()).docs.map(d => d.data() as BillFacts);
        parts.push(cmd === 'summary' ? formatSummary(p.name, thaiMonthLabel(month), monthFigures(bills, today)) : formatUnpaid(p.name, bills));
    }
    // one bubble per property keeps each under LINE's length limit; LINE takes at most 5 messages per reply
    return parts.slice(0, 5).map(text);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return; }
    const body = (req.body ?? {}) as { action?: string; owner_uid?: unknown };
    const ctx = await authorize(req, res, { ownerUid: body.owner_uid, permission: 'finance.read' });
    if (!ctx) return;
    const mine = db.collection('owner_line').where('account_uid', '==', ctx.uid);

    if (body.action === 'code') {
        let code = 'HCO-';
        for (let i = 0; i < 8; i++) code += ALPHABET[randomInt(ALPHABET.length)];
        const expires = Date.now() + CODE_TTL_MS;
        await db.doc(`owner_line_codes/${sha256(code)}`).set({ account_uid: ctx.uid, owner_uid: ctx.ownerUid, expires_at: expires, created_at: new Date().toISOString() });
        res.status(200).json({ code, expires_at: expires });
        return;
    }
    if (body.action === 'status') {
        const snap = await mine.get();
        res.status(200).json({ linked: snap.docs.some(d => (d.data() as Binding).owner_uid === ctx.ownerUid) });
        return;
    }
    if (body.action === 'unlink') {
        const snap = await mine.get();
        await Promise.all(snap.docs.filter(d => (d.data() as Binding).owner_uid === ctx.ownerUid).map(d => d.ref.delete()));
        res.status(200).json({ ok: true });
        return;
    }
    res.status(400).json({ error: 'unknown_action' });
}
