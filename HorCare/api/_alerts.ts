/**
 * Alerts for the people who run a property: one call (`raiseAlert`) from wherever something happens, and this module
 * works out who should hear about it and reaches each of them twice —
 *
 *   • `users/{uid}/inbox/{id}`   the app listens to its own inbox, so the alert appears at once, without a reload
 *   • a push to their devices      (FCM, tokens in `users/{uid}/data/fcm`) — arrives with the app closed
 *
 * Who: the owner, and every active member whose role may see that kind of thing at that property
 * (src/shared/alerts.ts). Each person's own switches (`users/{uid}/data/alert_prefs`) are honoured here, on the
 * server, so a kind switched off is never sent — not merely hidden.
 * Technicians and housekeepers without an account are reached on the team LINE OA instead (see `pushToLineStaff`).
 *
 * Never throws: a failed alert must not fail the action behind it.
 *
 * /api/alerts (any signed-in account, about itself): prefs_get | prefs_set | token_save | raise
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import { admin, db } from './_firebase.js';
import { linePush, staffLineToken } from './_line.js';
import { isRole, permissionsForRole, type Permission } from '../src/shared/permissions.js';
import {
    ALERT_INFO, canReceiveAlert, cleanAlertPrefs, wantsAlert, wantsPush, type AlertPrefs, type AlertType, type InboxItem,
} from '../src/shared/alerts.js';
import type { WorkStaff, StaffRole } from '../src/shared/workOrders.js';

export const config = { maxDuration: 20 };

const prefsRef = (uid: string) => db.doc(`users/${uid}/data/alert_prefs`);
const INBOX_KEEP_DAYS = 45;

export interface AlertInput {
    ownerUid: string;
    buildingId: string;
    type: AlertType;
    title: string;
    body: string;
    /** Defaults to the screen for this kind of alert. */
    url?: string;
    kind?: string;
    /** The account that caused it: nobody needs to be told what they just did. */
    exceptUid?: string | null;
}

/** The accounts that may be told about this kind of thing at this property: the owner, then eligible members. */
async function recipientsOf(ownerUid: string, buildingId: string, type: AlertType): Promise<string[]> {
    const out = [ownerUid];
    const members = await db.collection(`users/${ownerUid}/members`).get();
    for (const d of members.docs) {
        const m = d.data() as { status?: string; role?: string; property_ids?: string[] };
        if (m.status !== 'active' || !isRole(m.role)) continue;
        const places = m.property_ids ?? [];
        if (!places.includes('*') && !places.includes(buildingId)) continue;
        // recomputed from the role, never trusted from the stored copy
        if (canReceiveAlert(type, permissionsForRole(m.role))) out.push(d.id);
    }
    return [...new Set(out)];
}

async function pushToDevices(uid: string, item: InboxItem): Promise<number> {
    const ref = db.doc(`users/${uid}/data/fcm`);
    const tokensMap = ((await ref.get()).data()?.tokens ?? {}) as Record<string, { token?: string }>;
    const entries = Object.entries(tokensMap).filter(([, v]) => !!v?.token);
    if (entries.length === 0) return 0;
    const response = await admin.messaging().sendEachForMulticast({
        tokens: entries.map(([, v]) => v.token!),
        notification: { title: item.title, body: item.body },
        data: { url: item.url, type: item.type, id: item.id },
        webpush: {
            notification: {
                icon: '/logo-icon.png', badge: '/logo-icon.png', lang: 'th', tag: item.id,
                vibrate: [200, 100, 200], requireInteraction: false, data: { url: item.url },
            },
            fcmOptions: { link: item.url },
        },
    });
    const stale: Record<string, FirebaseFirestore.FieldValue> = {};
    response.responses.forEach((r, i) => {
        const code = r.error?.code;
        if (!r.success && (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token')) {
            stale[`tokens.${entries[i][0]}`] = admin.firestore.FieldValue.delete();
        }
    });
    if (Object.keys(stale).length > 0) await ref.update(stale).catch(() => undefined);
    return response.successCount;
}

/** Now and then, drop a person's old inbox entries so the inbox stays a recent list, not an archive. */
async function pruneInbox(uid: string): Promise<void> {
    const cutoff = new Date(Date.now() - INBOX_KEEP_DAYS * 86_400_000).toISOString();
    const old = (await db.collection(`users/${uid}/inbox`).get()).docs.filter(d => String(d.data().created_at ?? '') < cutoff);
    await Promise.all(old.slice(0, 200).map(d => d.ref.delete()));
}

export async function raiseAlert(input: AlertInput): Promise<{ recipients: number; pushed: number }> {
    let recipients = 0;
    let pushed = 0;
    try {
        const uids = (await recipientsOf(input.ownerUid, input.buildingId, input.type)).filter(u => u !== input.exceptUid);
        const now = new Date().toISOString();
        await Promise.all(uids.map(async uid => {
            try {
                const prefs = ((await prefsRef(uid).get()).data() ?? {}) as AlertPrefs;
                if (!wantsAlert(prefs, input.type)) return;
                const item: InboxItem = {
                    id: randomUUID(), type: input.type, title: input.title.slice(0, 120), body: input.body.slice(0, 500),
                    url: input.url ?? ALERT_INFO[input.type].url, owner_uid: input.ownerUid, building_id: input.buildingId,
                    created_at: now, ...(input.kind ? { kind: input.kind } : {}),
                };
                await db.doc(`users/${uid}/inbox/${item.id}`).set(item);
                recipients++;
                if (wantsPush(prefs)) pushed += await pushToDevices(uid, item).catch(() => 0);
                if (Math.random() < 0.05) await pruneInbox(uid).catch(() => undefined);
            } catch (err) {
                console.error(`[alerts] ${input.type} → ${uid} failed:`, (err as Error).message);
            }
        }));
    } catch (err) {
        console.error('[alerts] failed:', (err as Error).message);
    }
    return { recipients, pushed };
}

/**
 * Reach the property's technicians or housekeepers on the team LINE OA: everyone of that job who linked LINE.
 * `message` builds each person's own message (their link is personal). Returns how many were sent.
 */
export async function pushToLineStaff(
    ownerUid: string, buildingId: string, role: StaffRole, message: (staff: WorkStaff) => Promise<object | null> | object | null,
): Promise<number> {
    let sent = 0;
    try {
        const token = staffLineToken();
        if (!token) return 0;
        const staff = (await db.collection(`users/${ownerUid}/buildings/${buildingId}/staff`).get()).docs
            .map(d => d.data() as WorkStaff)
            .filter(s => s.role === role && s.active !== false && !!s.line_user_id);
        await Promise.all(staff.map(async s => {
            try {
                const msg = await message(s);
                if (!msg) return;
                await linePush(s.line_user_id!, [msg], token);
                sent++;
            } catch (err) {
                console.error('[alerts] LINE staff push failed:', (err as Error).message);
            }
        }));
    } catch (err) {
        console.error('[alerts] LINE staff push failed:', (err as Error).message);
    }
    return sent;
}

// ── /api/alerts ───────────────────────────────────────────────────────────────

interface Caller { uid: string; name: string; hk?: { owner: string; building: string } }

async function callerOf(req: VercelRequest): Promise<Caller | null> {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return null;
    try {
        const d = await admin.auth().verifyIdToken(header.slice('Bearer '.length));
        const hk = typeof d.hk_owner === 'string' && typeof d.hk_building === 'string' ? { owner: d.hk_owner, building: d.hk_building } : undefined;
        return { uid: d.uid, name: (d.name as string | undefined) ?? d.email ?? '', ...(hk ? { hk } : {}) };
    } catch {
        return null;
    }
}

/** What the caller may do at a property: null = the owner, [] = nothing. A housekeeper session counts for its own building. */
async function permissionsAt(caller: Caller, ownerUid: string, buildingId: string): Promise<readonly Permission[] | null> {
    if (caller.uid === ownerUid) return null;
    if (caller.hk) return caller.hk.owner === ownerUid && caller.hk.building === buildingId ? permissionsForRole('housekeeping') : [];
    const m = (await db.doc(`users/${ownerUid}/members/${caller.uid}`).get()).data() as { status?: string; role?: string; property_ids?: string[] } | undefined;
    if (!m || m.status !== 'active' || !isRole(m.role)) return [];
    const places = m.property_ids ?? [];
    return places.includes('*') || places.includes(buildingId) ? permissionsForRole(m.role) : [];
}

/** Events that happen in the browser (written straight to Firestore) and so have no server code to raise them. */
const CLIENT_RAISED: Partial<Record<AlertType, Permission[]>> = {
    stock: ['property.update'],
    job_status: ['work_order.update', 'work_order.create'],
    cleaning: ['work_order.create', 'work_order.update'],
    maintenance: ['work_order.create', 'work_order.update'],
};

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const caller = await callerOf(req);
    if (!caller) { res.status(401).json({ error: 'unauthenticated' }); return; }
    const body = (req.body ?? {}) as {
        action?: string; prefs?: unknown; token?: unknown; ua?: unknown;
        owner_uid?: unknown; building_id?: unknown; type?: unknown; title?: unknown; body?: unknown; kind?: unknown; room_number?: unknown;
    };

    if (body.action === 'prefs_get') {
        res.status(200).json({ prefs: cleanAlertPrefs((await prefsRef(caller.uid).get()).data()) });
        return;
    }

    if (body.action === 'prefs_set') {
        const prefs = cleanAlertPrefs(body.prefs);
        await prefsRef(caller.uid).set({ ...prefs, updated_at: new Date().toISOString() });
        res.status(200).json({ prefs });
        return;
    }

    // A device registers for push. Written here, not from the browser: an account whose own plan has lapsed (a staff
    // account never has one) is refused by the rules, and would silently get no notifications.
    if (body.action === 'token_save') {
        const token = typeof body.token === 'string' ? body.token.trim() : '';
        if (token.length < 20 || token.length > 4096) { res.status(400).json({ error: 'invalid_input' }); return; }
        const key = Buffer.from(token.slice(-32)).toString('base64').replace(/[^a-z0-9]/gi, '').slice(0, 20);
        await db.doc(`users/${caller.uid}/data/fcm`).set({
            tokens: { [key]: { token, updated_at: new Date().toISOString(), ua: text(body.ua, 100) } },
        }, { merge: true });
        res.status(200).json({ ok: true });
        return;
    }

    if (body.action === 'raise') {
        const ownerUid = typeof body.owner_uid === 'string' ? body.owner_uid : '';
        const buildingId = typeof body.building_id === 'string' ? body.building_id : '';
        const type = body.type as AlertType;
        const need = CLIENT_RAISED[type];
        const title = text(body.title, 120);
        if (!ownerUid || !buildingId || !need || !title) { res.status(400).json({ error: 'invalid_input' }); return; }
        const perms = await permissionsAt(caller, ownerUid, buildingId);
        if (perms !== null && !need.some(p => perms.includes(p))) { res.status(403).json({ error: 'forbidden' }); return; }
        if (!(await db.doc(`users/${ownerUid}/buildings/${buildingId}`).get()).exists) { res.status(404).json({ error: 'property_not_found' }); return; }
        const out = await raiseAlert({
            ownerUid, buildingId, type, title, body: text(body.body, 500), kind: text(body.kind, 40) || undefined, exceptUid: caller.uid,
        });
        if (type === 'cleaning' && text(body.room_number, 40)) {
            const { notifyHousekeepersOfCleaning } = await import('./_staff-portal.js');
            await notifyHousekeepersOfCleaning(ownerUid, buildingId, { roomNumber: text(body.room_number, 40), note: text(body.body, 200) });
        }
        res.status(200).json(out);
        return;
    }

    res.status(400).json({ error: 'unknown_action' });
}
