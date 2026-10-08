import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db, admin } from './_firebase.js';
import { readSlipAmount } from './_slip-ai.js';
import { decodeSlipQR, slipFingerprint } from './_slip.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    try {
        const { uid, buildingId, roomId, itemId, itemType, base64 } = req.body;
        if (!uid || !buildingId || !roomId || !itemId || !itemType || !base64) {
            res.status(400).json({ error: 'Missing parameters' });
            return;
        }

        const isFine = itemType === 'fine';
        const colPath = isFine ? 'fines' : 'bills';
        const targetDocRef = db.doc(`users/${uid}/buildings/${buildingId}/${colPath}/${itemId}`);
        const targetDoc = await targetDocRef.get();

        if (!targetDoc.exists) {
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
            } catch (e: any) {
                if (e?.code === 6 || e?.code === 'already-exists') {
                    duplicate = true;
                } else {
                    throw e;
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

        // AI Verification
        let autoVerified = false;
        let geminiAmount: number | null = null;
        
        const userSnap = await db.collection('users').doc(uid).get();
        const license = userSnap.data()?.license || 'free';
        const isPro = license === 'active' || !!license.match(/^(monthly|yearly)_(small|medium|large)$/);

        if (isPro && qr.payload) {
            // AI only suggests the amount; auto-approval needs it to equal the bill exactly.
            geminiAmount = await readSlipAmount(base64Data, mimeType);
            const expectedAmount = isFine ? targetData.amount : targetData.total_bill;
            if (typeof geminiAmount === 'number' && geminiAmount === expectedAmount) {
                autoVerified = true;
            }
        }

        const now = new Date().toISOString();
        const qrPassed = !!qr.payload;

        await targetDocRef.update({
            [statusField]: autoVerified ? 'paid' : 'pending',
            slip_submitted_at: now,
            ...(autoVerified ? { paid_at: now, payment_date: now.split('T')[0] } : {}),
            slip_image: true,
            ...(fingerprint ? { slip_ref: fingerprint.slice(0, 12) } : {}),
            ...(geminiAmount !== null ? { slip_amount: geminiAmount, slip_ai_amount: geminiAmount } : {}),
            verify_note: autoVerified 
                ? 'อนุมัติอัตโนมัติด้วย AI (ยอดเงินตรง)'
                : qrPassed
                    ? 'ตรวจ QR ผ่าน (ไม่ซ้ำ) — รอเจ้าของยืนยันยอด'
                    : 'อ่าน QR ไม่ได้ — โปรดตรวจสลิปด้วยตา',
        });

        res.status(200).json({ success: true, autoVerified, status: autoVerified ? 'paid' : 'pending' });

    } catch (error) {
        console.error('Upload slip error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}
