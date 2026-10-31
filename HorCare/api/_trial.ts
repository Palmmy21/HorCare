import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db, admin } from './_firebase.js';
import { canStartTrial, TRIAL_DAYS, type TrialFields } from '../src/shared/trial.js';

/**
 * POST /api/trial — start the signed-in owner's one-time HorCare Pro trial.
 * trial_started_at / trial_until are protected fields: only this route writes them, so a client cannot extend its own trial.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return; }

    const header = req.headers.authorization ?? '';
    if (!header.startsWith('Bearer ')) { res.status(401).json({ error: 'unauthenticated' }); return; }
    let uid: string;
    try { uid = (await admin.auth().verifyIdToken(header.slice('Bearer '.length))).uid; } catch { res.status(401).json({ error: 'unauthenticated' }); return; }

    const ref = db.collection('users').doc(uid);
    const result = await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists) return { status: 404, body: { error: 'user_not_found' } };
        const user = snap.data() as TrialFields & { status?: string };
        if (user.status === 'banned') return { status: 403, body: { error: 'banned' } };
        if (user.trial_started_at) return { status: 409, body: { error: 'trial_used', message: 'บัญชีนี้ใช้สิทธิ์ทดลองใช้ไปแล้ว' } };
        if (!canStartTrial(user)) return { status: 409, body: { error: 'already_paid', message: 'บัญชีนี้มีแพ็กเกจอยู่แล้ว' } };

        const now = Date.now();
        const trialUntil = now + TRIAL_DAYS * 86_400_000;
        tx.update(ref, { trial_started_at: now, trial_until: trialUntil });
        return { status: 200, body: { ok: true, trial_until: trialUntil } };
    });

    res.status(result.status).json(result.body);
}
