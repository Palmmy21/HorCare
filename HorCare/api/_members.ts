import type { VercelRequest, VercelResponse } from '@vercel/node';
import { admin, db } from './_firebase.js';
import { authorize } from './_rbac.js';
import { writeAudit } from './_audit.js';
import { cleanPhone } from '../src/shared/leasing.js';
import { AccountError, createManagedAccount, indexMember, myMemberships, resetManagedPassword, unindexMember, type ManagedMember } from './_member-accounts.js';
import {
    ASSIGNABLE_ROLES, isRole, permissionsForRole, type MemberDoc, type Role,
} from '../src/shared/permissions.js';

export const config = { maxDuration: 15 };

interface Body {
    action?: 'list' | 'add' | 'update' | 'remove' | 'create_account' | 'reset_password' | 'my_memberships';
    display_name?: string;
    password?: string;
    owner_uid?: string;
    email?: string;
    /** Alternative to email: the phone number the person registered with. */
    phone?: string;
    member_uid?: string;
    role?: string;
    property_ids?: unknown;
    status?: 'active' | 'disabled';
}

function parsePropertyIds(value: unknown): string[] | null {
    if (!Array.isArray(value) || value.length === 0) return null;
    if (!value.every(v => typeof v === 'string' && v.length > 0 && v.length <= 100)) return null;
    return [...new Set(value as string[])];
}

/** The ways a Thai mobile number may be stored on a profile: 0812345678, 081-234-5678, +66812345678, 66812345678. */
function phoneVariants(p: string): string[] {
    const intl = p.slice(1);
    return [p, `${p.slice(0, 3)}-${p.slice(3, 6)}-${p.slice(6)}`, `${p.slice(0, 3)}-${p.slice(3)}`, `+66${intl}`, `66${intl}`];
}

async function uidsByPhone(phone: string): Promise<string[]> {
    const found = new Set<string>();
    for (const v of phoneVariants(phone)) {
        for (const d of (await db.collection('users').where('phone', '==', v).get()).docs) found.add(d.id);
    }
    return [...found];
}

/** Manage staff access to an owner's organization. Owner-only (`member.manage`). */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const body = (req.body ?? {}) as Body;
    const action = body.action;

    // Any signed-in person may ask which organisations they work for (that is how the app knows to open in staff mode).
    if (action === 'my_memberships') {
        const header = req.headers.authorization;
        if (!header?.startsWith('Bearer ')) { res.status(401).json({ error: 'unauthenticated' }); return; }
        let uid: string;
        try { uid = (await admin.auth().verifyIdToken(header.slice('Bearer '.length))).uid; } catch { res.status(401).json({ error: 'unauthenticated' }); return; }
        res.status(200).json({ memberships: await myMemberships(uid) });
        return;
    }

    if (action === 'list') {
        const ctx = await authorize(req, res, { ownerUid: body.owner_uid, permission: 'member.read' });
        if (!ctx) return;
        const all = (await db.collection(`users/${ctx.ownerUid}/members`).get()).docs.map(d => d.data() as ManagedMember);
        // accounts created before the sign-in index existed are indexed the first time the owner opens the list
        if (ctx.isOwner) await Promise.all(all.filter(m => m.status === 'active').map(m => indexMember(m.uid, ctx.ownerUid)));
        // someone who is not the owner (and not granted every property) sees only people who share a building with them
        const mine = all.find(m => m.uid === ctx.uid);
        const wide = ctx.isOwner || !mine || mine.property_ids.includes('*');
        const visible = wide ? all : all.filter(m => m.uid === ctx.uid || m.property_ids.includes('*') === false && m.property_ids.some(p => mine.property_ids.includes(p)));
        res.status(200).json({ members: visible });
        return;
    }

    const ctx = await authorize(req, res, { ownerUid: body.owner_uid, permission: 'member.manage' });
    if (!ctx) return;
    const ownerUid = ctx.ownerUid;

    if (action === 'create_account' || action === 'reset_password') {
        try {
            if (action === 'create_account') {
                const member = await createManagedAccount(ownerUid, ctx.uid, { email: body.email, password: body.password, display_name: body.display_name, role: body.role, property_ids: body.property_ids });
                await writeAudit({
                    ownerUid, userId: ctx.uid, userName: ctx.displayName, role: ctx.role, action: 'PERMISSION_CHANGE', resourceType: 'member', resourceId: member.uid,
                    resourceLabel: member.email, after: { role: member.role, property_ids: member.property_ids }, note: 'create administrator account', req,
                });
                res.status(200).json({ member });
                return;
            }
            if (typeof body.member_uid !== 'string' || !body.member_uid) { res.status(400).json({ error: 'member_uid is required' }); return; }
            await resetManagedPassword(ownerUid, body.member_uid, body.password);
            await writeAudit({
                ownerUid, userId: ctx.uid, userName: ctx.displayName, role: ctx.role, action: 'PERMISSION_CHANGE', resourceType: 'member', resourceId: body.member_uid,
                note: 'administrator password reset', req,
            });
            res.status(200).json({ ok: true });
            return;
        } catch (e) {
            if (e instanceof AccountError) { res.status(e.status).json({ error: e.code }); return; }
            console.error('member account error', e);
            res.status(500).json({ error: 'internal_error' });
            return;
        }
    }

    if (action === 'add') {
        const email = (body.email ?? '').trim().toLowerCase();
        const phone = email ? null : cleanPhone(body.phone);
        const role = body.role;
        const propertyIds = parsePropertyIds(body.property_ids);
        if ((!email && !phone) || !isRole(role) || !ASSIGNABLE_ROLES.includes(role) || !propertyIds) {
            res.status(400).json({ error: 'invalid_input' });
            return;
        }

        let target: admin.auth.UserRecord;
        try {
            if (phone) {
                const uids = await uidsByPhone(phone);
                if (uids.length > 1) { res.status(409).json({ error: 'ambiguous_phone', message: 'มีหลายบัญชีใช้เบอร์นี้ — เพิ่มด้วยอีเมลแทน' }); return; }
                if (uids.length === 0) throw new Error('not_found');
                target = await admin.auth().getUser(uids[0]);
            } else {
                target = await admin.auth().getUserByEmail(email);
            }
        } catch {
            res.status(404).json({ error: 'user_not_found', message: 'ผู้ใช้นี้ยังไม่มีบัญชี HorCare — ให้สมัครสมาชิกก่อน' });
            return;
        }
        if (target.uid === ownerUid) {
            res.status(400).json({ error: 'cannot_add_owner' });
            return;
        }

        // Every referenced property must really belong to this owner.
        if (!propertyIds.includes('*')) {
            const checks = await Promise.all(propertyIds.map(id => db.doc(`users/${ownerUid}/buildings/${id}`).get()));
            if (checks.some(s => !s.exists)) { res.status(400).json({ error: 'unknown_property' }); return; }
        }

        const member: MemberDoc = {
            uid: target.uid,
            email: target.email ?? email,
            display_name: target.displayName ?? target.email ?? email ?? phone ?? '',
            role,
            permissions: permissionsForRole(role),
            property_ids: propertyIds,
            status: 'active',
            created_at: new Date().toISOString(),
            created_by: ctx.uid,
        };
        await db.doc(`users/${ownerUid}/members/${target.uid}`).set(member);
        await indexMember(target.uid, ownerUid);
        await writeAudit({
            ownerUid, userId: ctx.uid, userName: ctx.displayName, role: ctx.role,
            action: 'PERMISSION_CHANGE', resourceType: 'member', resourceId: target.uid,
            resourceLabel: member.email, after: { role, property_ids: propertyIds }, note: 'add member', req,
        });
        res.status(200).json({ member });
        return;
    }

    const memberUid = body.member_uid;
    if (!memberUid || typeof memberUid !== 'string') { res.status(400).json({ error: 'member_uid is required' }); return; }
    const ref = db.doc(`users/${ownerUid}/members/${memberUid}`);
    const existing = await ref.get();
    if (!existing.exists) { res.status(404).json({ error: 'not_found' }); return; }
    const before = existing.data() as MemberDoc;

    if (action === 'update') {
        const updates: Partial<MemberDoc> = {};
        if (body.role !== undefined) {
            if (!isRole(body.role) || !ASSIGNABLE_ROLES.includes(body.role as Role)) { res.status(400).json({ error: 'invalid_role' }); return; }
            updates.role = body.role as Role;
            updates.permissions = permissionsForRole(body.role as Role);
        }
        if (body.property_ids !== undefined) {
            const ids = parsePropertyIds(body.property_ids);
            if (!ids) { res.status(400).json({ error: 'invalid_property_ids' }); return; }
            if (!ids.includes('*')) {
                const checks = await Promise.all(ids.map(id => db.doc(`users/${ownerUid}/buildings/${id}`).get()));
                if (checks.some(s => !s.exists)) { res.status(400).json({ error: 'unknown_property' }); return; }
            }
            updates.property_ids = ids;
        }
        if (body.status !== undefined) {
            if (body.status !== 'active' && body.status !== 'disabled') { res.status(400).json({ error: 'invalid_status' }); return; }
            updates.status = body.status;
        }
        if (Object.keys(updates).length === 0) { res.status(400).json({ error: 'nothing_to_update' }); return; }
        await ref.update(updates);
        // a disabled account is signed out everywhere at once (the rules and the API already refuse it)
        if (updates.status === 'disabled' && (before as ManagedMember).managed === true) await admin.auth().revokeRefreshTokens(memberUid);
        await writeAudit({
            ownerUid, userId: ctx.uid, userName: ctx.displayName, role: ctx.role,
            action: 'PERMISSION_CHANGE', resourceType: 'member', resourceId: memberUid, resourceLabel: before.email,
            before: { role: before.role, property_ids: before.property_ids, status: before.status },
            after: updates, req,
        });
        res.status(200).json({ ok: true });
        return;
    }

    if (action === 'remove') {
        await ref.delete();
        await unindexMember(memberUid, ownerUid);
        // an account made for this organisation has no other use: lock the sign-in too (reversible by the owner re-adding it)
        if ((before as ManagedMember).managed === true) {
            await admin.auth().updateUser(memberUid, { disabled: true });
            await admin.auth().revokeRefreshTokens(memberUid);
        }
        await writeAudit({
            ownerUid, userId: ctx.uid, userName: ctx.displayName, role: ctx.role,
            action: 'PERMISSION_CHANGE', resourceType: 'member', resourceId: memberUid, resourceLabel: before.email,
            before: { role: before.role, property_ids: before.property_ids }, note: 'remove member', req,
        });
        res.status(200).json({ ok: true });
        return;
    }

    res.status(400).json({ error: 'unknown_action' });
}
