import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import { db } from './_firebase.js';
import { authorize, buildingExists } from './_rbac.js';
import { writeAudit } from './_audit.js';
import { notify } from './_notify.js';
import {
    canTransition, isParcelStatus,
    type Parcel, type ParcelStatus, type TenantParcelView,
} from '../src/shared/parcels.js';

export const config = { maxDuration: 20 };

interface Body {
    action?: 'create' | 'update_status' | 'renotify' | 'tenant_list';
    owner_uid?: string;
    building_id?: string;
    room_id?: string;
    parcel_id?: string;
    status?: string;
    carrier?: string;
    tracking_number?: string;
    recipient_name?: string;
    storage_location?: string;
    note?: string;
    /** Base64 JPEG (no data-URL header), already compressed by the client. */
    image_base64?: string;
    picked_up_by_name?: string;
}

const MAX_IMAGE_CHARS = 450_000;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** Trim and cap an optional free-text field. Returns null for empty, undefined if invalid type. */
function text(value: unknown, max: number): string | null | undefined {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') return undefined;
    const t = value.trim();
    if (t.length > max) return undefined;
    return t || null;
}

const base = (owner: string, bld: string) => `users/${owner}/buildings/${bld}`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const body = (req.body ?? {}) as Body;
    const buildingId = body.building_id;
    if (!buildingId || typeof buildingId !== 'string') { res.status(400).json({ error: 'building_id is required' }); return; }

    // ── Tenant portal: minimal, read-only view of one room's parcels ─────────────
    if (body.action === 'tenant_list') {
        const ownerUid = body.owner_uid;
        const roomId = body.room_id;
        if (typeof ownerUid !== 'string' || typeof roomId !== 'string' || !ownerUid || !roomId) {
            res.status(400).json({ error: 'invalid_input' });
            return;
        }
        const room = await db.doc(`${base(ownerUid, buildingId)}/rooms/${roomId}`).get();
        if (!room.exists) { res.status(404).json({ error: 'not_found' }); return; }
        const snap = await db.collection(`${base(ownerUid, buildingId)}/parcels`).where('room_id', '==', roomId).get();
        const parcels: TenantParcelView[] = snap.docs
            .map(d => d.data() as Parcel)
            .sort((a, b) => b.received_at.localeCompare(a.received_at))
            .slice(0, 30)
            .map(p => ({
                id: p.id, carrier: p.carrier, status: p.status, received_at: p.received_at,
                storage_location: p.storage_location, picked_up_at: p.picked_up_at,
            }));
        res.status(200).json({ parcels });
        return;
    }

    // ── Staff actions ─────────────────────────────────────────────────────────────
    if (body.action === 'create') {
        const ctx = await authorize(req, res, { ownerUid: body.owner_uid, buildingId, permission: 'parcel.create' });
        if (!ctx) return;
        if (!(await buildingExists(ctx.ownerUid, buildingId))) { res.status(404).json({ error: 'property_not_found' }); return; }

        const carrier = text(body.carrier, 40);
        const tracking = text(body.tracking_number, 60);
        const recipient = text(body.recipient_name, 80);
        const storage = text(body.storage_location, 60);
        const note = text(body.note, 300);
        if (!carrier || tracking === undefined || recipient === undefined || storage === undefined || note === undefined) {
            res.status(400).json({ error: 'invalid_input' });
            return;
        }
        if (typeof body.room_id !== 'string' || !body.room_id) { res.status(400).json({ error: 'room_id is required' }); return; }

        let image: string | null = null;
        if (body.image_base64 !== undefined && body.image_base64 !== '') {
            if (typeof body.image_base64 !== 'string' || body.image_base64.length > MAX_IMAGE_CHARS || !BASE64_RE.test(body.image_base64)) {
                res.status(400).json({ error: 'invalid_image' });
                return;
            }
            image = body.image_base64;
        }

        // The parcel is bound to a room the staff member picked — never matched from the label name.
        const b = base(ctx.ownerUid, buildingId);
        const roomSnap = await db.doc(`${b}/rooms/${body.room_id}`).get();
        if (!roomSnap.exists || roomSnap.data()?.is_active === false) { res.status(404).json({ error: 'room_not_found' }); return; }
        const room = roomSnap.data()!;
        const profile = await db.doc(`${b}/tenants/${body.room_id}`).get();

        if (tracking) {
            const dup = await db.collection(`${b}/parcels`).where('tracking_number', '==', tracking).get();
            if (dup.docs.some(d => d.data().status !== 'picked_up')) {
                res.status(409).json({ error: 'duplicate_tracking', message: 'เลขพัสดุนี้ถูกบันทึกไว้แล้วและยังไม่ได้รับ' });
                return;
            }
        }

        const id = randomUUID();
        const now = new Date().toISOString();
        const parcel: Parcel = {
            id, organization_id: ctx.ownerUid, property_id: buildingId,
            room_id: body.room_id, room_number: room.room_number,
            tenant_id: body.room_id, tenant_name: (profile.data()?.full_name as string | undefined) ?? null,
            recipient_name: recipient, carrier, tracking_number: tracking, storage_location: storage, note,
            has_image: image !== null, status: 'received',
            received_at: now, received_by: ctx.uid, received_by_name: ctx.displayName,
            picked_up_at: null, picked_up_by: null, picked_up_by_name: null,
            notified_at: null, notify_channels: null, last_reminded_at: null, reminder_count: 0, created_at: now,
        };
        await db.doc(`${b}/parcels/${id}`).set(parcel);
        if (image) await db.doc(`${b}/parcel_images/${id}`).set({ data_url: `data:image/jpeg;base64,${image}`, created_at: now });

        // Tell the tenant. Status advances to "notified" only if something was actually delivered.
        const result = await notify({
            event: 'parcel.received', ownerUid: ctx.ownerUid, buildingId, roomId: body.room_id,
            data: { carrier, storage_location: storage },
        });
        if (result.delivered) {
            await db.doc(`${b}/parcels/${id}`).update({ status: 'tenant_notified', notified_at: now, notify_channels: result.channels });
            parcel.status = 'tenant_notified';
        } else {
            await db.doc(`${b}/parcels/${id}`).update({ notify_channels: result.channels });
        }
        parcel.notify_channels = result.channels;

        await writeAudit({
            ownerUid: ctx.ownerUid, propertyId: buildingId, userId: ctx.uid, userName: ctx.displayName, role: ctx.role,
            action: 'CREATE', resourceType: 'parcel', resourceId: id, resourceLabel: `Parcel · Room ${room.room_number}`,
            after: { carrier, tracking_number: tracking, status: parcel.status }, req,
        });
        res.status(200).json({ parcel, notify: result.channels });
        return;
    }

    if (body.action === 'update_status' || body.action === 'renotify') {
        const ctx = await authorize(req, res, { ownerUid: body.owner_uid, buildingId, permission: 'parcel.update' });
        if (!ctx) return;
        if (!body.parcel_id || typeof body.parcel_id !== 'string') { res.status(400).json({ error: 'parcel_id is required' }); return; }
        const b = base(ctx.ownerUid, buildingId);
        const ref = db.doc(`${b}/parcels/${body.parcel_id}`);
        const snap = await ref.get();
        if (!snap.exists) { res.status(404).json({ error: 'not_found' }); return; }
        const parcel = snap.data() as Parcel;

        if (body.action === 'renotify') {
            if (parcel.status === 'picked_up') { res.status(409).json({ error: 'already_picked_up' }); return; }
            const result = await notify({
                event: 'parcel.received', ownerUid: ctx.ownerUid, buildingId, roomId: parcel.room_id,
                data: { carrier: parcel.carrier, storage_location: parcel.storage_location },
            });
            await ref.update({ notify_channels: result.channels, ...(result.delivered && !parcel.notified_at ? { notified_at: new Date().toISOString() } : {}) });
            res.status(200).json({ notify: result.channels });
            return;
        }

        if (!isParcelStatus(body.status)) { res.status(400).json({ error: 'invalid_status' }); return; }
        const to: ParcelStatus = body.status;
        if (!canTransition(parcel.status, to)) {
            res.status(409).json({ error: 'invalid_transition', message: `เปลี่ยนสถานะจาก ${parcel.status} เป็น ${to} ไม่ได้` });
            return;
        }
        const updates: Partial<Parcel> = { status: to };
        if (to === 'picked_up') {
            const who = text(body.picked_up_by_name, 80);
            if (who === undefined) { res.status(400).json({ error: 'invalid_input' }); return; }
            updates.picked_up_at = new Date().toISOString();
            updates.picked_up_by = ctx.uid;                // the staff member who handed it over
            updates.picked_up_by_name = who ?? ctx.displayName;
        }
        await ref.update(updates);
        await writeAudit({
            ownerUid: ctx.ownerUid, propertyId: buildingId, userId: ctx.uid, userName: ctx.displayName, role: ctx.role,
            action: 'UPDATE', resourceType: 'parcel', resourceId: parcel.id, resourceLabel: `Parcel · Room ${parcel.room_number}`,
            before: { status: parcel.status }, after: { status: to }, req,
        });
        res.status(200).json({ ok: true });
        return;
    }

    res.status(400).json({ error: 'unknown_action' });
}
