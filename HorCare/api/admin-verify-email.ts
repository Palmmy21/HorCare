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
        const idToken = authHeader.split('Bearer ')[1];
        const decoded = await admin.auth().verifyIdToken(idToken);

        // Verify caller is admin
        const callerDoc = await db.collection('users').doc(decoded.uid).get();
        const callerRole = callerDoc.data()?.role;
        const isAdmin = callerRole === 'admin' || decoded.email === ADMIN_EMAIL;
        if (!isAdmin) {
            res.status(403).json({ error: 'forbidden' }); return;
        }

        const { targetUid } = req.body as { targetUid?: string };
        if (!targetUid) {
            res.status(400).json({ error: 'targetUid is required' }); return;
        }

        await admin.auth().updateUser(targetUid, { emailVerified: true });

        console.log(`admin-verify-email: verified uid=${targetUid} by admin=${decoded.uid}`);
        res.status(200).json({ success: true });

    } catch (err: unknown) {
        console.error('admin-verify-email error:', err);
        res.status(500).json({ error: (err as Error).message || 'Internal Server Error' });
    }
}
