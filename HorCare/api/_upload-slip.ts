import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db, admin } from './_firebase.js';
import { evaluateSlip } from './_slip-flow.js';
import { decodeSlipQR, slipFingerprint } from './_slip.js';
import { applySlipSplit, outstandingSatang, recordSlipPayment } from './_slip-payment.js';
import type { PaidItem } from './_accounting-data.js';

import { rateLimit } from './_abuse-guard.js';
import { resolvePortalLink } from './_portal-link.js';
import { errorInfo } from '../src/shared/errorInfo.js';
import { autoPostSafe } from './_ledger-auto.js';

/** A compressed slip (900px JPEG) is a few hundred KB as a data URL. */
const MAX_SLIP_CHARS = 1_500_000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    try {
        const { portal: portalLink, itemId, itemType, base64, action, slipRef: splitRef } = req.body ?? {};
        if (typeof itemId !== 'string' || !itemId || (itemType !== 'bill' && itemType !== 'fine')) {
            res.status(400).json({ error: 'Missing parameters' });
            return;
        }

        const limited = await rateLimit(req, 'portal:slip', 20, 3600);
        if (!limited.ok) { res.status(429).json({ error: 'too_many_requests' }); return; }

        // The portal link proves the room; a slip can only be sent for that room's own bill or fine.
        // Ids sent beside the link are ignored.
        const portal = await resolvePortalLink(portalLink);
        if (!portal) { res.status(401).json({ error: 'invalid_link' }); return; }
        const { ownerUid: uid, buildingId, roomId } = portal;

        // The tenant chose "split payment" for the slip they just uploaded.
        if (action === 'split') {
            if (typeof splitRef !== 'string' || !splitRef) { res.status(400).json({ error: 'Missing parameters' }); return; }
            const r = await applySlipSplit({ ownerUid: uid, buildingId, kind: itemType, itemId, roomId, slipRef: splitRef });
            if (r.status !== 'ok') { res.status(r.status === 'not_found' ? 404 : 409).json({ error: r.status }); return; }
            await autoPostSafe(uid, buildingId);
            res.status(200).json({ success: true, paid: r.paid, total: r.total, outstanding: r.outstanding });
            return;
        }

        if (typeof base64 !== 'string' || !base64) { res.status(400).json({ error: 'Missing parameters' }); return; }
        if (base64.length > MAX_SLIP_CHARS) { res.status(400).json({ error: 'Image too large' }); return; }

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
        // A bill already part-paid (split payment) is checked against what is still owed.
        const kind = isFine ? 'fine' : 'bill';
        const owed = outstandingSatang(kind, targetData as PaidItem) / 100;
        const evaluation = await evaluateSlip({
            ownerUid: uid, buildingId, imageBase64: base64Data, mimeType, qrPayload: qr.payload,
            expectedAmount: owed,
            billCreatedAt: targetData.created_at as string | undefined,
            isPro,
        });
        const autoVerified = evaluation.autoApprove;

        const now = new Date().toISOString();
        const slipRef = fingerprint ? fingerprint.slice(0, 12) : null;
        // the last part of a split payment is recorded as a payment too, so the bill's parts add up
        const settleAsPayment = autoVerified && !!targetData.payments_recorded && !!slipRef && typeof evaluation.fields.slip_account_id === 'string';

        await targetDocRef.update({
            [statusField]: autoVerified && !settleAsPayment ? 'paid' : 'pending',
            slip_submitted_at: now,
            ...(autoVerified && !settleAsPayment ? { paid_at: now, payment_date: now.split('T')[0] } : {}),
            slip_image: true,
            ...(slipRef ? { slip_ref: slipRef } : {}),
            ...evaluation.fields,
            verify_note: evaluation.verifyNote,
        });
        if (settleAsPayment) {
            await recordSlipPayment({
                ownerUid: uid, buildingId, kind, itemId, amountSatang: Math.round(owed * 100),
                bankAccountId: evaluation.fields.slip_account_id as string, slipRef: slipRef!,
                paidAt: evaluation.details?.datetime_iso ?? now, transactionRef: (evaluation.fields.transaction_ref as string | undefined) ?? null,
                note: 'ชำระส่วนที่เหลือจากสลิป',
            });
        }

        if (autoVerified) await autoPostSafe(uid, buildingId);
        res.status(200).json({
            success: true, autoVerified, status: autoVerified ? 'paid' : 'pending',
            outcome: evaluation.outcome, problems: evaluation.problems,
            // offered to the tenant as "record this as a split payment"
            split: evaluation.splitAmount != null && slipRef ? { amount: evaluation.splitAmount, owed, slipRef } : null,
        });

    } catch (error) {
        console.error('Upload slip error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}
