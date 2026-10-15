/**
 * /api/auto-post — run automatic ledger posting (api/_ledger-auto.ts).
 *
 *   POST { owner_uid, building_id }  – the owner app after recording money it wrote itself (e.g. marking a
 *                                      bill paid). Needs `payment.create` on the property.
 *   GET                              – daily Vercel Cron safety net over every ledger. CRON_SECRET only.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from './_firebase.js';
import { authorize, buildingExists } from './_rbac.js';
import { autoPostBuilding } from './_ledger-auto.js';

export const config = { maxDuration: 60 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method === 'GET') {
        // fail closed: no secret configured means nobody may run it
        const secret = process.env.CRON_SECRET;
        if (!secret || req.headers['authorization'] !== `Bearer ${secret}`) { res.status(401).json({ error: 'unauthorized' }); return; }
        const snap = await db.collectionGroup('ledgers').get();
        let posted = 0; let ledgers = 0;
        for (const d of snap.docs) {
            const owner = d.ref.parent.parent?.id;
            const first = (d.data() as { property_ids?: string[] }).property_ids?.[0];
            if (!owner || !first) continue;
            try {
                const r = await autoPostBuilding(owner, first);
                if (r) { ledgers++; posted += r.posted; }
            } catch (e) {
                console.error('[auto-post cron]', owner, d.id, (e as Error).message);
            }
        }
        res.status(200).json({ ledgers, posted });
        return;
    }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

    const body = (req.body ?? {}) as { owner_uid?: string; building_id?: string };
    if (typeof body.building_id !== 'string' || !body.building_id) { res.status(400).json({ error: 'invalid_input' }); return; }
    const ctx = await authorize(req, res, { ownerUid: body.owner_uid, buildingId: body.building_id, permission: 'payment.create' });
    if (!ctx) return;
    if (!(await buildingExists(ctx.ownerUid, body.building_id))) { res.status(404).json({ error: 'property_not_found' }); return; }
    const r = await autoPostBuilding(ctx.ownerUid, body.building_id);
    res.status(200).json({ result: r });
}
