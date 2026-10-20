import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db, admin } from './_firebase.js';
import { buildFineFlex, linePush } from './_line.js';
import { loadPayAccount, paymentQrMessages } from './_payment-qr.js';
import { appBaseUrl } from './_notify.js';
import { portalLinkFor } from './_portal-link.js';

import { errorInfo } from '../src/shared/errorInfo.js';
import type { Fine } from '../src/types/index.js';
import { autoPostSafe } from './_ledger-auto.js';

export const config = { maxDuration: 60 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');
    
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            res.status(401).json({ error: 'unauthenticated' });
            return;
        }

        const idToken = authHeader.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const uid = decodedToken.uid;

        const bodyData = req.body?.data || req.body || {};
        const { building_id, fine_id } = bodyData;
        
        if (!building_id || !fine_id) {
            res.status(400).json({ error: 'Missing building_id or fine_id' });
            return;
        }

        const configSnap = await db.doc(`users/${uid}/buildings/${building_id}/data/config`).get();
        const cfg = configSnap.data() ?? {};
        const dormName       = cfg.bill_customization?.dorm_name || 'หอพัก';
        const payAccount = await loadPayAccount(uid, building_id);
        let appUrl = (process.env.APP_URL ?? '').replace(/\/$/, '');
        if (appUrl && !appUrl.startsWith('http')) appUrl = `https://${appUrl}`;

        // Get Fine
        const fineSnap = await db.doc(`users/${uid}/buildings/${building_id}/fines/${fine_id}`).get();
        if (!fineSnap.exists) {
            res.status(404).json({ error: 'Fine not found' });
            return;
        }
        const fine = fineSnap.data();

        // Get Room to find line_user_id
        if (!fine?.room_id) {
            res.status(400).json({ error: 'Fine does not have a room_id' });
            return;
        }

        const roomSnap = await db.doc(`users/${uid}/buildings/${building_id}/rooms/${fine.room_id}`).get();
        if (!roomSnap.exists) {
            res.status(404).json({ error: 'Room not found' });
            return;
        }
        
        const roomData = roomSnap.data();
        const lineUserId = roomData?.line_user_id as string | undefined;

        if (!lineUserId) {
            res.status(400).json({ error: 'Room tenant is not registered with LINE' });
            return;
        }

        const portalUrl = appUrl
            ? `${appUrl}/?p=${encodeURIComponent(await portalLinkFor({ ownerUid: uid, buildingId: building_id, roomId: fine.room_id }))}`
            : undefined;

        const messages: object[] = [buildFineFlex(fine as Fine, dormName, { portalUrl })];
        messages.push(...paymentQrMessages(payAccount, fine.amount, appUrl || appBaseUrl()));

        await linePush(lineUserId, messages);

        // Optional: Update fine doc to mark it as notified
        await fineSnap.ref.update({ is_notified: true });

        await autoPostSafe(uid, building_id);
        res.status(200).json({ success: true, message: 'Line notification sent' });

    } catch (errorRaw) {
        const error = errorInfo(errorRaw);
        console.error('Send fine error:', errorRaw);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
}
