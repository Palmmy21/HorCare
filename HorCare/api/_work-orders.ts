/**
 * /api/work-orders — technician & housekeeping jobs, notified over LINE.
 *
 * Two kinds of caller:
 *  • Signed-in managers (Bearer token → authorize()): create jobs, manage staff, assign,
 *    verify / close / reopen.
 *  • Staff, who have no HorCare account: they act through a personal link that embeds a
 *    per-job secret (only its sha256 is stored). The link only ever opens that one job.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { db } from './_firebase.js';
import { authorize, buildingExists } from './_rbac.js';
import { writeAudit } from './_audit.js';
import { appBaseUrl, notify, type NotifyResult } from './_notify.js';
import {
    MAX_WORK_IMAGES, WORK_TYPE_LABELS_TH, canTransition, isPriority, isWorkType,
    type StaffRole, type StaffWorkView, type WorkImageKind, type WorkOrder, type WorkStaff, type WorkStatus,
} from '../src/shared/workOrders.js';

export const config = { maxDuration: 20 };

const MAX_IMAGE_CHARS = 450_000;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LINK_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LINK_CODE_RE = /^HCS-[A-HJ-NP-Z2-9]{8}$/;
const LINK_TTL_MS = 24 * 3600 * 1000;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const baseOf = (owner: string, bld: string) => `users/${owner}/buildings/${bld}`;

function safeEqualHex(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Trim + cap an optional string. null = empty, undefined = invalid. */
function text(value: unknown, max: number): string | null | undefined {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') return undefined;
    const t = value.trim();
    if (t.length > max) return undefined;
    return t || null;
}

function validImage(v: unknown): v is string {
    return typeof v === 'string' && v.length > 0 && v.length <= MAX_IMAGE_CHARS && BASE64_RE.test(v);
}

function validDate(v: unknown): v is string {
    return typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(Date.parse(v));
}

// ── Staff ↔ LINE link codes ───────────────────────────────────────────────────
export function isStaffLinkCode(t: string): boolean {
    return LINK_CODE_RE.test(t.trim().toUpperCase());
}

export type StaffLinkResult =
    | { ok: true; staffName: string; dormName: string }
    | { ok: false; reason: 'not_found' | 'expired' | 'used' | 'staff_unavailable' };

/** A staff member sends their code to the LINE OA; this binds that LINE account to them. */
export async function redeemStaffLink(lineUserId: string, rawCode: string): Promise<StaffLinkResult> {
    if (!isStaffLinkCode(rawCode)) return { ok: false, reason: 'not_found' };
    const linkRef = db.collection('staff_links').doc(sha256(rawCode.trim().toUpperCase()));

    const result = await db.runTransaction<StaffLinkResult>(async tx => {
        const linkSnap = await tx.get(linkRef);
        if (!linkSnap.exists) return { ok: false, reason: 'not_found' };
        const link = linkSnap.data()!;
        if (link.used_by_line_user && link.used_by_line_user !== lineUserId) return { ok: false, reason: 'used' };
        if (link.expires_at <= Date.now()) return { ok: false, reason: 'expired' };

        const staffRef = db.doc(`${baseOf(link.owner_uid, link.building_id)}/staff/${link.staff_id}`);
        const staffSnap = await tx.get(staffRef);
        if (!staffSnap.exists || staffSnap.data()?.active === false) return { ok: false, reason: 'staff_unavailable' };
        const cfg = await tx.get(db.doc(`${baseOf(link.owner_uid, link.building_id)}/data/config`));

        tx.update(staffRef, { line_user_id: lineUserId, linked_at: new Date().toISOString() });
        tx.update(linkRef, { used_by_line_user: lineUserId, used_at: new Date().toISOString() });
        return { ok: true, staffName: staffSnap.data()!.name, dormName: cfg.data()?.bill_customization?.dorm_name || '' };
    });

    if (result.ok) {
        const link = (await linkRef.get()).data()!;
        await writeAudit({
            ownerUid: link.owner_uid, propertyId: link.building_id, userId: `line:${lineUserId}`, role: 'staff',
            action: 'UPDATE', resourceType: 'staff', resourceId: link.staff_id, resourceLabel: result.staffName,
            note: 'staff linked LINE account',
        });
    }
    return result;
}

// ── Staff links to a single job ───────────────────────────────────────────────
interface ParsedLink { ownerUid: string; buildingId: string; workOrderId: string; secret: string }

function makeLink(ownerUid: string, buildingId: string, workOrderId: string, secret: string): string {
    const packed = [ownerUid, buildingId, workOrderId, secret].join('~');
    return `${appBaseUrl()}/?w=${encodeURIComponent(packed)}`;
}

function parseLink(packed: unknown): ParsedLink | null {
    if (typeof packed !== 'string' || packed.length > 400) return null;
    const parts = packed.split('~');
    if (parts.length !== 4 || parts.some(p => !p)) return null;
    return { ownerUid: parts[0], buildingId: parts[1], workOrderId: parts[2], secret: parts[3] };
}

function newSecret(): string {
    let s = '';
    for (let i = 0; i < 24; i++) s += LINK_ALPHABET[randomInt(LINK_ALPHABET.length)];
    return s;
}

interface Body {
    action?: string;
    owner_uid?: string;
    building_id?: string;
    // staff
    staff_id?: string;
    name?: string;
    phone?: string;
    role?: string;
    active?: boolean;
    // work orders
    work_order_id?: string;
    room_id?: string;
    area?: string;
    work_type?: string;
    description?: string;
    priority?: string;
    due_date?: string;
    images?: unknown;
    assign_staff_id?: string;
    note?: string;
    // staff (link) actions
    link?: string;
    status?: string;
}

async function assign(
    ownerUid: string, buildingId: string, order: WorkOrder, staff: WorkStaff, byName: string,
): Promise<{ link: string; notify: NotifyResult }> {
    const secret = newSecret();
    const now = new Date().toISOString();
    const events = [...order.events, { at: now, by: byName, type: 'assigned' as const, note: staff.name }];
    await db.doc(`${baseOf(ownerUid, buildingId)}/work_orders/${order.id}`).update({
        status: 'assigned', assigned_staff_id: staff.id, assigned_staff_name: staff.name, assigned_at: now,
        staff_token_hash: sha256(secret), updated_at: now, events,
    });
    const link = makeLink(ownerUid, buildingId, order.id, secret);
    const result = await notify({
        event: 'work_order.assigned', ownerUid, buildingId, lineUserId: staff.line_user_id ?? undefined, url: link,
        data: {
            area: order.area, work_type_label: WORK_TYPE_LABELS_TH[order.work_type], priority: order.priority,
            due_date: order.due_date, description: order.description,
        },
    });
    return { link, notify: result };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const body = (req.body ?? {}) as Body;
    const action = body.action;

    // ══ Staff actions: authenticated by the personal link, not by a HorCare account ══
    if (action === 'staff_view' || action === 'staff_images' || action === 'staff_update') {
        await handleStaff(req, res, body);
        return;
    }

    // ══ Manager actions ══
    const buildingId = body.building_id;
    if (!buildingId || typeof buildingId !== 'string') { res.status(400).json({ error: 'building_id is required' }); return; }

    const needs =
        action === 'verify' || action === 'reopen' ? 'work_order.verify' as const
        : action === 'create' || action === 'assign' || action === 'resend_link'
            || action === 'staff_create' || action === 'staff_update_info' || action === 'staff_link_code' || action === 'staff_unlink'
            ? 'work_order.create' as const
        : null;
    if (!needs) { res.status(400).json({ error: 'unknown_action' }); return; }

    const ctx = await authorize(req, res, { ownerUid: body.owner_uid, buildingId, permission: needs });
    if (!ctx) return;
    if (!(await buildingExists(ctx.ownerUid, buildingId))) { res.status(404).json({ error: 'property_not_found' }); return; }
    const b = baseOf(ctx.ownerUid, buildingId);
    const audit = (a: Parameters<typeof writeAudit>[0]['action'], type: 'work_order' | 'staff', id: string, label: string, extra: object = {}) =>
        writeAudit({
            ownerUid: ctx.ownerUid, propertyId: buildingId, userId: ctx.uid, userName: ctx.displayName, role: ctx.role,
            action: a, resourceType: type, resourceId: id, resourceLabel: label, req, ...extra,
        });

    // ── Staff directory ──────────────────────────────────────────────────────
    if (action === 'staff_create') {
        const name = text(body.name, 80);
        const phone = text(body.phone, 20);
        if (!name || phone === undefined || (body.role !== 'technician' && body.role !== 'housekeeping')) {
            res.status(400).json({ error: 'invalid_input' });
            return;
        }
        const id = randomUUID();
        const staff: WorkStaff = {
            id, name, phone, role: body.role as StaffRole, active: true,
            line_user_id: null, linked_at: null, created_at: new Date().toISOString(),
        };
        await db.doc(`${b}/staff/${id}`).set(staff);
        await audit('CREATE', 'staff', id, name, { after: { role: staff.role } });
        res.status(200).json({ staff });
        return;
    }

    if (action === 'staff_update_info' || action === 'staff_link_code' || action === 'staff_unlink') {
        if (!body.staff_id || typeof body.staff_id !== 'string') { res.status(400).json({ error: 'staff_id is required' }); return; }
        const ref = db.doc(`${b}/staff/${body.staff_id}`);
        const snap = await ref.get();
        if (!snap.exists) { res.status(404).json({ error: 'not_found' }); return; }
        const staff = snap.data() as WorkStaff;

        if (action === 'staff_update_info') {
            const updates: Partial<WorkStaff> = {};
            if (body.name !== undefined) { const n = text(body.name, 80); if (!n) { res.status(400).json({ error: 'invalid_input' }); return; } updates.name = n; }
            if (body.phone !== undefined) { const p = text(body.phone, 20); if (p === undefined) { res.status(400).json({ error: 'invalid_input' }); return; } updates.phone = p; }
            if (body.active !== undefined) { if (typeof body.active !== 'boolean') { res.status(400).json({ error: 'invalid_input' }); return; } updates.active = body.active; }
            if (Object.keys(updates).length === 0) { res.status(400).json({ error: 'nothing_to_update' }); return; }
            await ref.update(updates);
            await audit('UPDATE', 'staff', staff.id, staff.name, { before: { active: staff.active }, after: updates });
            res.status(200).json({ ok: true });
            return;
        }

        if (action === 'staff_unlink') {
            await ref.update({ line_user_id: null, linked_at: null });
            await audit('UPDATE', 'staff', staff.id, staff.name, { note: 'LINE unlinked' });
            res.status(200).json({ ok: true });
            return;
        }

        // staff_link_code — the staff member sends this to the LINE OA to connect their account
        if (!staff.active) { res.status(409).json({ error: 'staff_inactive' }); return; }
        let code = 'HCS-';
        for (let i = 0; i < 8; i++) code += LINK_ALPHABET[randomInt(LINK_ALPHABET.length)];
        await db.collection('staff_links').doc(sha256(code)).set({
            owner_uid: ctx.ownerUid, building_id: buildingId, staff_id: staff.id,
            created_by: ctx.uid, created_at: new Date().toISOString(), expires_at: Date.now() + LINK_TTL_MS,
        });
        await audit('CREATE', 'staff', staff.id, staff.name, { note: 'LINE link code issued' });
        res.status(200).json({ code, expires_at: Date.now() + LINK_TTL_MS });
        return;
    }

    // ── Work orders ──────────────────────────────────────────────────────────
    if (action === 'create') {
        const description = text(body.description, 1000);
        const dueDate = body.due_date === undefined || body.due_date === '' ? null : body.due_date;
        if (!description || !isWorkType(body.work_type) || !isPriority(body.priority ?? 'normal')
            || (dueDate !== null && !validDate(dueDate))) {
            res.status(400).json({ error: 'invalid_input' });
            return;
        }

        // Room job → area is the room's number; otherwise a free-text common area.
        let roomId: string | null = null;
        let area: string | null | undefined;
        if (body.room_id) {
            if (typeof body.room_id !== 'string') { res.status(400).json({ error: 'invalid_input' }); return; }
            const room = await db.doc(`${b}/rooms/${body.room_id}`).get();
            if (!room.exists || room.data()?.is_active === false) { res.status(404).json({ error: 'room_not_found' }); return; }
            roomId = body.room_id;
            area = `ห้อง ${room.data()!.room_number}`;
        } else {
            area = text(body.area, 60);
            if (!area) { res.status(400).json({ error: 'invalid_input', message: 'ระบุห้องหรือพื้นที่' }); return; }
        }

        const images: string[] = Array.isArray(body.images) ? body.images as string[] : [];
        if (!Array.isArray(body.images ?? []) || images.length > 3 || !images.every(validImage)) {
            res.status(400).json({ error: 'invalid_image' });
            return;
        }

        let staff: WorkStaff | null = null;
        if (body.assign_staff_id) {
            const s = await db.doc(`${b}/staff/${body.assign_staff_id}`).get();
            if (!s.exists || s.data()?.active === false) { res.status(404).json({ error: 'staff_not_found' }); return; }
            staff = s.data() as WorkStaff;
        }

        const id = randomUUID();
        const now = new Date().toISOString();
        const order: WorkOrder = {
            id, organization_id: ctx.ownerUid, property_id: buildingId, room_id: roomId, area,
            work_type: body.work_type, description, priority: (body.priority ?? 'normal') as WorkOrder['priority'],
            due_date: dueDate, status: 'created', assigned_staff_id: null, assigned_staff_name: null, assigned_at: null,
            staff_token_hash: null, image_count: images.length, completion_note: null, reopen_note: null,
            events: [{ at: now, by: ctx.displayName, type: 'created' }],
            created_by: ctx.uid, created_by_name: ctx.displayName, created_at: now, updated_at: now,
            completed_at: null, closed_at: null, closed_by_name: null,
        };
        await db.doc(`${b}/work_orders/${id}`).set(order);
        for (const img of images) {
            const imgId = randomUUID();
            await db.doc(`${b}/work_order_images/${imgId}`).set({
                id: imgId, work_order_id: id, kind: 'issue', data_url: `data:image/jpeg;base64,${img}`, created_at: now, by: ctx.displayName,
            });
        }
        await audit('CREATE', 'work_order', id, `${area} · ${order.work_type}`, { after: { priority: order.priority, due_date: dueDate } });

        let link: string | null = null;
        let notifyResult: NotifyResult | null = null;
        if (staff) {
            const r = await assign(ctx.ownerUid, buildingId, order, staff, ctx.displayName);
            link = r.link; notifyResult = r.notify;
            order.status = 'assigned';
            await audit('UPDATE', 'work_order', id, `${area}`, { before: { status: 'created' }, after: { status: 'assigned', staff: staff.name } });
        }
        res.status(200).json({ work_order: { ...order, staff_token_hash: undefined }, link, notify: notifyResult?.channels ?? null });
        return;
    }

    // everything below targets one existing order
    if (!body.work_order_id || typeof body.work_order_id !== 'string') { res.status(400).json({ error: 'work_order_id is required' }); return; }
    const ref = db.doc(`${b}/work_orders/${body.work_order_id}`);
    const snap = await ref.get();
    if (!snap.exists) { res.status(404).json({ error: 'not_found' }); return; }
    const order = snap.data() as WorkOrder;

    if (action === 'assign' || action === 'resend_link') {
        const staffId = action === 'resend_link' ? order.assigned_staff_id : body.staff_id;
        if (!staffId || typeof staffId !== 'string') { res.status(400).json({ error: 'staff_id is required' }); return; }
        if (action === 'assign' && !canTransition('manager', order.status, 'assigned')) {
            res.status(409).json({ error: 'invalid_transition', message: 'มอบหมายงานในสถานะนี้ไม่ได้' });
            return;
        }
        if (action === 'resend_link' && (order.status === 'closed' || order.status === 'completed')) {
            res.status(409).json({ error: 'invalid_transition' });
            return;
        }
        const s = await db.doc(`${b}/staff/${staffId}`).get();
        if (!s.exists || s.data()?.active === false) { res.status(404).json({ error: 'staff_not_found' }); return; }
        const staff = s.data() as WorkStaff;
        const r = await assign(ctx.ownerUid, buildingId, order, staff, ctx.displayName);
        await audit('UPDATE', 'work_order', order.id, order.area, {
            before: { status: order.status, staff: order.assigned_staff_name }, after: { status: 'assigned', staff: staff.name },
            note: action === 'resend_link' ? 'link re-issued' : undefined,
        });
        res.status(200).json({ link: r.link, notify: r.notify.channels });
        return;
    }

    // verify / reopen
    const note = text(body.note, 500);
    if (note === undefined) { res.status(400).json({ error: 'invalid_input' }); return; }
    const to: WorkStatus = action === 'verify' ? 'closed' : 'in_progress';
    if (!canTransition('manager', order.status, to)) {
        res.status(409).json({ error: 'invalid_transition', message: 'ปิดงานหรือเปิดงานใหม่ได้เฉพาะงานที่ทำเสร็จแล้ว' });
        return;
    }
    if (action === 'reopen' && !note) { res.status(400).json({ error: 'note_required', message: 'ระบุเหตุผลที่ส่งกลับแก้ไข' }); return; }
    const now = new Date().toISOString();
    const events = [...order.events, { at: now, by: ctx.displayName, type: 'status' as const, status: to, note: note ?? undefined }];
    const updates: Partial<WorkOrder> = action === 'verify'
        ? { status: 'closed', closed_at: now, closed_by_name: ctx.displayName, updated_at: now, events }
        : { status: 'in_progress', reopen_note: note, completed_at: null, updated_at: now, events };
    await ref.update(updates);
    await audit('UPDATE', 'work_order', order.id, order.area, { before: { status: order.status }, after: { status: to }, note: note ?? undefined });
    res.status(200).json({ ok: true });
}

// ── Staff (link) handlers ───────────────────────────────────────────────────────
async function handleStaff(req: VercelRequest, res: VercelResponse, body: Body) {
    const link = parseLink(body.link);
    if (!link) { res.status(400).json({ error: 'invalid_link' }); return; }
    const b = baseOf(link.ownerUid, link.buildingId);
    const ref = db.doc(`${b}/work_orders/${link.workOrderId}`);
    const snap = await ref.get();
    const order = snap.exists ? (snap.data() as WorkOrder) : null;
    // One response for "no such job" and "wrong secret" so job ids can't be probed.
    if (!order || !order.staff_token_hash || !safeEqualHex(order.staff_token_hash, sha256(link.secret)) || order.status === 'closed') {
        res.status(404).json({ error: 'not_found' });
        return;
    }
    const staffSnap = await db.doc(`${b}/staff/${order.assigned_staff_id}`).get();
    const staff = staffSnap.data() as WorkStaff | undefined;
    if (!staff || staff.active === false) { res.status(404).json({ error: 'not_found' }); return; }

    if (body.action === 'staff_view') {
        const cfg = await db.doc(`${b}/data/config`).get();
        const view: StaffWorkView = {
            id: order.id, area: order.area, work_type: order.work_type, description: order.description,
            priority: order.priority, due_date: order.due_date, status: order.status, staff_name: staff.name,
            dorm_name: cfg.data()?.bill_customization?.dorm_name || '', completion_note: order.completion_note,
            reopen_note: order.reopen_note, image_count: order.image_count,
        };
        res.status(200).json({ work_order: view });
        return;
    }

    if (body.action === 'staff_images') {
        const imgs = await db.collection(`${b}/work_order_images`).where('work_order_id', '==', order.id).get();
        res.status(200).json({
            images: imgs.docs.map(d => d.data()).sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)))
                .map(d => ({ id: d.id, kind: d.kind, data_url: d.data_url })),
        });
        return;
    }

    // staff_update — only while the job is open for the staff member
    if (order.status === 'completed') { res.status(409).json({ error: 'already_completed' }); return; }
    const note = text(body.note, 500);
    if (note === undefined) { res.status(400).json({ error: 'invalid_input' }); return; }

    const incoming = Array.isArray(body.images) ? body.images as { kind?: unknown; base64?: unknown }[] : [];
    if (body.images !== undefined && !Array.isArray(body.images)) { res.status(400).json({ error: 'invalid_image' }); return; }
    const kinds: WorkImageKind[] = ['before', 'after'];
    if (!incoming.every(i => i && kinds.includes(i.kind as WorkImageKind) && validImage(i.base64))) {
        res.status(400).json({ error: 'invalid_image' });
        return;
    }
    if (order.image_count + incoming.length > MAX_WORK_IMAGES) {
        res.status(409).json({ error: 'too_many_images', message: `แนบรูปได้สูงสุด ${MAX_WORK_IMAGES} รูปต่อใบงาน` });
        return;
    }

    let to: WorkStatus | null = null;
    if (body.status !== undefined) {
        if (body.status !== 'accepted' && body.status !== 'in_progress' && body.status !== 'completed') { res.status(400).json({ error: 'invalid_status' }); return; }
        to = body.status;
        if (!canTransition('staff', order.status, to)) {
            res.status(409).json({ error: 'invalid_transition', message: 'ทำขั้นตอนนี้ไม่ได้ในสถานะปัจจุบัน' });
            return;
        }
    }
    if (to === null && note === null && incoming.length === 0) { res.status(400).json({ error: 'nothing_to_update' }); return; }

    const now = new Date().toISOString();
    const who = `staff:${staff.name}`;
    const events = [...order.events];
    if (to) events.push({ at: now, by: who, type: 'status', status: to, note: note ?? undefined });
    else if (note) events.push({ at: now, by: who, type: 'note', note });
    const updates: Partial<WorkOrder> = {
        events, updated_at: now, image_count: order.image_count + incoming.length,
        ...(to ? { status: to } : {}),
        ...(to === 'completed' ? { completed_at: now, completion_note: note, reopen_note: null } : {}),
    };
    for (const i of incoming) {
        const imgId = randomUUID();
        await db.doc(`${b}/work_order_images/${imgId}`).set({
            id: imgId, work_order_id: order.id, kind: i.kind, data_url: `data:image/jpeg;base64,${i.base64 as string}`, created_at: now, by: who,
        });
    }
    await ref.update(updates);
    await writeAudit({
        ownerUid: link.ownerUid, propertyId: link.buildingId, userId: `staff:${staff.id}`, userName: staff.name, role: staff.role,
        action: 'UPDATE', resourceType: 'work_order', resourceId: order.id, resourceLabel: order.area,
        before: { status: order.status }, after: { status: to ?? order.status, images_added: incoming.length },
        note: note ?? undefined, req,
    });
    res.status(200).json({ ok: true, status: to ?? order.status });
}
