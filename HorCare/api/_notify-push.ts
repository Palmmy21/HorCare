import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db, admin } from './_firebase.js';
import { errorInfo } from '../src/shared/errorInfo.js';

export const config = { maxDuration: 15 };

interface PushPayload {
    uid: string;
    buildingId?: string;
    title: string;
    body: string;
    url?: string;
    data?: Record<string, string>;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method === 'OPTIONS') { res.status(200).end(); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

    try {
        const payload: PushPayload = req.body?.data || req.body || {};
        const { uid, title, body, url, data } = payload;

        if (!uid || !title) {
            res.status(400).json({ error: 'Missing uid or title' });
            return;
        }

        // Fetch owner FCM tokens from Firestore
        const fcmDoc = await db.doc(`users/${uid}/data/fcm`).get();
        if (!fcmDoc.exists) {
            res.status(200).json({ sent: 0, reason: 'no-fcm-registered' });
            return;
        }

        const tokensMap: Record<string, { token: string }> = fcmDoc.data()?.tokens ?? {};
        const tokens = Object.values(tokensMap).map(v => v?.token).filter(Boolean);
        if (tokens.length === 0) {
            res.status(200).json({ sent: 0, reason: 'no-tokens' });
            return;
        }

        const message: admin.messaging.MulticastMessage = {
            tokens,
            notification: {
                title,
                body: body || '',
            },
            data: data || {},
            webpush: {
                notification: {
                    icon: '/logo-icon.png',
                    badge: '/logo-icon.png',
                    lang: 'th',
                    vibrate: [200, 100, 200],
                    requireInteraction: false,
                    data: { url: url || '/' },
                },
                fcmOptions: { link: url || '/' },
            },
        };

        const response = await admin.messaging().sendEachForMulticast(message);
        res.status(200).json({ success: true, sent: response.successCount });
    } catch (errRaw) {
        const err = errorInfo(errRaw);
        console.warn('notify-push error:', err?.message || errRaw);
        // Do not fail client workflow if push notification fails
        res.status(200).json({ success: false, error: err?.message });
    }
}
