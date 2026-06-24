import type { VercelRequest, VercelResponse } from '@vercel/node';
import { admin, db } from './_firebase.js';

const ADMIN_EMAIL = 'horcare.admin@gmail.com';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method === 'OPTIONS') { res.status(200).end(); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            res.status(401).json({ error: 'unauthenticated' }); return;
        }
        const decoded = await admin.auth().verifyIdToken(authHeader.split('Bearer ')[1]);
        const callerDoc = await db.collection('users').doc(decoded.uid).get();
        const isAdmin = callerDoc.data()?.role === 'admin' || decoded.email === ADMIN_EMAIL;
        if (!isAdmin) { res.status(403).json({ error: 'forbidden' }); return; }

        // List all Firebase Auth users
        const authUsers: admin.auth.UserRecord[] = [];
        let pageToken: string | undefined;
        do {
            const result = await admin.auth().listUsers(1000, pageToken);
            authUsers.push(...result.users);
            pageToken = result.pageToken;
        } while (pageToken);

        // Find which UIDs already have Firestore profiles
        const firestoreSnap = await db.collection('users').get();
        const existingUids = new Set(firestoreSnap.docs.map(d => d.id));

        // Batch-create missing profiles
        const missing = authUsers.filter(u => !existingUids.has(u.uid));
        if (missing.length === 0) {
            res.status(200).json({ created: 0, message: 'ทุก user มี profile แล้ว' });
            return;
        }

        const batch = db.batch();
        for (const au of missing) {
            const ref = db.collection('users').doc(au.uid);
            batch.set(ref, {
                uid: au.uid,
                email: au.email ?? '',
                display_name: au.displayName ?? au.email?.split('@')[0] ?? '',
                license: 'free',
                access_until: 0,
                created_at: au.metadata.creationTime ?? new Date().toISOString(),
            });
        }
        await batch.commit();

        console.log(`admin-backfill-profiles: created ${missing.length} profiles by admin=${decoded.uid}`);
        res.status(200).json({ created: missing.length, emails: missing.map(u => u.email) });

    } catch (err: unknown) {
        console.error('admin-backfill-profiles error:', err);
        res.status(500).json({ error: (err as Error).message || 'Internal Server Error' });
    }
}
