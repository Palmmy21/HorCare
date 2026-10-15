import type { VercelRequest, VercelResponse } from '@vercel/node';
import { admin, db } from './_firebase.js';
import { ADMIN_EMAIL } from '../src/shared/admin.js';

async function verifyAdmin(req: VercelRequest): Promise<string | null> {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return null;
    try {
        const decoded = await admin.auth().verifyIdToken(authHeader.split('Bearer ')[1]);
        const isAdmin = decoded.email === ADMIN_EMAIL;
        return isAdmin ? decoded.uid : null;
    } catch {
        return null;
    }
}

async function listUsers(res: VercelResponse) {
    const authUsers: admin.auth.UserRecord[] = [];
    let pageToken: string | undefined;
    do {
        const result = await admin.auth().listUsers(1000, pageToken);
        authUsers.push(...result.users);
        pageToken = result.pageToken;
    } while (pageToken);

    const firestoreSnap = await db.collection('users').get();
    const firestoreMap = new Map<string, FirebaseFirestore.DocumentData>();
    firestoreSnap.forEach(doc => firestoreMap.set(doc.id, doc.data()));

    const merged = authUsers.map(au => {
        const fs = firestoreMap.get(au.uid) ?? {};
        return {
            uid: au.uid,
            email: au.email ?? fs.email ?? '',
            display_name: au.displayName ?? fs.display_name ?? '',
            email_verified: au.emailVerified,
            created_at: fs.created_at ?? au.metadata.creationTime ?? '',
            last_sign_in: au.metadata.lastSignInTime ?? null,
            license: fs.license ?? 'free',
            role: fs.role ?? null,
            status: fs.status ?? null,
            subscription_status: fs.subscription_status ?? null,
            current_period_end: fs.current_period_end ?? null,
            access_until: fs.access_until ?? null,
            plan_name: fs.plan_name ?? null,
            billing_cycle: fs.billing_cycle ?? null,
            subscription_id: fs.subscription_id ?? null,
            stripe_customer_id: fs.stripe_customer_id ?? null,
            has_firestore_profile: firestoreMap.has(au.uid),
        };
    });
    merged.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
    res.status(200).json({ users: merged });
}

async function verifyEmail(req: VercelRequest, res: VercelResponse, adminUid: string) {
    const { targetUid } = req.body as { targetUid?: string };
    if (!targetUid) { res.status(400).json({ error: 'targetUid is required' }); return; }
    await admin.auth().updateUser(targetUid, { emailVerified: true });
    console.log(`admin/verify-email: verified uid=${targetUid} by admin=${adminUid}`);
    res.status(200).json({ success: true });
}

async function backfillProfiles(res: VercelResponse) {
    const authUsers: admin.auth.UserRecord[] = [];
    let pageToken: string | undefined;
    do {
        const result = await admin.auth().listUsers(1000, pageToken);
        authUsers.push(...result.users);
        pageToken = result.pageToken;
    } while (pageToken);

    const firestoreSnap = await db.collection('users').get();
    const existingUids = new Set(firestoreSnap.docs.map(d => d.id));
    const missing = authUsers.filter(u => !existingUids.has(u.uid));
    if (missing.length === 0) {
        res.status(200).json({ created: 0, message: 'ทุก user มี profile แล้ว' }); return;
    }
    const batch = db.batch();
    for (const au of missing) {
        batch.set(db.collection('users').doc(au.uid), {
            uid: au.uid,
            email: au.email ?? '',
            display_name: au.displayName ?? au.email?.split('@')[0] ?? '',
            license: 'free',
            access_until: 0,
            created_at: au.metadata.creationTime ?? new Date().toISOString(),
        });
    }
    await batch.commit();
    res.status(200).json({ created: missing.length, emails: missing.map(u => u.email) });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method === 'OPTIONS') { res.status(200).end(); return; }

    const adminUid = await verifyAdmin(req);
    if (!adminUid) { res.status(401).json({ error: 'unauthenticated or forbidden' }); return; }

    const action = req.query.action as string;

    try {
        if (action === 'list-users' && req.method === 'GET') {
            await listUsers(res);
        } else if (action === 'verify-email' && req.method === 'POST') {
            await verifyEmail(req, res, adminUid);
        } else if (action === 'backfill-profiles' && req.method === 'POST') {
            await backfillProfiles(res);
        } else {
            res.status(400).json({ error: 'unknown action' });
        }
    } catch (err: unknown) {
        console.error(`admin/${action} error:`, err);
        // Caller is already verified as admin, so exposing the message is safe and makes this debuggable.
        res.status(500).json({ error: 'Internal Server Error', message: (err as Error)?.message ?? String(err) });
    }
}
