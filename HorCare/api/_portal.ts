/**
 * /api/portal — the tenant portal's only way to the data. Tenants never read or write Firestore directly.
 *
 * Tenant actions (no login; the portal link IS the credential — see _portal-link.ts):
 *   view                – this room's bills, fines, profile, repair + cleaning requests and the property's public settings.
 *                         When the property set a portal PIN, the PIN is checked here, not in the browser.
 *   profile_update      – the tenant edits their own contact details (allow-listed fields only)
 *   maintenance_create  – report a repair
 *   cleaning_create     – request cleaning
 *   contract_sign       – sign the contract the owner prepared for this room
 *   liff                – opened inside LINE: a LINE access token (verified with LINE) → this tenant's portal link
 *
 * Staff actions (Firebase sign-in, permission on the property):
 *   link    (tenant.read)   – the room's current portal link, to share with the tenant
 *   rotate  (tenant.update) – issue a new link; every older link for the room stops working (new tenant, leaked link)
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import { db } from './_firebase.js';
import { authorize, buildingExists } from './_rbac.js';
import { writeAudit } from './_audit.js';
import { rateLimit } from './_abuse-guard.js';
import { appBaseUrl } from './_app-url.js';
import { portalLinkFor, resolvePortalLink, rotatePortalLink, type PortalRoom } from './_portal-link.js';
import { pushToOwner } from './_notify-push.js';

export const config = { maxDuration: 15 };

const MAINTENANCE_CATEGORIES = ['electric', 'plumbing', 'appliance', 'door_window', 'bathroom', 'ac', 'furniture', 'other'];
const CLEANING_SERVICES = ['general', 'bathroom', 'balcony', 'deep', 'checkout'];
const PROFILE_FIELDS = ['full_name', 'nickname', 'phone', 'occupation', 'emergency_name', 'emergency_phone', 'emergency_relation'] as const;
/** A compressed photo (900px JPEG) is ~100–250 KB as a data URL; documents must stay well under Firestore's 1 MiB. */
const MAX_PHOTO_CHARS = 700_000;
const MAX_SIGNATURE_CHARS = 300_000;
const IMAGE_DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

// What the portal shows. Anything else in these documents (LINE ids, PIN, registration code, ID-card number …) stays server-side.
const ROOM_FIELDS = ['room_number', 'room_type', 'rent_amount', 'rent_type', 'language', 'zone', 'stall_size', 'floor', 'building_name'];
const CONFIG_FIELDS = ['building_type', 'collection_style', 'bill_customization'];
const PROFILE_VIEW_FIELDS = ['full_name', 'nickname', 'phone', 'occupation', 'emergency_name', 'emergency_phone', 'emergency_relation',
    'move_in_date', 'contract_end_date', 'tenant_count', 'signed_contract'];

function pick(src: Record<string, unknown> | undefined, keys: string[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (!src) return out;
    for (const k of keys) if (src[k] !== undefined) out[k] = src[k];
    return out;
}

/** Trimmed string within `max`, '' for missing; undefined when the value is not acceptable. */
function str(value: unknown, max: number): string | undefined {
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string') return undefined;
    const t = value.trim();
    return t.length > max ? undefined : t;
}

function photo(value: unknown): string | null | undefined {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || value.length > MAX_PHOTO_CHARS || !IMAGE_DATA_URL.test(value)) return undefined;
    return value;
}

const base = (r: PortalRoom) => `users/${r.ownerUid}/buildings/${r.buildingId}`;

interface Body {
    action?: string;
    portal?: unknown;
    pin?: unknown;
    access_token?: unknown;
    owner_uid?: string;
    building_id?: string;
    room_id?: string;
    [k: string]: unknown;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const body = (req.body ?? {}) as Body;
    const action = body.action;

    if (action === 'link' || action === 'rotate') return staffAction(req, res, body, action);
    if (action === 'liff') return liffAction(req, res, body);

    const TENANT = ['view', 'profile_update', 'maintenance_create', 'cleaning_create', 'contract_sign'];
    if (!action || !TENANT.includes(action)) { res.status(400).json({ error: 'unknown_action' }); return; }

    // generous for reads, tight for writes: a link is a long random secret, so this only blunts automated abuse
    const limited = await rateLimit(req, `portal:${action === 'view' ? 'view' : 'write'}`, action === 'view' ? 300 : 30, 3600);
    if (!limited.ok) { res.status(429).json({ error: 'too_many_requests', retry_after_sec: limited.retryAfterSec }); return; }

    const portal = await resolvePortalLink(body.portal);
    if (!portal) { res.status(401).json({ error: 'invalid_link' }); return; }
    const b = base(portal);
    const cfg = (await db.doc(`${b}/data/config`).get()).data() as Record<string, unknown> | undefined;

    // The PIN is the property's second factor for every tenant action, so it is checked on each call.
    const requiredPin = typeof cfg?.portal_pin === 'string' && cfg.portal_pin ? cfg.portal_pin : null;
    if (requiredPin) {
        if (typeof body.pin !== 'string' || !body.pin) { res.status(401).json({ error: 'pin_required' }); return; }
        if (body.pin !== requiredPin) {
            const tries = await rateLimit(req, `portal_pin:${portal.ownerUid}:${portal.buildingId}:${portal.roomId}`, 10, 900);
            res.status(tries.ok ? 401 : 429).json({ error: tries.ok ? 'pin_incorrect' : 'too_many_requests' });
            return;
        }
    }

    const roomNumber = String(portal.room.room_number ?? portal.roomId);

    if (action === 'view') {
        const [building, profile, bills, fines, maintenance, cleaning] = await Promise.all([
            db.doc(`users/${portal.ownerUid}/buildings/${portal.buildingId}`).get(),
            db.doc(`${b}/tenants/${portal.roomId}`).get(),
            db.collection(`${b}/bills`).where('room_id', '==', portal.roomId).get(),
            db.collection(`${b}/fines`).where('room_id', '==', portal.roomId).get(),
            db.collection(`${b}/maintenance`).where('room_id', '==', portal.roomId).get(),
            db.collection(`${b}/cleaning`).where('room_id', '==', portal.roomId).get(),
        ]);
        const docs = (s: { docs: { id: string; data: () => unknown }[] }) => s.docs.map(d => ({ ...(d.data() as object), id: d.id }));
        res.status(200).json({
            owner_uid: portal.ownerUid,
            building_id: portal.buildingId,
            room_id: portal.roomId,
            building_name: (building.data() as { name?: string } | undefined)?.name ?? '',
            room: { ...pick(portal.room, ROOM_FIELDS), id: portal.roomId },
            config: pick(cfg, CONFIG_FIELDS),
            profile: profile.exists ? { ...pick(profile.data() as Record<string, unknown>, PROFILE_VIEW_FIELDS), id: portal.roomId, room_id: portal.roomId } : null,
            bills: docs(bills),
            fines: docs(fines),
            maintenance: docs(maintenance),
            cleaning: docs(cleaning),
        });
        return;
    }

    const nowIso = new Date().toISOString();

    if (action === 'profile_update') {
        const patch: Record<string, string> = {};
        for (const f of PROFILE_FIELDS) {
            const v = str(body[f], f === 'full_name' || f === 'emergency_name' ? 120 : 60);
            if (v === undefined) { res.status(400).json({ error: 'invalid_input', field: f }); return; }
            patch[f] = v;
        }
        const ref = db.doc(`${b}/tenants/${portal.roomId}`);
        const snap = await ref.get();
        if (snap.exists) await ref.update({ ...patch, updated_at: nowIso });
        else await ref.set({ ...patch, id: portal.roomId, room_id: portal.roomId, building_id: portal.buildingId, created_at: nowIso, updated_at: nowIso });
        res.status(200).json({ ok: true });
        return;
    }

    if (action === 'maintenance_create') {
        const description = str(body.description, 1000);
        const pic = photo(body.photo);
        if (!description || pic === undefined || typeof body.category !== 'string' || !MAINTENANCE_CATEGORIES.includes(body.category)
            || (body.urgency !== 'urgent' && body.urgency !== 'normal')) {
            res.status(400).json({ error: 'invalid_input' });
            return;
        }
        const id = randomUUID();
        await db.doc(`${b}/maintenance/${id}`).set({
            id, room_id: portal.roomId, room_number: roomNumber, category: body.category, description, urgency: body.urgency,
            status: 'open', photo_url: pic, created_at: nowIso, updated_at: nowIso,
        });
        await pushToOwner(portal.ownerUid, {
            title: `แจ้งซ่อมใหม่ ห้อง ${roomNumber}`,
            body: `${body.urgency === 'urgent' ? '(ด่วน) ' : ''}${description.slice(0, 80)}`,
            data: { type: 'maintenance', roomId: portal.roomId, roomNumber },
        });
        res.status(200).json({ ok: true, id });
        return;
    }

    if (action === 'cleaning_create') {
        const description = str(body.description, 1000);
        const slot = str(body.preferred_time_slot, 60);
        const date = body.preferred_date === undefined || body.preferred_date === null || body.preferred_date === ''
            ? null : (typeof body.preferred_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.preferred_date) ? body.preferred_date : undefined);
        const pic = photo(body.photo);
        if (description === undefined || slot === undefined || date === undefined || pic === undefined
            || typeof body.service_type !== 'string' || !CLEANING_SERVICES.includes(body.service_type)) {
            res.status(400).json({ error: 'invalid_input' });
            return;
        }
        // at most a handful of open requests per room, so a leaked link cannot flood the housekeepers' list
        const open = (await db.collection(`${b}/cleaning`).where('room_id', '==', portal.roomId).get()).docs
            .filter(d => ['pending', 'open', 'in_progress', 'assigned'].includes(String((d.data() as { status?: string }).status)));
        if (open.length >= 5) { res.status(409).json({ error: 'too_many_open_requests' }); return; }

        const profile = (await db.doc(`${b}/tenants/${portal.roomId}`).get()).data() as { full_name?: string } | undefined;
        const id = randomUUID();
        await db.doc(`${b}/cleaning/${id}`).set({
            id, room_id: portal.roomId, room_number: roomNumber, tenant_name: profile?.full_name ?? '',
            service_type: body.service_type, preferred_date: date, preferred_time_slot: slot, description,
            status: 'pending', image_url: pic, has_photo: !!pic, created_at: nowIso, updated_at: nowIso,
        });
        await pushToOwner(portal.ownerUid, {
            title: `แจ้งทำความสะอาดใหม่ ห้อง ${roomNumber}`,
            body: `${body.service_type} - ${description.slice(0, 80) || 'ไม่มีบันทึกเพิ่มเติม'}`,
            data: { type: 'cleaning', roomId: portal.roomId, roomNumber },
        });
        res.status(200).json({ ok: true, id });
        return;
    }

    // contract_sign
    const signature = body.signature;
    if (typeof signature !== 'string' || signature.length > MAX_SIGNATURE_CHARS || !IMAGE_DATA_URL.test(signature)) {
        res.status(400).json({ error: 'invalid_signature' });
        return;
    }
    const tenantRef = db.doc(`${b}/tenants/${portal.roomId}`);
    const outcome = await db.runTransaction(async tx => {
        const snap = await tx.get(tenantRef);
        const contract = (snap.data() as { signed_contract?: { status?: string; lessee_name?: string; contract_number?: string } } | undefined)?.signed_contract;
        if (!contract) return 'no_contract' as const;
        if (contract.status === 'signed' || contract.status === 'terminated' || contract.status === 'expired') return 'not_signable' as const;
        tx.update(tenantRef, {
            signed_contract: { ...contract, lessee_signature: signature, lessee_signed_at: nowIso, status: 'signed' },
            updated_at: nowIso,
        });
        const eventId = randomUUID();
        tx.set(db.doc(`${b}/tenants/${portal.roomId}/events/${eventId}`), {
            id: eventId, room_id: portal.roomId, type: 'contract_signed_lessee', date: nowIso.slice(0, 10),
            note: `ผู้เช่า (${contract.lessee_name ?? ''}) ได้ลงนามสัญญาดิจิทัลเรียบร้อยแล้วผ่าน Tenant Portal (เลขที่สัญญา: ${contract.contract_number ?? '-'})`,
            created_by: 'tenant_portal', created_at: nowIso,
        });
        return 'signed' as const;
    });
    if (outcome !== 'signed') { res.status(409).json({ error: outcome }); return; }
    res.status(200).json({ ok: true, signed_at: nowIso });
}

async function staffAction(req: VercelRequest, res: VercelResponse, body: Body, action: 'link' | 'rotate') {
    const buildingId = body.building_id;
    const roomId = body.room_id;
    if (typeof buildingId !== 'string' || !buildingId || typeof roomId !== 'string' || !roomId) { res.status(400).json({ error: 'invalid_input' }); return; }
    const ctx = await authorize(req, res, { ownerUid: body.owner_uid, buildingId, permission: action === 'link' ? 'tenant.read' : 'tenant.update' });
    if (!ctx) return;
    if (!(await buildingExists(ctx.ownerUid, buildingId))) { res.status(404).json({ error: 'property_not_found' }); return; }
    const room = await db.doc(`users/${ctx.ownerUid}/buildings/${buildingId}/rooms/${roomId}`).get();
    if (!room.exists) { res.status(404).json({ error: 'room_not_found' }); return; }

    const r = { ownerUid: ctx.ownerUid, buildingId, roomId };
    const portal = action === 'link' ? await portalLinkFor(r) : await rotatePortalLink(r);
    if (action === 'rotate') {
        await writeAudit({
            ownerUid: ctx.ownerUid, propertyId: buildingId, userId: ctx.uid, userName: ctx.displayName, role: ctx.role,
            action: 'UPDATE', resourceType: 'portal_link', resourceId: roomId,
            resourceLabel: `Room ${String((room.data() as { room_number?: string }).room_number ?? roomId)}`,
            note: 'tenant portal link reset', req,
        });
    }
    res.status(200).json({ portal, url: `${appBaseUrl()}/?p=${encodeURIComponent(portal)}` });
}

/** The LINE Login channel the LIFF app belongs to (a LIFF id is "<channelId>-<suffix>"). */
function liffChannelId(): string {
    return process.env.LINE_LOGIN_CHANNEL_ID || (process.env.VITE_LIFF_ID ?? process.env.LIFF_ID ?? '').split('-')[0];
}

/** The LINE user behind an access token issued to OUR LIFF channel, or null. */
export async function lineUserFromAccessToken(token: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
    const channelId = liffChannelId();
    if (!channelId) throw new Error('liff_not_configured');
    const verify = await fetchImpl(`https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(token)}`);
    if (!verify.ok) return null;
    const info = await verify.json() as { client_id?: string; expires_in?: number };
    // a token from someone else's LINE app must not open our tenants' portals
    if (info.client_id !== channelId || !((info.expires_in ?? 0) > 0)) return null;
    const profile = await fetchImpl('https://api.line.me/v2/profile', { headers: { Authorization: `Bearer ${token}` } });
    if (!profile.ok) return null;
    const userId = (await profile.json() as { userId?: string }).userId;
    return typeof userId === 'string' && /^U[0-9a-f]{32}$/.test(userId) ? userId : null;
}

async function liffAction(req: VercelRequest, res: VercelResponse, body: Body) {
    const limited = await rateLimit(req, 'portal:liff', 60, 3600);
    if (!limited.ok) { res.status(429).json({ error: 'too_many_requests' }); return; }
    if (typeof body.access_token !== 'string' || !body.access_token || body.access_token.length > 2000) { res.status(400).json({ error: 'invalid_input' }); return; }
    let lineUserId: string | null;
    try {
        lineUserId = await lineUserFromAccessToken(body.access_token);
    } catch (e) {
        console.error('[portal] liff', (e as Error).message);
        res.status(503).json({ error: 'liff_not_configured' });
        return;
    }
    if (!lineUserId) { res.status(401).json({ error: 'invalid_token' }); return; }
    const reg = await db.collection('line_rooms').doc(lineUserId).get();
    if (!reg.exists) { res.status(404).json({ error: 'not_registered' }); return; }
    const { uid, building_id, room_id, room_number, dorm_name } = reg.data() as { uid: string; building_id: string; room_id: string; room_number?: string; dorm_name?: string };
    const room = await db.doc(`users/${uid}/buildings/${building_id}/rooms/${room_id}`).get();
    if (!room.exists) { res.status(404).json({ error: 'not_registered' }); return; }
    res.status(200).json({ portal: await portalLinkFor({ ownerUid: uid, buildingId: building_id, roomId: room_id }), room_number, dorm_name });
}
