import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db, admin } from './_firebase.js';
import { authorize } from './_rbac.js';
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

/** Push a notification to the owner's registered devices. Never throws; returns how many devices accepted it. */
export async function pushToOwner(uid: string, msg: { title: string; body?: string; url?: string; data?: Record<string, string> }): Promise<number> {
    try {
        const fcmDoc = await db.doc(`users/${uid}/data/fcm`).get();
        if (!fcmDoc.exists) return 0;
        const tokensMap: Record<string, { token: string }> = fcmDoc.data()?.tokens ?? {};
        const tokens = Object.values(tokensMap).map(v => v?.token).filter(Boolean);
        if (tokens.length === 0) return 0;

        const message: admin.messaging.MulticastMessage = {
            tokens,
            notification: { title: msg.title, body: msg.body || '' },
            data: msg.data || {},
            webpush: {
                notification: {
                    icon: '/logo-icon.png',
                    badge: '/logo-icon.png',
                    lang: 'th',
                    vibrate: [200, 100, 200],
                    requireInteraction: false,
                    data: { url: msg.url || '/' },
                },
                fcmOptions: { link: msg.url || '/' },
            },
        };
        const response = await admin.messaging().sendEachForMulticast(message);
        return response.successCount;
    } catch (errRaw) {
        console.warn('notify-push error:', errorInfo(errRaw)?.message || errRaw);
        return 0;
    }
}

/**
 * Signed-in owner or staff only: anyone else could otherwise push arbitrary text to an owner's phone.
 * (The tenant portal no longer calls this — /api/portal notifies the owner itself.)
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method === 'OPTIONS') { res.status(200).end(); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

    const payload: PushPayload = req.body?.data || req.body || {};
    const { uid, title, body, url, data } = payload;
    if (!uid || !title) {
        res.status(400).json({ error: 'Missing uid or title' });
        return;
    }
    const ctx = await authorize(req, res, { ownerUid: uid, buildingId: payload.buildingId, permission: 'room.read' });
    if (!ctx) return;

    const sent = await pushToOwner(ctx.ownerUid, { title, body, url, data });
    res.status(200).json({ success: true, sent });
}
