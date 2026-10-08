/**
 * LINE inbox — lets a property talk to its tenants over the tenant LINE OA from inside HorCare.
 *
 *  • recordInbound(): called by /api/line-webhook for free-text messages from REGISTERED
 *    tenants. The tenant's line_rooms entry says which owner/property/room they belong to,
 *    so a message can only ever land in that tenant's own property.
 *  • handler (/api/line-inbox): signed-in staff send replies (push) and mark threads read.
 *    Every call goes through authorize() with the property check.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import { db } from './_firebase.js';
import { authorize } from './_rbac.js';
import { writeAudit } from './_audit.js';
import { linePush } from './_line.js';
import {
    MAX_INCOMING_CHARS, MAX_OUTGOING_CHARS,
    type LineMessage, type LineThread, type MessageKind,
} from '../src/shared/messages.js';

export const config = { maxDuration: 15 };

/** Don't re-send the automatic acknowledgement more often than this. */
export const ACK_EVERY_MS = 6 * 3600 * 1000;

const threadPath = (owner: string, bld: string, lid: string) => `users/${owner}/buildings/${bld}/line_threads/${lid}`;

export interface RecordResult {
    recorded: boolean;
    /** Send the tenant a one-off "received" reply (throttled). */
    shouldAck: boolean;
}

export async function recordInbound(lineUserId: string, input: { kind: MessageKind; text: string }): Promise<RecordResult> {
    const link = await db.collection('line_rooms').doc(lineUserId).get();
    if (!link.exists) return { recorded: false, shouldAck: false };
    const { uid, building_id, room_id, room_number } = link.data() as {
        uid: string; building_id: string; room_id: string; room_number: string;
    };

    const text = input.text.trim().slice(0, MAX_INCOMING_CHARS);
    if (!text) return { recorded: false, shouldAck: false };

    const profile = await db.doc(`users/${uid}/buildings/${building_id}/tenants/${room_id}`).get();
    const tenantName = (profile.data()?.full_name as string | undefined) ?? null;

    const ref = db.doc(threadPath(uid, building_id, lineUserId));
    const now = new Date();
    const nowIso = now.toISOString();
    const msg: LineMessage = { id: randomUUID(), direction: 'in', kind: input.kind, text, at: nowIso, by: null };

    // One transaction so two quick messages can't lose an unread increment.
    const shouldAck = await db.runTransaction<boolean>(async tx => {
        const snap = await tx.get(ref);
        const prev = snap.exists ? (snap.data() as LineThread) : null;
        const ack = !prev?.last_ack_at || now.getTime() - Date.parse(prev.last_ack_at) > ACK_EVERY_MS;
        const thread: LineThread = {
            line_user_id: lineUserId, room_id, room_number, tenant_name: tenantName,
            last_message_text: text.slice(0, 200), last_message_at: nowIso, last_direction: 'in',
            unread_count: (prev?.unread_count ?? 0) + 1,
            last_ack_at: ack ? nowIso : (prev?.last_ack_at ?? null),
        };
        tx.set(ref, thread);
        tx.set(db.doc(`${ref.path}/messages/${msg.id}`), msg);
        return ack;
    });
    return { recorded: true, shouldAck };
}

interface Body {
    action?: 'send' | 'mark_read';
    owner_uid?: string;
    building_id?: string;
    line_user_id?: string;
    text?: string;
}

const LINE_ID_RE = /^U[0-9a-f]{32}$/;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const body = (req.body ?? {}) as Body;
    const buildingId = body.building_id;
    if (!buildingId || typeof buildingId !== 'string') { res.status(400).json({ error: 'building_id is required' }); return; }
    if (body.action !== 'send' && body.action !== 'mark_read') { res.status(400).json({ error: 'unknown_action' }); return; }
    if (typeof body.line_user_id !== 'string' || !LINE_ID_RE.test(body.line_user_id)) { res.status(400).json({ error: 'invalid_input' }); return; }

    const ctx = await authorize(req, res, {
        ownerUid: body.owner_uid, buildingId, permission: body.action === 'send' ? 'message.send' : 'message.read',
    });
    if (!ctx) return;

    // The thread lives under this property's path, so another property's thread can't be reached.
    const ref = db.doc(threadPath(ctx.ownerUid, buildingId, body.line_user_id));
    const snap = await ref.get();
    if (!snap.exists) { res.status(404).json({ error: 'not_found' }); return; }
    const thread = snap.data() as LineThread;

    if (body.action === 'mark_read') {
        if (thread.unread_count > 0) await ref.update({ unread_count: 0 });
        res.status(200).json({ ok: true });
        return;
    }

    // ── send ──
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text || text.length > MAX_OUTGOING_CHARS) { res.status(400).json({ error: 'invalid_input' }); return; }

    // The tenant may have moved out / been re-registered since the thread started.
    const room = await db.doc(`users/${ctx.ownerUid}/buildings/${buildingId}/rooms/${thread.room_id}`).get();
    if (!room.exists || room.data()?.line_user_id !== body.line_user_id) {
        res.status(409).json({ error: 'tenant_unlinked', message: 'ผู้เช่าคนนี้ไม่ได้เชื่อม LINE กับห้องนี้แล้ว จึงส่งข้อความไม่ได้' });
        return;
    }
    if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) {
        res.status(503).json({ error: 'line_not_configured', message: 'ยังไม่ได้ตั้งค่า LINE บนเซิร์ฟเวอร์' });
        return;
    }

    try {
        await linePush(body.line_user_id, [{ type: 'text', text }]);
    } catch (err) {
        console.error('[line-inbox] push failed:', (err as Error).message);
        res.status(502).json({ error: 'send_failed', message: 'ส่งข้อความทาง LINE ไม่สำเร็จ กรุณาลองใหม่' });
        return;
    }

    const now = new Date().toISOString();
    const msg: LineMessage = { id: randomUUID(), direction: 'out', kind: 'text', text, at: now, by: ctx.displayName };
    await db.doc(`${ref.path}/messages/${msg.id}`).set(msg);
    await ref.update({ last_message_text: text.slice(0, 200), last_message_at: now, last_direction: 'out', unread_count: 0 });
    // Log that a message was sent and to whom — not its content.
    await writeAudit({
        ownerUid: ctx.ownerUid, propertyId: buildingId, userId: ctx.uid, userName: ctx.displayName, role: ctx.role,
        action: 'CREATE', resourceType: 'message', resourceId: msg.id, resourceLabel: `Room ${thread.room_number}`,
        note: `LINE message (${text.length} chars)`, req,
    });
    res.status(200).json({ message: msg });
}
