import type { VercelRequest, VercelResponse } from '@vercel/node';
import { admin, db } from './_firebase.js';
import {
    isRole, permissionsForRole,
    type MemberDoc, type Permission, type Role,
} from '../src/shared/permissions.js';

export interface AuthContext {
    uid: string;
    email: string;
    displayName: string;
    ownerUid: string;     // organization_id — the owner whose data is being accessed
    role: Role;
    permissions: Permission[];
    isOwner: boolean;
}

/**
 * Server-side permission gate. Every mutating/reading API route that touches
 * organization data must call this — hiding UI buttons is not a security control.
 *
 * Resolves the caller from the Firebase ID token, then:
 *   • the owner of `ownerUid` → all permissions on every property
 *   • an active member of `ownerUid` → role permissions, limited to their property_ids
 * Anyone else (including users from other organizations) gets 403.
 *
 * On failure it has already written the response and returns null.
 */
export async function authorize(
    req: VercelRequest,
    res: VercelResponse,
    opts: { ownerUid: unknown; buildingId?: unknown; permission: Permission },
): Promise<AuthContext | null> {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
        res.status(401).json({ error: 'unauthenticated' });
        return null;
    }

    let decoded: admin.auth.DecodedIdToken;
    try {
        decoded = await admin.auth().verifyIdToken(header.slice('Bearer '.length));
    } catch {
        res.status(401).json({ error: 'unauthenticated' });
        return null;
    }

    const ownerUid = typeof opts.ownerUid === 'string' ? opts.ownerUid : '';
    if (!ownerUid) {
        res.status(400).json({ error: 'owner_uid is required' });
        return null;
    }
    const buildingId = typeof opts.buildingId === 'string' ? opts.buildingId : '';

    // Banned accounts lose access everywhere.
    const callerProfile = await db.doc(`users/${decoded.uid}`).get();
    if (callerProfile.exists && callerProfile.data()?.status === 'banned') {
        res.status(403).json({ error: 'forbidden' });
        return null;
    }

    const base = {
        uid: decoded.uid,
        email: decoded.email ?? '',
        displayName: (decoded.name as string | undefined) ?? decoded.email ?? '',
        ownerUid,
    };

    if (decoded.uid === ownerUid) {
        const permissions = permissionsForRole('owner');
        if (!permissions.includes(opts.permission)) { res.status(403).json({ error: 'forbidden' }); return null; }
        return { ...base, role: 'owner', permissions, isOwner: true };
    }

    const memberSnap = await db.doc(`users/${ownerUid}/members/${decoded.uid}`).get();
    if (!memberSnap.exists) {
        res.status(403).json({ error: 'forbidden' });
        return null;
    }
    const member = memberSnap.data() as MemberDoc;
    if (member.status !== 'active' || !isRole(member.role)) {
        res.status(403).json({ error: 'forbidden' });
        return null;
    }
    // Recompute from the role rather than trusting the denormalised copy.
    const permissions = permissionsForRole(member.role);
    if (!permissions.includes(opts.permission)) {
        res.status(403).json({ error: 'forbidden' });
        return null;
    }
    // Multi-property isolation: a member may only touch properties they were granted.
    if (buildingId && !member.property_ids.includes('*') && !member.property_ids.includes(buildingId)) {
        res.status(403).json({ error: 'forbidden' });
        return null;
    }
    return { ...base, role: member.role, permissions, isOwner: false };
}

/** True if `buildingId` really belongs to `ownerUid`. Guards against forged ids. */
export async function buildingExists(ownerUid: string, buildingId: string): Promise<boolean> {
    const snap = await db.doc(`users/${ownerUid}/buildings/${buildingId}`).get();
    return snap.exists;
}
