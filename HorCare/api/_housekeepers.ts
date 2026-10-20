/**
 * /api/housekeepers — housekeeper (แม่บ้าน) accounts and their sign-in.
 *
 * Passcodes never reach a browser: they are stored as scrypt hashes in `housekeepers_auth/{phone}`, which no client may
 * read, and checked here. A successful sign-in returns a Firebase custom token whose claims bind the session to one
 * building and one housekeeper record:
 *     hk_owner, hk_building, hk_maid, hk_ver
 * Firestore rules accept those claims only while the housekeeper record is active AND its `session_version` still equals
 * hk_ver — so changing the passcode, switching the account off or deleting it cuts every open session at once.
 *
 * Public:
 *   login    { phone, passcode }            → { token, session }   (rate-limited per phone and per visitor)
 * Staff (property.update on the building):
 *   upsert   { building_id, maid_id?, name, phone, passcode?, notes?, is_active }
 *   delete   { building_id, maid_id }
 *   migrate  { building_id }  – strips passcodes stored in plain text by older versions; those accounts must be given a new one
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { admin, db } from './_firebase.js';
import { authorize, buildingExists } from './_rbac.js';
import { writeAudit } from './_audit.js';
import { rateLimit, rateLimitBy } from './_abuse-guard.js';

export const config = { maxDuration: 15 };

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

const PASSCODE_RE = /^\d{6,8}$/;
const PHONE_RE = /^0\d{8,9}$/;

export async function hashPasscode(passcode: string): Promise<string> {
    const salt = randomBytes(16);
    const hash = await scrypt(passcode, salt, 32);
    return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function checkPasscode(passcode: string, stored: unknown): Promise<boolean> {
    if (typeof stored !== 'string') return false;
    const [scheme, saltB64, hashB64] = stored.split('$');
    if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
    const expected = Buffer.from(hashB64, 'base64');
    const actual = await scrypt(passcode, Buffer.from(saltB64, 'base64'), expected.length);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** The Firebase user id a housekeeper signs in as (stable per owner + building + record). */
export function housekeeperUid(ownerUid: string, buildingId: string, maidId: string): string {
    return `hk_${createHash('sha256').update(`${ownerUid}/${buildingId}/${maidId}`).digest('hex').slice(0, 40)}`;
}

const digits = (v: unknown) => (typeof v === 'string' ? v.replace(/\D/g, '') : '');
const maidPath = (owner: string, bld: string, id: string) => `users/${owner}/buildings/${bld}/housekeepers/${id}`;

interface AuthDoc {
    owner_uid: string;
    building_id: string;
    building_name?: string;
    maid_id: string;
    name?: string;
    phone: string;
    passcode_hash?: string;
    passcode?: string;
    status?: string;
}

interface Body {
    action?: string;
    phone?: unknown;
    passcode?: unknown;
    owner_uid?: string;
    building_id?: string;
    building_name?: unknown;
    maid_id?: unknown;
    name?: unknown;
    notes?: unknown;
    is_active?: unknown;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const body = (req.body ?? {}) as Body;
    if (body.action === 'login') return login(req, res, body);
    if (body.action === 'upsert' || body.action === 'delete' || body.action === 'migrate') return manage(req, res, body);
    res.status(400).json({ error: 'unknown_action' });
}

async function login(req: VercelRequest, res: VercelResponse, body: Body) {
    const phone = digits(body.phone);
    const passcode = typeof body.passcode === 'string' ? body.passcode.trim() : '';
    if (!phone || !passcode || passcode.length > 32) { res.status(400).json({ error: 'invalid_input' }); return; }

    // A 6-digit code has a million values: a handful of tries per phone per 15 minutes makes guessing it impractical.
    const perPhone = await rateLimitBy(`phone:${phone}`, 'hk_login', 5, 900);
    const perVisitor = await rateLimit(req, 'hk_login', 20, 900);
    if (!perPhone.ok || !perVisitor.ok) {
        res.status(429).json({ error: 'too_many_attempts', retry_after_sec: Math.max(perPhone.retryAfterSec, perVisitor.retryAfterSec) });
        return;
    }

    const authSnap = await db.doc(`housekeepers_auth/${phone}`).get();
    const auth = authSnap.exists ? (authSnap.data() as AuthDoc) : null;
    // same answer for "no such phone" and "wrong passcode", so the endpoint does not reveal who is registered
    if (!auth) { res.status(401).json({ error: 'invalid_credentials' }); return; }
    if (!auth.passcode_hash) { res.status(401).json({ error: 'passcode_reset_required' }); return; }
    if (!(await checkPasscode(passcode, auth.passcode_hash))) { res.status(401).json({ error: 'invalid_credentials' }); return; }

    const maidSnap = await db.doc(maidPath(auth.owner_uid, auth.building_id, auth.maid_id)).get();
    const maid = maidSnap.exists ? (maidSnap.data() as { name?: string; is_active?: boolean; session_version?: number }) : null;
    if (!maid || maid.is_active === false) { res.status(403).json({ error: 'account_disabled' }); return; }

    const uid = housekeeperUid(auth.owner_uid, auth.building_id, auth.maid_id);
    const token = await admin.auth().createCustomToken(uid, {
        hk_owner: auth.owner_uid, hk_building: auth.building_id, hk_maid: auth.maid_id, hk_ver: maid.session_version ?? 0,
    });
    res.status(200).json({
        token,
        session: {
            owner_uid: auth.owner_uid, building_id: auth.building_id, building_name: auth.building_name || 'หอพัก',
            maid_id: auth.maid_id, name: maid.name ?? auth.name ?? '', maid_name: maid.name ?? auth.name ?? '', phone,
        },
    });
}

async function manage(req: VercelRequest, res: VercelResponse, body: Body) {
    const buildingId = body.building_id;
    if (typeof buildingId !== 'string' || !buildingId) { res.status(400).json({ error: 'building_id is required' }); return; }
    const ctx = await authorize(req, res, { ownerUid: body.owner_uid, buildingId, permission: 'property.update' });
    if (!ctx) return;
    if (!(await buildingExists(ctx.ownerUid, buildingId))) { res.status(404).json({ error: 'property_not_found' }); return; }
    const owner = ctx.ownerUid;
    const nowIso = new Date().toISOString();
    const audit = (action: 'CREATE' | 'UPDATE' | 'DELETE', id: string, label: string, note?: string) => writeAudit({
        ownerUid: owner, propertyId: buildingId, userId: ctx.uid, userName: ctx.displayName, role: ctx.role,
        action, resourceType: 'housekeeper', resourceId: id, resourceLabel: label, note, req,
    });
    const signOut = (maidId: string) => admin.auth().revokeRefreshTokens(housekeeperUid(owner, buildingId, maidId)).catch(() => undefined);
    // the phone's sign-in record, when it belongs to this very housekeeper (never touch another building's)
    const ownAuth = async (phone: string, maidId: string) => {
        if (!phone) return null;
        const ref = db.doc(`housekeepers_auth/${phone}`);
        const snap = await ref.get();
        const d = snap.exists ? (snap.data() as AuthDoc) : null;
        return d && d.owner_uid === owner && d.building_id === buildingId && d.maid_id === maidId ? ref : null;
    };

    if (body.action === 'migrate') {
        const snap = await db.collection(`users/${owner}/buildings/${buildingId}/housekeepers`).get();
        let stripped = 0;
        for (const d of snap.docs) {
            const m = d.data() as { passcode?: string; phone?: string };
            if (m.passcode === undefined) continue;
            await d.ref.update({ passcode: admin.firestore.FieldValue.delete(), session_version: ((d.data() as { session_version?: number }).session_version ?? 0) + 1, needs_passcode: true });
            const authRef = await ownAuth(digits(m.phone), d.id);
            if (authRef) await authRef.update({ passcode: admin.firestore.FieldValue.delete() });
            stripped++;
        }
        res.status(200).json({ ok: true, stripped });
        return;
    }

    const maidId = typeof body.maid_id === 'string' && body.maid_id ? body.maid_id : null;

    if (body.action === 'delete') {
        if (!maidId) { res.status(400).json({ error: 'invalid_input' }); return; }
        const ref = db.doc(maidPath(owner, buildingId, maidId));
        const snap = await ref.get();
        if (!snap.exists) { res.status(404).json({ error: 'not_found' }); return; }
        const m = snap.data() as { name?: string; phone?: string };
        const authRef = await ownAuth(digits(m.phone), maidId);
        if (authRef) await authRef.delete();
        await ref.delete();
        await signOut(maidId);
        await audit('DELETE', maidId, m.name ?? maidId);
        res.status(200).json({ ok: true });
        return;
    }

    // upsert
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const phone = digits(body.phone);
    const passcode = typeof body.passcode === 'string' ? body.passcode.trim() : '';
    const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 500) : '';
    const isActive = body.is_active !== false;
    if (!name || name.length > 80 || !PHONE_RE.test(phone)) { res.status(400).json({ error: 'invalid_input' }); return; }
    if (passcode && !PASSCODE_RE.test(passcode)) { res.status(400).json({ error: 'weak_passcode' }); return; }

    const id = maidId ?? `maid_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const ref = db.doc(maidPath(owner, buildingId, id));
    const snap = await ref.get();
    if (maidId && !snap.exists) { res.status(404).json({ error: 'not_found' }); return; }
    const prev = snap.exists ? (snap.data() as { phone?: string; is_active?: boolean; session_version?: number; created_at?: string; passcode?: string; needs_passcode?: boolean }) : null;
    const prevPhone = digits(prev?.phone);
    // a new account, or one whose passcode was stripped, cannot exist without a passcode
    if (!passcode && (!prev || prev.needs_passcode || prev.passcode !== undefined || prevPhone !== phone)) {
        res.status(400).json({ error: 'passcode_required' });
        return;
    }

    // the phone is the sign-in name: it may not belong to anyone else, in this building or any other
    const phoneRef = db.doc(`housekeepers_auth/${phone}`);
    const phoneSnap = await phoneRef.get();
    if (phoneSnap.exists) {
        const holder = phoneSnap.data() as AuthDoc;
        if (holder.owner_uid !== owner || holder.building_id !== buildingId || holder.maid_id !== id) {
            res.status(409).json({ error: 'phone_in_use' });
            return;
        }
    }

    // anything that changes who may sign in ends the sessions already open
    const endSessions = !!prev && (!!passcode || (!isActive && prev.is_active !== false) || prevPhone !== phone);
    const sessionVersion = (prev?.session_version ?? 0) + (endSessions ? 1 : 0);
    const buildingName = typeof body.building_name === 'string' ? body.building_name.trim().slice(0, 120) : '';

    await ref.set({
        id, name, phone, notes, is_active: isActive, status: isActive ? 'active' : 'off',
        session_version: sessionVersion, needs_passcode: false,
        created_at: prev?.created_at ?? nowIso, updated_at: nowIso,
        ...(prev?.passcode !== undefined ? { passcode: admin.firestore.FieldValue.delete() } : {}),
    }, { merge: true });

    if (prevPhone && prevPhone !== phone) {
        const old = await ownAuth(prevPhone, id);
        if (old) await old.delete();
    }
    const authDoc: Record<string, unknown> = {
        owner_uid: owner, building_id: buildingId, maid_id: id, name, phone, status: isActive ? 'active' : 'off', updated_at: nowIso,
        ...(buildingName ? { building_name: buildingName } : {}),
    };
    if (passcode) authDoc.passcode_hash = await hashPasscode(passcode);
    if (phoneSnap.exists) authDoc.passcode = admin.firestore.FieldValue.delete();
    await phoneRef.set(authDoc, { merge: true });

    if (endSessions) await signOut(id);
    await audit(prev ? 'UPDATE' : 'CREATE', id, name, passcode && prev ? 'passcode changed' : undefined);
    res.status(200).json({ ok: true, id });
}
