import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db, admin } from './_firebase.js';

export const config = { maxDuration: 15 };

interface NotifyPayload {
    building_id: string;
    title: string;
    body: string;
    url?: string;
    icon?: string;
}

// Retrieve all FCM tokens stored for this owner and send a multicast push.
// Stale / unregistered tokens are silently pruned after the send.
async function sendFCMToOwner(uid: string, payload: NotifyPayload): Promise<{ sent: number; pruned: number }> {
    const fcmDoc = await db.doc(`users/${uid}/data/fcm`).get();
    if (!fcmDoc.exists) return { sent: 0, pruned: 0 };

    const tokensMap: Record<string, { token: string }> = fcmDoc.data()?.tokens ?? {};
    const tokenEntries = Object.entries(tokensMap);
    if (tokenEntries.length === 0) return { sent: 0, pruned: 0 };

    const tokens = tokenEntries.map(([, v]) => v.token).filter(Boolean);
    if (tokens.length === 0) return { sent: 0, pruned: 0 };

    const message: admin.messaging.MulticastMessage = {
        tokens,
        notification: {
            title: payload.title,
            body: payload.body,
            imageUrl: payload.icon || undefined,
        },
        webpush: {
            notification: {
                icon: '/logo-icon.png',
                badge: '/logo-icon.png',
                lang: 'th',
                requireInteraction: false,
                data: { url: payload.url || '/' },
            },
            fcmOptions: { link: payload.url || '/' },
        },
        android: {
            notification: {
                icon: 'ic_notification',
                clickAction: 'FLUTTER_NOTIFICATION_CLICK',
                sound: 'default',
            },
        },
    };

    const response = await admin.messaging().sendEachForMulticast(message);

    // Prune tokens that are no longer valid
    const staleKeys: string[] = [];
    response.responses.forEach((r, i) => {
        if (!r.success) {
            const code = r.error?.code;
            if (
                code === 'messaging/registration-token-not-registered' ||
                code === 'messaging/invalid-registration-token'
            ) {
                const key = tokenEntries[i][0];
                staleKeys.push(key);
            }
        }
    });

    if (staleKeys.length > 0) {
        const updates: Record<string, admin.firestore.FieldValue> = {};
        staleKeys.forEach(k => { updates[`tokens.${k}`] = admin.firestore.FieldValue.delete(); });
        await fcmDoc.ref.update(updates);
    }

    return { sent: response.successCount, pruned: staleKeys.length };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method === 'OPTIONS') { res.status(200).end(); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            res.status(401).json({ error: 'unauthenticated' });
            return;
        }

        const idToken = authHeader.split('Bearer ')[1];
        const decoded = await admin.auth().verifyIdToken(idToken);
        const uid = decoded.uid;

        const body: NotifyPayload = req.body?.data || req.body || {};
        if (!body.building_id || !body.title) {
            res.status(400).json({ error: 'Missing building_id or title' });
            return;
        }

        const result = await sendFCMToOwner(uid, body);
        console.log(`notify-owner uid=${uid} building=${body.building_id} sent=${result.sent} pruned=${result.pruned}`);
        res.status(200).json({ data: result });
    } catch (err: any) {
        console.error('notify-owner error:', err);
        res.status(500).json({ error: err.message || 'Internal Server Error' });
    }
}
