/**
 * Staff portal — one page where a technician or housekeeper sees every job assigned to them, at every property
 * they work for. Identity is their LINE account; there is no password. See docs/STAFF_LINE_ARCHITECTURE.md.
 *
 *   1. The person links LINE to their staff record(s) (HCS- code from the manager, or HCR- self-registration).
 *   2. In the team LINE OA they send "งานของฉัน" (or tap the rich-menu button): the webhook issues a portal token
 *      (30 days, stored as a hash) and replies with /?sp=<token>.
 *   3. The portal calls this route with the token. Every call re-reads who the token belongs to and which staff
 *      records carry that LINE id, so unlinking or deactivating someone closes their portal at once.
 *
 * /api/staff-portal (public, token-authenticated): overview | cleaning_update
 * Work-order actions from the portal go to /api/work-orders with { portal, job } in place of the per-job link.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash, randomBytes } from 'node:crypto';
import { db } from './_firebase.js';
import { appBaseUrl } from './_notify.js';
import { rateLimit } from './_abuse-guard.js';
import type { WorkOrder, WorkStaff } from '../src/shared/workOrders.js';
import { CLOSED_CLEANING, OPEN_WORK, phoneKey, type PortalCleaningJob, type PortalOverview, type PortalWorkJob } from '../src/shared/staffPortal.js';

export const config = { maxDuration: 30 };

const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Issue a portal link for a LINE user (called by the team-OA webhook). Null when they are not linked anywhere. */
export async function issuePortalLink(lineUserId: string): Promise<string | null> {
    if ((await linkedStaff(lineUserId)).length === 0) return null;
    const token = randomBytes(24).toString('base64url');
    await db.doc(`staff_portal_tokens/${sha256(token)}`).set({
        line_user_id: lineUserId, created_at: new Date().toISOString(), expires_at: Date.now() + TOKEN_TTL_MS,
    });
    return `${appBaseUrl()}/?sp=${token}`;
}

/** The LINE user a portal token belongs to, or null (unknown, malformed or expired). */
export async function resolvePortalToken(token: unknown): Promise<string | null> {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
    const t = (await db.doc(`staff_portal_tokens/${sha256(token)}`).get()).data() as { line_user_id?: string; expires_at?: number } | undefined;
    if (!t?.line_user_id || !t.expires_at || t.expires_at <= Date.now()) return null;
    return t.line_user_id;
}

export interface LinkedStaff { ownerUid: string; buildingId: string; staff: WorkStaff }

/** Every active staff record (any owner, any property) that carries this LINE id. */
export async function linkedStaff(lineUserId: string): Promise<LinkedStaff[]> {
    const snap = await db.collectionGroup('staff').where('line_user_id', '==', lineUserId).get();
    const out: LinkedStaff[] = [];
    for (const d of snap.docs) {
        const parts = d.ref.path.split('/'); // users/{owner}/buildings/{bld}/staff/{id}
        if (parts.length !== 6 || parts[0] !== 'users' || parts[2] !== 'buildings') continue;
        const staff = { ...(d.data() as WorkStaff), id: d.id };
        if (staff.active === false) continue;
        out.push({ ownerUid: parts[1], buildingId: parts[3], staff });
    }
    return out;
}

/** 'owner~building~id' — how the portal names a job; the server re-checks it belongs to the caller. */
export function parseJobKey(v: unknown): { ownerUid: string; buildingId: string; id: string } | null {
    if (typeof v !== 'string' || v.length > 300) return null;
    const p = v.split('~');
    return p.length === 3 && p.every(x => x && !x.includes('/')) ? { ownerUid: p[0], buildingId: p[1], id: p[2] } : null;
}

const jobKey = (ownerUid: string, buildingId: string, id: string) => `${ownerUid}~${buildingId}~${id}`;

async function overview(lineUserId: string): Promise<PortalOverview> {
    const records = await linkedStaff(lineUserId);
    const work: PortalWorkJob[] = [];
    const cleaning: PortalCleaningJob[] = [];
    const names = new Map<string, string>();
    for (const { ownerUid, buildingId, staff } of records) {
        const base = `users/${ownerUid}/buildings/${buildingId}`;
        const cfg = (await db.doc(`${base}/data/config`).get()).data();
        const dorm = cfg?.bill_customization?.dorm_name || 'อาคาร';
        names.set(staff.name, staff.name);

        const orders = await db.collection(`${base}/work_orders`).where('assigned_staff_id', '==', staff.id).get();
        for (const d of orders.docs) {
            const o = d.data() as WorkOrder;
            if (!OPEN_WORK.includes(o.status)) continue;
            work.push({
                key: jobKey(ownerUid, buildingId, d.id), dorm_name: dorm, area: o.area, work_type: o.work_type, description: o.description,
                priority: o.priority, due_date: o.due_date, status: o.status, reopen_note: o.reopen_note,
            });
        }

        // housekeeping requests are assigned to the property's housekeeper accounts: matched by phone number
        if (staff.role === 'housekeeping' && staff.phone) {
            const mine = phoneKey(staff.phone);
            const maids = (await db.collection(`${base}/housekeepers`).get()).docs
                .filter(m => m.data().is_active !== false && phoneKey(String(m.data().phone ?? '')) === mine).map(m => m.id);
            for (const maidId of maids) {
                const reqs = await db.collection(`${base}/cleaning`).where('assigned_maid_id', '==', maidId).get();
                for (const d of reqs.docs) {
                    const r = d.data();
                    if (CLOSED_CLEANING.includes(r.status)) continue;
                    cleaning.push({
                        key: jobKey(ownerUid, buildingId, d.id), dorm_name: dorm, room_number: String(r.room_number ?? ''),
                        service_type: String(r.service_type ?? 'general'), description: r.description ?? null,
                        preferred_date: r.preferred_date ?? null, preferred_time_slot: r.preferred_time_slot ?? null,
                        status: r.status, urgent: r.urgency === 'urgent',
                    });
                }
            }
        }
    }
    return { name: [...names.keys()][0] ?? '', properties: records.length, work, cleaning };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return; }
    const body = (req.body ?? {}) as { action?: string; token?: unknown; job?: unknown; status?: unknown; note?: unknown };
    const limited = await rateLimit(req, `staff-portal:${body.action ?? ''}`, 240, 3600);
    if (!limited.ok) { res.status(429).json({ error: 'too_many_requests' }); return; }

    const lineUserId = await resolvePortalToken(body.token);
    if (!lineUserId) { res.status(401).json({ error: 'invalid_link' }); return; }

    if (body.action === 'overview') {
        const view = await overview(lineUserId);
        if (view.properties === 0) { res.status(401).json({ error: 'not_linked' }); return; }
        res.status(200).json(view);
        return;
    }

    if (body.action === 'cleaning_update') {
        const job = parseJobKey(body.job);
        const to = body.status;
        if (!job || (to !== 'in_progress' && to !== 'completed')) { res.status(400).json({ error: 'invalid_input' }); return; }
        const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
        // the request must be assigned to a housekeeper account with this person's phone, at a property they work for
        const mine = (await linkedStaff(lineUserId)).filter(s => s.ownerUid === job.ownerUid && s.buildingId === job.buildingId && s.staff.role === 'housekeeping' && s.staff.phone);
        const base = `users/${job.ownerUid}/buildings/${job.buildingId}`;
        const ref = db.doc(`${base}/cleaning/${job.id}`);
        const r = (await ref.get()).data();
        const maid = r?.assigned_maid_id ? (await db.doc(`${base}/housekeepers/${r.assigned_maid_id}`).get()).data() : undefined;
        const owns = !!maid && mine.some(s => phoneKey(s.staff.phone!) === phoneKey(String(maid.phone ?? '')));
        if (!r || !owns || CLOSED_CLEANING.includes(r.status)) { res.status(404).json({ error: 'not_found' }); return; }
        const now = new Date().toISOString();
        await ref.update(to === 'in_progress'
            ? { status: 'in_progress', accepted_at: r.accepted_at ?? now, updated_at: now }
            : { status: 'completed', completed_at: now, completed_by: 'maid', ...(note ? { completion_notes: note, completed_note: note } : {}), updated_at: now });
        res.status(200).json({ ok: true });
        return;
    }

    res.status(400).json({ error: 'unknown_action' });
}
