/**
 * /api/tenant-link — fix a LINE account bound to the wrong room (a new tenant typed or was invited
 * to the wrong one).
 *
 *   move   – re-bind the room's LINE account to the correct room
 *   unlink – remove the binding (the tenant registers again with a fresh invitation)
 *
 * Needs `tenant.update` on the property (owner / property manager). Both rooms must belong to the
 * caller's property, and a move never displaces another tenant: the target room must be free.
 * Both are audited and the tenant is told on LINE when their room changed.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { admin, db } from './_firebase.js';
import { authorize, buildingExists } from './_rbac.js';
import { writeAudit } from './_audit.js';
import { linePush } from './_line.js';

export const config = { maxDuration: 15 };

interface Body {
    action?: 'move' | 'unlink';
    owner_uid?: string;
    building_id?: string;
    room_id?: string;
    to_room_id?: string;
}

class HttpError extends Error {
    constructor(public status: number, public code: string) { super(code); }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const body = (req.body ?? {}) as Body;
    const buildingId = body.building_id;
    if (!buildingId || typeof buildingId !== 'string') { res.status(400).json({ error: 'building_id is required' }); return; }
    if (body.action !== 'move' && body.action !== 'unlink') { res.status(400).json({ error: 'unknown_action' }); return; }
    if (typeof body.room_id !== 'string' || !body.room_id) { res.status(400).json({ error: 'invalid_input' }); return; }
    if (body.action === 'move' && (typeof body.to_room_id !== 'string' || !body.to_room_id || body.to_room_id === body.room_id)) {
        res.status(400).json({ error: 'invalid_input' });
        return;
    }

    const ctx = await authorize(req, res, { ownerUid: body.owner_uid, buildingId, permission: 'tenant.update' });
    if (!ctx) return;
    if (!(await buildingExists(ctx.ownerUid, buildingId))) { res.status(404).json({ error: 'property_not_found' }); return; }

    const base = `users/${ctx.ownerUid}/buildings/${buildingId}`;
    const fromRef = db.doc(`${base}/rooms/${body.room_id}`);
    const toRef = body.action === 'move' ? db.doc(`${base}/rooms/${body.to_room_id}`) : null;

    try {
        const out = await db.runTransaction(async tx => {
            const fromSnap = await tx.get(fromRef);
            const toSnap = toRef ? await tx.get(toRef) : null;
            if (!fromSnap.exists) throw new HttpError(404, 'room_not_found');
            const from = fromSnap.data() as { room_number: string; line_user_id?: string };
            const lineUserId = from.line_user_id;
            if (!lineUserId) throw new HttpError(409, 'not_linked');

            const linkRef = db.collection('line_rooms').doc(lineUserId);
            const threadRef = db.doc(`${base}/line_threads/${lineUserId}`);
            const threadSnap = await tx.get(threadRef);
            const linkSnap = await tx.get(linkRef);
            const link = linkSnap.exists ? (linkSnap.data() as { uid?: string; building_id?: string }) : null;
            // the registration must belong to this very property, or we'd be editing someone else's binding
            if (link && (link.uid !== ctx.ownerUid || link.building_id !== buildingId)) throw new HttpError(409, 'link_mismatch');

            if (body.action === 'unlink') {
                tx.update(fromRef, { line_user_id: admin.firestore.FieldValue.delete() });
                if (link) tx.delete(linkRef);
                return { lineUserId, fromNumber: from.room_number, toNumber: null as string | null };
            }

            if (!toSnap?.exists || (toSnap.data() as { is_active?: boolean }).is_active === false) throw new HttpError(404, 'target_not_found');
            const to = toSnap.data() as { room_number: string; line_user_id?: string };
            if (to.line_user_id && to.line_user_id !== lineUserId) throw new HttpError(409, 'target_occupied');

            tx.update(toRef!, { line_user_id: lineUserId });
            if (link) tx.update(linkRef, { room_id: body.to_room_id, room_number: to.room_number });
            else tx.set(linkRef, { uid: ctx.ownerUid, building_id: buildingId, room_id: body.to_room_id, room_number: to.room_number, registered_at: new Date().toISOString() });
            tx.update(fromRef, { line_user_id: admin.firestore.FieldValue.delete() });
            if (threadSnap.exists) tx.update(threadRef, { room_id: body.to_room_id, room_number: to.room_number });
            return { lineUserId, fromNumber: from.room_number, toNumber: to.room_number };
        });

        await writeAudit({
            ownerUid: ctx.ownerUid, propertyId: buildingId, userId: ctx.uid, userName: ctx.displayName, role: ctx.role,
            action: 'UPDATE', resourceType: 'line_link', resourceId: body.room_id,
            resourceLabel: out.toNumber ? `Room ${out.fromNumber} → ${out.toNumber}` : `Room ${out.fromNumber}`,
            note: out.toNumber ? 'LINE binding moved' : 'LINE binding removed', req,
        });
        // Best-effort: tell the tenant which room they are now registered to.
        if (out.toNumber && process.env.LINE_CHANNEL_ACCESS_TOKEN) {
            await linePush(out.lineUserId, [{ type: 'text', text: `🏠 เจ้าของหอปรับการลงทะเบียนของคุณเป็นห้อง ${out.toNumber} แล้วค่ะ\n\nหากไม่ถูกต้อง กรุณาแจ้งเจ้าของหอ` }]).catch(() => undefined);
        }
        res.status(200).json({ ok: true, room_number: out.toNumber });
    } catch (e) {
        if (e instanceof HttpError) { res.status(e.status).json({ error: e.code }); return; }
        throw e;
    }
}
