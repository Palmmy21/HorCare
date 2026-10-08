/**
 * Security alerts: raised when a LINE account gets bound to a room (see src/shared/security-alerts.ts),
 * acknowledged by an admin on the Security page.
 *
 * raiseBindingAlert never throws — a failed alert must not undo a tenant's registration.
 * Handler (/api/security-alerts): ack | ack_all, needs `audit_log.read` (owner / property manager),
 * and only touches the caller's own property.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import { db } from './_firebase.js';
import { authorize, buildingExists } from './_rbac.js';
import { writeAudit } from './_audit.js';
import {
    describeBinding, lineRef, type BindingEvent, type SecurityAlert,
} from '../src/shared/security-alerts.js';

export const config = { maxDuration: 15 };

const colOf = (owner: string, bld: string) => `users/${owner}/buildings/${bld}/security_alerts`;

export async function raiseBindingAlert(
    ownerUid: string, buildingId: string,
    input: BindingEvent & { roomId: string; lineUserId: string },
): Promise<void> {
    try {
        const d = describeBinding(input);
        const alert: SecurityAlert = {
            id: randomUUID(), ...d,
            room_id: input.roomId, room_number: input.roomNumber, from_room_number: input.movedFromRoomNumber,
            line_ref: lineRef(input.lineUserId), via: input.via,
            status: 'open', created_at: new Date().toISOString(),
        };
        await db.doc(`${colOf(ownerUid, buildingId)}/${alert.id}`).set(alert);
    } catch (err) {
        console.error('[security-alerts] raise failed:', (err as Error).message);
    }
}

interface Body {
    action?: 'ack' | 'ack_all';
    owner_uid?: string;
    building_id?: string;
    alert_id?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const body = (req.body ?? {}) as Body;
    const buildingId = body.building_id;
    if (!buildingId || typeof buildingId !== 'string') { res.status(400).json({ error: 'building_id is required' }); return; }
    if (body.action !== 'ack' && body.action !== 'ack_all') { res.status(400).json({ error: 'unknown_action' }); return; }

    const ctx = await authorize(req, res, { ownerUid: body.owner_uid, buildingId, permission: 'audit_log.read' });
    if (!ctx) return;
    if (!(await buildingExists(ctx.ownerUid, buildingId))) { res.status(404).json({ error: 'property_not_found' }); return; }

    const col = colOf(ctx.ownerUid, buildingId);
    const patch = { status: 'acknowledged', ack_by: ctx.displayName, ack_at: new Date().toISOString() };
    let count = 0;
    if (body.action === 'ack') {
        if (typeof body.alert_id !== 'string' || !body.alert_id) { res.status(400).json({ error: 'invalid_input' }); return; }
        const ref = db.doc(`${col}/${body.alert_id}`);
        if (!(await ref.get()).exists) { res.status(404).json({ error: 'not_found' }); return; }
        await ref.update(patch);
        count = 1;
    } else {
        const open = await db.collection(col).where('status', '==', 'open').get();
        for (const d of open.docs) { await db.doc(`${col}/${d.id}`).update(patch); count++; }
    }
    await writeAudit({
        ownerUid: ctx.ownerUid, propertyId: buildingId, userId: ctx.uid, userName: ctx.displayName, role: ctx.role,
        action: 'UPDATE', resourceType: 'security_alert', resourceId: body.alert_id ?? null,
        resourceLabel: `${count} alert(s)`, note: 'acknowledged', req,
    });
    res.status(200).json({ acknowledged: count });
}
