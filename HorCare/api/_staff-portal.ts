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
 *   4. A housekeeper's "จดมิเตอร์" opens the app's meter page: `housekeeper_session` signs them in as the property's housekeeper
 *      account with the same phone (the one Firestore rules already let record meters), creating a passcode-less one
 *      when the manager never made it. Switching the staff record off, unlinking LINE or changing the phone ends it.
 *
 * /api/staff-portal (public, token-authenticated): overview | cleaning_update | housekeeper_session
 * Work-order actions from the portal go to /api/work-orders with { portal, job } in place of the per-job link.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { admin, db } from './_firebase.js';
import { housekeeperUid } from './_housekeepers.js';
import { writeAudit } from './_audit.js';
import { appBaseUrl } from './_notify.js';
import { rateLimit } from './_abuse-guard.js';
import type { WorkOrder, WorkStaff } from '../src/shared/workOrders.js';
import { CLOSED_CLEANING, OPEN_WORK, phoneKey, type PortalCleaningJob, type PortalOverview, type PortalWorkJob } from '../src/shared/staffPortal.js';

export const config = { maxDuration: 30 };

const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000;
/** A compressed photo (900px JPEG) is ~100–250 KB as a data URL; documents must stay well under Firestore's 1 MiB. */
const MAX_PHOTO_CHARS = 700_000;
const IMAGE_DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
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

// ── housekeeper sign-in from LINE (the meter page) ────────────────────────────

const hkCol = (owner: string, bld: string) => `users/${owner}/buildings/${bld}/housekeepers`;
interface HkAccount { id: string; name: string; phone: string; session_version: number }

/**
 * The housekeeper account a housekeeping staff record signs in as: the property's account with the same phone, or a new
 * one made for LINE sign-in only (it has no passcode, so nobody can sign in to it from the login page).
 * Null when the manager switched that account off: LINE is not a way around it.
 */
async function housekeeperAccountFor(s: LinkedStaff): Promise<HkAccount | null> {
    if (s.staff.role !== 'housekeeping' || !s.staff.phone) return null;
    const mine = phoneKey(s.staff.phone);
    const docs = (await db.collection(hkCol(s.ownerUid, s.buildingId)).get()).docs
        .filter(d => phoneKey(String(d.data().phone ?? '')) === mine);
    const now = new Date().toISOString();
    const pick = (d: (typeof docs)[number], version?: number): HkAccount =>
        ({ id: d.id, name: String(d.data().name ?? s.staff.name), phone: String(d.data().phone ?? ''), session_version: version ?? Number(d.data().session_version ?? 0) });

    const active = docs.find(d => d.data().is_active !== false);
    if (active) return pick(active);
    // switched off because the staff record was (endLineHousekeeping); that record is active again, so is this
    const paused = docs.find(d => d.data().via_line === true && d.data().off_by_staff === true);
    if (paused) {
        const version = Number(paused.data().session_version ?? 0) + 1;
        await paused.ref.update({ is_active: true, status: 'active', off_by_staff: false, session_version: version, updated_at: now });
        return pick(paused, version);
    }
    if (docs.length > 0) return null;

    const id = `maid_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const phone = s.staff.phone.replace(/\D/g, '');
    await db.doc(`${hkCol(s.ownerUid, s.buildingId)}/${id}`).set({
        id, name: s.staff.name, phone, notes: 'สร้างอัตโนมัติจากการลงทะเบียนทาง LINE (เข้าใช้ผ่าน LINE เท่านั้น ไม่มีรหัสผ่าน)',
        is_active: true, status: 'active', session_version: 0, needs_passcode: true, via_line: true, staff_id: s.staff.id,
        created_at: now, updated_at: now,
    });
    await writeAudit({
        ownerUid: s.ownerUid, propertyId: s.buildingId, userId: `line:${s.staff.line_user_id ?? ''}`, userName: s.staff.name, role: 'housekeeping',
        action: 'CREATE', resourceType: 'housekeeper', resourceId: id, resourceLabel: s.staff.name, note: 'housekeeper sign-in created from LINE registration',
    });
    return { id, name: s.staff.name, phone, session_version: 0 };
}

/**
 * A housekeeping staff record was switched off, unlinked from LINE, or given another phone: end the housekeeper
 * sessions opened for it, and switch off the account when it was made for LINE sign-in (`disable`).
 */
export async function endLineHousekeeping(ownerUid: string, buildingId: string, staff: Pick<WorkStaff, 'role' | 'phone'>, disable: boolean): Promise<void> {
    if (staff.role !== 'housekeeping' || !staff.phone) return;
    const mine = phoneKey(staff.phone);
    const docs = (await db.collection(hkCol(ownerUid, buildingId)).get()).docs.filter(d => phoneKey(String(d.data().phone ?? '')) === mine);
    for (const d of docs) {
        const off = disable && d.data().via_line === true && d.data().is_active !== false;
        await d.ref.update({
            session_version: Number(d.data().session_version ?? 0) + 1, updated_at: new Date().toISOString(),
            ...(off ? { is_active: false, status: 'off', off_by_staff: true } : {}),
        });
        await admin.auth().revokeRefreshTokens(housekeeperUid(ownerUid, buildingId, d.id)).catch(() => undefined);
    }
}

const dormNameOf = async (ownerUid: string, buildingId: string): Promise<string> =>
    ((await db.doc(`users/${ownerUid}/buildings/${buildingId}/data/config`).get()).data()?.bill_customization?.dorm_name as string | undefined) || 'อาคาร';

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
    return {
        name: [...names.keys()][0] ?? '', properties: records.length, work, cleaning,
        roles: [...new Set(records.map(r => r.staff.role))],
        can_meter: records.some(r => r.staff.role === 'housekeeping' && !!r.staff.phone),
    };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return; }
    const body = (req.body ?? {}) as { action?: string; token?: unknown; job?: unknown; status?: unknown; note?: unknown; place?: unknown; photo?: unknown };
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
        // the "after" photo sent with a finished job (optional)
        const photo = body.photo === undefined || body.photo === null ? null
            : typeof body.photo === 'string' && body.photo.length <= MAX_PHOTO_CHARS && IMAGE_DATA_URL.test(body.photo) ? body.photo : undefined;
        if (photo === undefined || (photo && to !== 'completed')) { res.status(400).json({ error: 'invalid_input' }); return; }
        // the request must be assigned to a housekeeper account with this person's phone, at a property they work for
        const mine = (await linkedStaff(lineUserId)).filter(s => s.ownerUid === job.ownerUid && s.buildingId === job.buildingId && s.staff.role === 'housekeeping' && s.staff.phone);
        const base = `users/${job.ownerUid}/buildings/${job.buildingId}`;
        const ref = db.doc(`${base}/cleaning/${job.id}`);
        const r = (await ref.get()).data();
        const maid = r?.assigned_maid_id ? (await db.doc(`${base}/housekeepers/${r.assigned_maid_id}`).get()).data() : undefined;
        const owns = !!maid && mine.some(s => phoneKey(s.staff.phone!) === phoneKey(String(maid.phone ?? '')));
        if (!r || !owns || CLOSED_CLEANING.includes(r.status)) { res.status(404).json({ error: 'not_found' }); return; }
        const now = new Date().toISOString();
        // kept beside the request, not in it, so listing requests stays light
        if (photo) await db.doc(`${base}/cleaning_images/${job.id}__done`).set({ data: photo, created_at: now });
        await ref.update(to === 'in_progress'
            ? { status: 'in_progress', accepted_at: r.accepted_at ?? now, updated_at: now }
            : {
                status: 'completed', completed_at: now, completed_by: 'maid', updated_at: now,
                ...(note ? { completion_notes: note, completed_note: note } : {}),
                ...(photo ? { completion_has_photo: true } : {}),
            });
        res.status(200).json({ ok: true });
        return;
    }

    if (body.action === 'housekeeper_session') {
        const places = (await linkedStaff(lineUserId)).filter(s => s.staff.role === 'housekeeping' && s.staff.phone);
        if (places.length === 0) { res.status(403).json({ error: 'not_housekeeping' }); return; }
        const keyOf = (s: LinkedStaff) => `${s.ownerUid}~${s.buildingId}`;
        const chosen = places.length === 1 ? places[0] : places.find(s => keyOf(s) === body.place);
        if (!chosen) {
            // works at several properties: the page asks which one
            res.status(200).json({ places: await Promise.all(places.map(async s => ({ key: keyOf(s), name: await dormNameOf(s.ownerUid, s.buildingId) }))) });
            return;
        }
        const account = await housekeeperAccountFor(chosen);
        if (!account) { res.status(403).json({ error: 'account_disabled' }); return; }
        const token = await admin.auth().createCustomToken(housekeeperUid(chosen.ownerUid, chosen.buildingId, account.id), {
            hk_owner: chosen.ownerUid, hk_building: chosen.buildingId, hk_maid: account.id, hk_ver: account.session_version,
        });
        res.status(200).json({
            token,
            session: {
                owner_uid: chosen.ownerUid, building_id: chosen.buildingId, building_name: await dormNameOf(chosen.ownerUid, chosen.buildingId),
                maid_id: account.id, name: account.name, maid_name: account.name, phone: account.phone,
            },
        });
        return;
    }

    res.status(400).json({ error: 'unknown_action' });
}
