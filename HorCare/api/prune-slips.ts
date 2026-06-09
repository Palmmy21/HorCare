import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db, admin } from './_firebase.js';

/**
 * Scheduled cleanup (Vercel Cron — see vercel.json) that keeps slip storage bounded
 * so the system scales to many dorms without filling Firestore.
 *
 * Slip images are stored as base64 in `slip_images/{billId}` and dedup keys in
 * `slip_refs/{fingerprint}`. Both are write-once and only useful for a few months,
 * so we delete anything older than RETAIN_MONTHS via collection-group queries.
 *
 * Protected by CRON_SECRET: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
 */

const RETAIN_MONTHS = 6;
const BATCH = 300;

async function pruneCollection(group: string, cutoff: FirebaseFirestore.Timestamp): Promise<number> {
    let deleted = 0;
    // Loop in batches until nothing older than the cutoff remains.
    for (;;) {
        const snap = await db
            .collectionGroup(group)
            .where('created_at', '<', cutoff)
            .limit(BATCH)
            .get();
        if (snap.empty) break;
        const batch = db.batch();
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
        deleted += snap.size;
        if (snap.size < BATCH) break;
    }
    return deleted;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers['authorization'] !== `Bearer ${secret}`) {
        res.status(401).send('Unauthorized');
        return;
    }

    const cutoff = admin.firestore.Timestamp.fromMillis(
        Date.now() - RETAIN_MONTHS * 30 * 24 * 60 * 60 * 1000,
    );

    try {
        const images = await pruneCollection('slip_images', cutoff);
        const refs = await pruneCollection('slip_refs', cutoff);
        res.status(200).json({ ok: true, retain_months: RETAIN_MONTHS, deleted: { slip_images: images, slip_refs: refs } });
    } catch (err) {
        console.error('prune-slips failed:', (err as Error).message);
        res.status(500).json({ ok: false, error: (err as Error).message });
    }
}
