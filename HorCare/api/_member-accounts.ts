/**
 * Building administrators who sign in with an email and password the owner gives them.
 *
 * The owner creates the account here (Firebase Admin SDK), picks the role and the buildings it may touch, and hands
 * over the password. The member document written under users/{owner}/members/{uid} is what every API and every
 * Firestore rule checks, so an administrator of building A has no way to read or change building B.
 *
 * `managed: true` marks accounts created this way: only those can have their password reset by the owner (an owner can
 * never reset the password of someone who simply has a HorCare account of their own), and only those are forced into
 * "staff mode" in the app.
 */
import { admin, db } from './_firebase.js';
import { effectiveLicense } from '../src/shared/trial.js';
import { ASSIGNABLE_ROLES, isRole, permissionsForRole, type MemberDoc, type Role } from '../src/shared/permissions.js';

export class AccountError extends Error {
    constructor(public status: number, public code: string, public detail?: string) { super(code); }
}

export type ManagedMember = MemberDoc & { managed?: boolean };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const validEmail = (e: unknown): e is string => typeof e === 'string' && e.length <= 254 && EMAIL_RE.test(e);

/** 8–64 characters with at least one letter and one digit. Returns the problem, or null when acceptable. */
export function passwordProblem(pw: unknown): 'too_short' | 'too_long' | 'too_simple' | 'invalid' | null {
    if (typeof pw !== 'string') return 'invalid';
    if (pw.length < 8) return 'too_short';
    if (pw.length > 64) return 'too_long';
    if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'too_simple';
    return null;
}

/** Properties the account may use: explicit building ids that exist, or '*' (every property, including future ones). */
async function cleanProperties(owner: string, value: unknown): Promise<string[]> {
    if (!Array.isArray(value) || value.length === 0 || value.length > 100 || !value.every(v => typeof v === 'string' && v.length > 0 && v.length <= 100)) {
        throw new AccountError(400, 'invalid_property_ids');
    }
    const ids = [...new Set(value as string[])];
    if (!ids.includes('*')) {
        const checks = await Promise.all(ids.map(id => db.doc(`users/${owner}/buildings/${id}`).get()));
        if (checks.some(s => !s.exists)) throw new AccountError(400, 'unknown_property');
    }
    return ids;
}

// ── who belongs to which organisation (a single-document lookup, so signing in needs no collection-group query) ──
export async function indexMember(memberUid: string, owner: string): Promise<void> {
    const ref = db.doc(`member_index/${memberUid}`);
    const snap = await ref.get();
    const orgs = new Set<string>((snap.data() as { orgs?: string[] } | undefined)?.orgs ?? []);
    orgs.add(owner);
    await ref.set({ orgs: [...orgs] });
}

export async function unindexMember(memberUid: string, owner: string): Promise<void> {
    const ref = db.doc(`member_index/${memberUid}`);
    const snap = await ref.get();
    const orgs = ((snap.data() as { orgs?: string[] } | undefined)?.orgs ?? []).filter(o => o !== owner);
    await ref.set({ orgs });
}

export interface Membership {
    owner_uid: string;
    owner_name: string;
    role: Role;
    permissions: MemberDoc['permissions'];
    property_ids: string[];
    managed: boolean;
    /** The owner's plan, which governs what the whole organisation may use. Members cannot read the owner's profile. */
    license: string;
    access_until: number;
}

/** The organisations a signed-in user is an active member of. Disabled members are not listed. */
export async function myMemberships(uid: string): Promise<Membership[]> {
    const idx = await db.doc(`member_index/${uid}`).get();
    const orgs = (idx.data() as { orgs?: string[] } | undefined)?.orgs ?? [];
    const out: Membership[] = [];
    for (const owner of orgs.slice(0, 20)) {
        const m = (await db.doc(`users/${owner}/members/${uid}`).get()).data() as ManagedMember | undefined;
        if (!m || m.status !== 'active' || !isRole(m.role)) continue;
        const profile = (await db.doc(`users/${owner}`).get()).data() as { display_name?: string; license?: string; access_until?: number; trial_until?: number } | undefined;
        out.push({
            owner_uid: owner, owner_name: profile?.display_name ?? '', role: m.role,
            // recomputed from the role, never trusted from the stored copy
            permissions: permissionsForRole(m.role), property_ids: m.property_ids, managed: m.managed === true,
            license: effectiveLicense(profile), access_until: profile?.access_until ?? 0,
        });
    }
    return out;
}

export interface CreateAccountInput { email: unknown; password: unknown; display_name: unknown; role: unknown; property_ids: unknown }

/** Create the sign-in account and its member record. Throws AccountError for anything the owner can fix. */
export async function createManagedAccount(owner: string, createdBy: string, input: CreateAccountInput): Promise<ManagedMember> {
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
    if (!validEmail(email)) throw new AccountError(400, 'invalid_email');
    const problem = passwordProblem(input.password);
    if (problem) throw new AccountError(400, `password_${problem}`);
    const name = typeof input.display_name === 'string' ? input.display_name.replace(/\s+/g, ' ').trim() : '';
    if (name.length < 2 || name.length > 80) throw new AccountError(400, 'invalid_name');
    if (!isRole(input.role) || !ASSIGNABLE_ROLES.includes(input.role as Role)) throw new AccountError(400, 'invalid_role');
    const role = input.role as Role;
    const propertyIds = await cleanProperties(owner, input.property_ids);

    let existing: admin.auth.UserRecord | null = null;
    try { existing = await admin.auth().getUserByEmail(email); } catch { /* no such account: good */ }
    if (existing) throw new AccountError(409, 'user_exists');

    // the owner vouches for this person, so the email-verification gate does not apply to them
    const created = await admin.auth().createUser({ email, password: input.password as string, displayName: name, emailVerified: true });
    const now = new Date().toISOString();
    const member: ManagedMember = {
        uid: created.uid, email, display_name: name, role, permissions: permissionsForRole(role), property_ids: propertyIds,
        status: 'active', created_at: now, created_by: createdBy, managed: true,
    };
    await db.doc(`users/${created.uid}`).set({ uid: created.uid, email, display_name: name, license: 'free', access_until: 0, created_at: now, staff_account_of: owner });
    await db.doc(`users/${owner}/members/${created.uid}`).set(member);
    await indexMember(created.uid, owner);
    return member;
}

/** Owner sets a new password for an account that was created here. */
export async function resetManagedPassword(owner: string, memberUid: string, password: unknown): Promise<void> {
    const problem = passwordProblem(password);
    if (problem) throw new AccountError(400, `password_${problem}`);
    const m = (await db.doc(`users/${owner}/members/${memberUid}`).get()).data() as ManagedMember | undefined;
    if (!m) throw new AccountError(404, 'not_found');
    if (m.managed !== true) throw new AccountError(409, 'not_a_managed_account');
    await admin.auth().updateUser(memberUid, { password: password as string });
    await admin.auth().revokeRefreshTokens(memberUid); // anyone signed in with the old password is signed out
}
