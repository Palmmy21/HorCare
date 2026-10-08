/**
 * /api/announcements — notices from the property to all of its tenants.
 *
 * create   – publishes (and, if asked, pushes to every tenant linked to LINE in THIS property)
 * update   – edit, pin/unpin, archive
 * tenant_list – portal read: published, unexpired notices; no login, like parcels/bank-accounts
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import { db } from './_firebase.js';
import { authorize, buildingExists } from './_rbac.js';
import { writeAudit } from './_audit.js';
import { linePush, runPooled } from './_line.js';
import {
    announcementLineText, cleanAnnouncementInput, visibleAnnouncements,
    type Announcement, type TenantAnnouncementView,
} from '../src/shared/chatbot.js';

export const config = { maxDuration: 60 };

const PUSH_CONCURRENCY = 5;

interface Body {
    action?: 'create' | 'update' | 'tenant_list';
    owner_uid?: string;
    building_id?: string;
    room_id?: string;
    announcement_id?: string;
    title?: unknown;
    body?: unknown;
    pinned?: unknown;
    expires_at?: unknown;
    send_line?: unknown;
    status?: unknown;
}

const colOf = (owner: string, bld: string) => `users/${owner}/buildings/${bld}/announcements`;

const toView = (a: Announcement): TenantAnnouncementView => ({ id: a.id, title: a.title, body: a.body, pinned: a.pinned, created_at: a.created_at });

/** Chat reply for the "ประกาศ" command: the latest few notices, or null when there are none. */
export async function latestAnnouncementsText(link: { uid: string; building_id: string }): Promise<string | null> {
    const snap = await db.collection(colOf(link.uid, link.building_id)).get();
    const list = visibleAnnouncements(snap.docs.map(d => d.data() as Announcement)).slice(0, 3);
    if (list.length === 0) return null;
    return '📢 ประกาศล่าสุด\n\n' + list.map(a => `• ${a.title}\n${a.body}`).join('\n\n');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const body = (req.body ?? {}) as Body;
    const buildingId = body.building_id;
    if (!buildingId || typeof buildingId !== 'string') { res.status(400).json({ error: 'building_id is required' }); return; }
    if (body.action !== 'create' && body.action !== 'update' && body.action !== 'tenant_list') { res.status(400).json({ error: 'unknown_action' }); return; }

    if (body.action === 'tenant_list') {
        const owner = body.owner_uid;
        if (typeof owner !== 'string' || !owner || typeof body.room_id !== 'string' || !body.room_id) { res.status(400).json({ error: 'invalid_input' }); return; }
        const base = `users/${owner}/buildings/${buildingId}`;
        if (!(await db.doc(`${base}/rooms/${body.room_id}`).get()).exists) { res.status(404).json({ error: 'not_found' }); return; }
        const snap = await db.collection(colOf(owner, buildingId)).get();
        res.status(200).json({ announcements: visibleAnnouncements(snap.docs.map(d => d.data() as Announcement)).slice(0, 20).map(toView) });
        return;
    }

    const ctx = await authorize(req, res, { ownerUid: body.owner_uid, buildingId, permission: 'announcement.manage' });
    if (!ctx) return;
    if (!(await buildingExists(ctx.ownerUid, buildingId))) { res.status(404).json({ error: 'property_not_found' }); return; }

    const col = colOf(ctx.ownerUid, buildingId);
    const audit = (action: 'CREATE' | 'UPDATE', a: Pick<Announcement, 'id' | 'title'>, extra: object = {}) => writeAudit({
        ownerUid: ctx.ownerUid, propertyId: buildingId, userId: ctx.uid, userName: ctx.displayName, role: ctx.role,
        action, resourceType: 'announcement', resourceId: a.id, resourceLabel: a.title, req, ...extra,
    });
    const now = new Date().toISOString();

    if (body.action === 'create') {
        const input = cleanAnnouncementInput(body);
        if (!input || (body.send_line !== undefined && typeof body.send_line !== 'boolean')) { res.status(400).json({ error: 'invalid_input' }); return; }
        if (input.expires_at && Date.parse(input.expires_at) <= Date.now()) { res.status(400).json({ error: 'invalid_input' }); return; }
        const ann: Announcement = {
            id: randomUUID(), ...input, status: 'published', line_sent: 0, line_failed: 0,
            created_at: now, created_by: ctx.displayName, updated_at: now,
        };
        if (body.send_line === true) {
            if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) { res.status(503).json({ error: 'line_not_configured', message: 'ยังไม่ได้ตั้งค่า LINE บนเซิร์ฟเวอร์' }); return; }
            // Only tenants linked to THIS property (line_rooms carries owner + building).
            const links = await db.collection('line_rooms').where('uid', '==', ctx.ownerUid).where('building_id', '==', buildingId).get();
            const ids = [...new Set(links.docs.map(d => d.id))];
            const dorm = ((await db.doc(`users/${ctx.ownerUid}/buildings/${buildingId}/data/config`).get()).data()?.bill_customization?.dorm_name as string | undefined) || 'หอพัก';
            const text = announcementLineText(ann, dorm);
            await runPooled(ids, PUSH_CONCURRENCY, async lineUserId => {
                try { await linePush(lineUserId, [{ type: 'text', text }]); ann.line_sent++; } catch { ann.line_failed++; }
            });
        }
        await db.doc(`${col}/${ann.id}`).set(ann);
        await audit('CREATE', ann, { note: `LINE sent ${ann.line_sent}, failed ${ann.line_failed}` });
        res.status(200).json({ announcement: ann });
        return;
    }

    // update
    if (!body.announcement_id || typeof body.announcement_id !== 'string') { res.status(400).json({ error: 'announcement_id is required' }); return; }
    const ref = db.doc(`${col}/${body.announcement_id}`);
    const snap = await ref.get();
    if (!snap.exists) { res.status(404).json({ error: 'not_found' }); return; }
    const current = snap.data() as Announcement;
    if (body.status !== undefined && body.status !== 'published' && body.status !== 'archived') { res.status(400).json({ error: 'invalid_input' }); return; }
    const input = cleanAnnouncementInput({
        title: body.title ?? current.title, body: body.body ?? current.body,
        pinned: body.pinned ?? current.pinned, expires_at: body.expires_at === undefined ? current.expires_at : body.expires_at,
    });
    if (!input) { res.status(400).json({ error: 'invalid_input' }); return; }
    const status = (body.status as Announcement['status'] | undefined) ?? current.status;
    await ref.update({ ...input, status, updated_at: now });
    await audit('UPDATE', current, { before: { status: current.status, pinned: current.pinned }, after: { status, pinned: input.pinned } });
    res.status(200).json({ ok: true });
}
