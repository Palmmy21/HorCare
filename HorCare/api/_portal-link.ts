/**
 * /api/portal-link — the signed tenant-portal link of a room, for the owner app's "copy link".
 * Needs `tenant.read` on the property, and the room must belong to it.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from './_firebase.js';
import { authorize } from './_rbac.js';
import { portalQuery } from './_portal-token.js';

export const config = { maxDuration: 10 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const body = (req.body ?? {}) as { owner_uid?: string; building_id?: string; room_id?: string };
    if (typeof body.building_id !== 'string' || !body.building_id || typeof body.room_id !== 'string' || !body.room_id) {
        res.status(400).json({ error: 'invalid_input' });
        return;
    }
    const ctx = await authorize(req, res, { ownerUid: body.owner_uid, buildingId: body.building_id, permission: 'tenant.read' });
    if (!ctx) return;
    const room = await db.doc(`users/${ctx.ownerUid}/buildings/${body.building_id}/rooms/${body.room_id}`).get();
    if (!room.exists) { res.status(404).json({ error: 'room_not_found' }); return; }
    res.status(200).json({ query: portalQuery(ctx.ownerUid, body.building_id, body.room_id) });
}
