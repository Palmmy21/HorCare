import type { VercelRequest, VercelResponse } from '@vercel/node';
import { admin, db } from './_firebase.js';

const ADMIN_EMAIL = 'horcare.admin@gmail.com';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method === 'OPTIONS') { res.status(200).end(); return; }
    if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            res.status(401).json({ error: 'unauthenticated' }); return;
        }
        const idToken = authHeader.split('Bearer ')[1];
        const decoded = await admin.auth().verifyIdToken(idToken);

        const callerDoc = await db.collection('users').doc(decoded.uid).get();
        const isAdmin = callerDoc.data()?.role === 'admin' || decoded.email === ADMIN_EMAIL;
        if (!isAdmin) { res.status(403).json({ error: 'forbidden' }); return; }

        // Fetch all Firebase Auth users (paginated up to 1000)
        const authUsers: admin.auth.UserRecord[] = [];
        let pageToken: string | undefined;
        do {
            const result = await admin.auth().listUsers(1000, pageToken);
            authUsers.push(...result.users);
            pageToken = result.pageToken;
        } while (pageToken);

        // Fetch all Firestore profiles in one shot
        const firestoreSnap = await db.collection('users').get();
        const firestoreMap = new Map<string, FirebaseFirestore.DocumentData>();
        firestoreSnap.forEach(doc => firestoreMap.set(doc.id, doc.data()));

        // Merge: Firebase Auth is the source of truth for existence
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

        // Sort newest first
        merged.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());

        res.status(200).json({ users: merged });

    } catch (err: unknown) {
        console.error('admin-list-users error:', err);
        res.status(500).json({ error: (err as Error).message || 'Internal Server Error' });
    }
}
