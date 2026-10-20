import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db, admin } from './_firebase.js';
import { evaluateSlip } from './_slip-flow.js';
import { decodeSlipQR, slipFingerprint } from './_slip.js';

import { rateLimit } from './_abuse-guard.js';
import { resolvePortalLink } from './_portal-link.js';
import { errorInfo } from '../src/shared/errorInfo.js';

/** A compressed slip (900px JPEG) is a few hundred KB as a data URL. */
const MAX_SLIP_CHARS = 1_500_000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    try {
        const { portal: portalLink, itemId, itemType, base64 } = req.body ?? {};
        if (!portalLink || typeof itemId !== 'string' || !itemId || (itemType !== 'bill' && itemType !== 'fine')
            || typeof base64 !== 'string' || !base64) {
            res.status(400).json({ error: 'Missing parameters' });
            return;
        }
        if (base64.length > MAX_SLIP_CHARS) { res.status(400).json({ error: 'Image too large' }); return; }

        const limited = await rateLimit(req, 'portal:slip', 20, 3600);
        if (!limited.ok) { res.status(429).json({ error: 'too_many_requests' }); return; }

        // The portal link proves the room; a slip can only be sent for that room's own bill or fine.
        const portal = await resolvePortalLink(portalLink);
        if (!portal) { res.status(401).json({ error: 'invalid_link' }); return; }
        const { ownerUid: uid, buildingId, roomId } = portal;

        const isFine = itemType === 'fine';
        const colPath = isFine ? 'fines' : 'bills';
        const targetDocRef = db.doc(`users/${uid}/buildings/${buildingId}/${colPath}/${itemId}`);
        const targetDoc = await targetDocRef.get();

        if (!targetDoc.exists || targetDoc.data()?.room_id !== roomId) {
            res.status(404).json({ error: 'Item not found' });
            return;
        }

        const targetData = targetDoc.data()!;
        const statusField = isFine ? 'status' : 'payment_status';

        if (targetData[statusField] === 'paid') {
            res.status(400).json({ error: 'Already paid' });
            return;
        }

        // Convert base64 data url to Buffer
        const match = base64.match(/^data:(image\/\w+);base64,(.+)$/);
        if (!match) {
            res.status(400).json({ error: 'Invalid base64 format' });
            return;
        }
        
        const mimeType = match[1];
        const base64Data = match[2];
        const imgBuffer = Buffer.from(base64Data, 'base64');

        // Decode QR
        const qr = await decodeSlipQR(imgBuffer);
        let duplicate = false;
        let fingerprint: string | null = null;
        
        if (qr.payload) {
            fingerprint = slipFingerprint(qr.payload);
            const refDoc = db.doc(`users/${uid}/buildings/${buildingId}/slip_refs/${fingerprint}`);
            try {
                await refDoc.create({
                    bill_id: itemId,
                    room_id: roomId,
                    created_at: admin.firestore.FieldValue.serverTimestamp(),
                });
            } catch (eRaw) {
                const e = errorInfo(eRaw);
                if (e.code === '6' || e.code === 'already-exists') {
                    duplicate = true;
                } else {
                    throw eRaw;
                }
            }
        }

        if (duplicate) {
            res.status(400).json({ error: 'Duplicate slip' });
            return;
        }

        // Store slip image
        await db.doc(`users/${uid}/buildings/${buildingId}/slip_images/${itemId}`).set({
            data_url: base64,
            bill_id: itemId,
            created_at: admin.firestore.FieldValue.serverTimestamp(),
        });

        const userSnap = await db.collection('users').doc(uid).get();
        const license = userSnap.data()?.license || 'free';
        const isPro = license === 'active' || !!license.match(/^(monthly|yearly)_(small|medium|large)$/);

        // Read the slip with AI and compare it with the bill and the property's receiving accounts
        // (amount, receiver name / account, date-time). Auto-approval needs every check to hold, and
        // the payment is then recorded as "slip only — not yet confirmed against the bank".
        const evaluation = await evaluateSlip({
            ownerUid: uid, buildingId, imageBase64: base64Data, mimeType, qrPayload: qr.payload,
            expectedAmount: isFine ? targetData.amount : targetData.total_bill,
            billCreatedAt: targetData.created_at as string | undefined,
            isPro,
        });
        const autoVerified = evaluation.autoApprove;

        const now = new Date().toISOString();

        await targetDocRef.update({
            [statusField]: autoVerified ? 'paid' : 'pending',
            slip_submitted_at: now,
            ...(autoVerified ? { paid_at: now, payment_date: now.split('T')[0] } : {}),
            slip_image: true,
            ...(fingerprint ? { slip_ref: fingerprint.slice(0, 12) } : {}),
            ...evaluation.fields,
            verify_note: evaluation.verifyNote,
        });

        res.status(200).json({ success: true, autoVerified, status: autoVerified ? 'paid' : 'pending' });

    } catch (error) {
        console.error('Upload slip error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}
