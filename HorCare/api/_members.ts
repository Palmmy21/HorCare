import type { VercelRequest, VercelResponse } from '@vercel/node';
import { admin, db } from './_firebase.js';
import { authorize } from './_rbac.js';
import { writeAudit } from './_audit.js';
import { cleanPhone } from '../src/shared/leasing.js';
import {
    ASSIGNABLE_ROLES, isRole, permissionsForRole, type MemberDoc, type Role,
} from '../src/shared/permissions.js';

export const config = { maxDuration: 15 };

interface Body {
    action?: 'list' | 'add' | 'update' | 'remove';
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

    if (action === 'list') {
        const ctx = await authorize(req, res, { ownerUid: body.owner_uid, permission: 'member.read' });
        if (!ctx) return;
        const snap = await db.collection(`users/${ctx.ownerUid}/members`).get();
        res.status(200).json({ members: snap.docs.map(d => d.data()) });
        return;
    }

    const ctx = await authorize(req, res, { ownerUid: body.owner_uid, permission: 'member.manage' });
    if (!ctx) return;
    const ownerUid = ctx.ownerUid;

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
