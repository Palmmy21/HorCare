/**
 * A team's own LINE Official Account. Without one, a team's tenants use the shared HorCare OA; with one, new tenants
 * register, chat and receive bills through the team's OA, under the team's name. Tenants already on the shared OA stay
 * there and keep working: a room remembers the OA it linked through (`line_channel`, `oa:<id>` for a team's).
 *
 * `line_oas/{id}` is backend only (the rules' catch-all denies clients). The id doubles as the webhook address, and the
 * channel secret and access token are stored encrypted (AES-256-GCM, key in LINE_OA_ENC_KEY: 32 bytes, base64).
 *
 * /api/line-oa: status | connect | disconnect | liff_setup | liff_remove. Changing it affects every property of the team, so it is owner only.
 *
 * LIFF (scan a QR, registered — nothing to send): a LINE user id belongs to one provider, so a team's OA needs its own LIFF
 * app on a LINE Login channel in the same provider. The owner pastes that channel's id and secret (liff_setup); HorCare
 * creates the LIFF app through LINE's LIFF API and keeps `login_channel_id`, `login_secret_enc` and `liff_id` here.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { admin, db } from './_firebase.js';
import { appBaseUrl } from './_app-url.js';
import { writeAudit } from './_audit.js';
import { authorize } from './_rbac.js';

export const config = { maxDuration: 20 };

const COLLECTION = 'line_oas';
const CACHE_MS = 60_000;
const LINE = 'https://api.line.me/v2/bot';

function encKey(): Buffer | null {
    const key = Buffer.from(process.env.LINE_OA_ENC_KEY ?? '', 'base64');
    return key.length === 32 ? key : null;
}

export function encryptSecret(plain: string): string {
    const key = encKey();
    if (!key) throw new Error('LINE_OA_ENC_KEY is not set');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
}

export function decryptSecret(stored: string): string {
    const key = encKey();
    if (!key) throw new Error('LINE_OA_ENC_KEY is not set');
    const [version, iv, tag, data] = stored.split('.');
    if (version !== 'v1') throw new Error('unknown secret format');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

export interface TeamOa { id: string; ownerUid: string; oaId: string; secret: string; token: string }

const cache = new Map<string, { oa: TeamOa | null; at: number }>();

/**
 * Sending a month's bills looks the token up once per room, hence the short cache. The webhook passes `fresh`: a secret
 * just replaced must verify at once on every server instance.
 */
export async function loadTeamOa(id: string, opts: { fresh?: boolean } = {}): Promise<TeamOa | null> {
    const hit = cache.get(id);
    if (!opts.fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.oa;
    let oa: TeamOa | null = null;
    const data = (await db.collection(COLLECTION).doc(id).get()).data();
    if (data) {
        try {
            oa = { id, ownerUid: data.owner_uid, oaId: data.oa_id, secret: decryptSecret(data.secret_enc), token: decryptSecret(data.token_enc) };
        } catch (e) {
            console.error('[line-oa] cannot read credentials:', (e as Error).message);
        }
    }
    cache.set(id, { oa, at: Date.now() });
    return oa;
}

/** A team's LIFF app, if it set one up: what the LIFF page initialises with and the channel its tokens must come from. */
export interface TeamLiff { id: string; ownerUid: string; oaId: string; liffId: string; loginChannelId: string }

function teamLiffFrom(id: string, d: FirebaseFirestore.DocumentData | undefined): TeamLiff | null {
    if (!d?.liff_id || !d.login_channel_id) return null;
    return { id, ownerUid: d.owner_uid, oaId: d.oa_id, liffId: d.liff_id, loginChannelId: String(d.login_channel_id) };
}
export async function teamLiffById(id: string): Promise<TeamLiff | null> {
    if (!/^[0-9a-f]{32}$/.test(id)) return null;
    return teamLiffFrom(id, (await db.collection(COLLECTION).doc(id).get()).data());
}
export async function teamLiffOf(ownerUid: string): Promise<TeamLiff | null> {
    const d = await ownerOaDoc(ownerUid);
    return d ? teamLiffFrom(d.id, d.data()) : null;
}

const LIFF_API = 'https://api.line.me/liff/v1/apps';
/** The page a team's LIFF app opens: the shared gateway, told which team's LIFF app it runs in. */
const liffEndpoint = (id: string) => `${appBaseUrl()}/portal?team=${id}`;

/** A short-lived access token for a LINE Login channel (client credentials), or null when the id / secret are wrong. */
async function loginChannelToken(channelId: string, secret: string): Promise<string | null> {
    const r = await fetch('https://api.line.me/oauth2/v3/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: channelId, client_secret: secret }),
    });
    if (!r.ok) return null;
    return ((await r.json()) as { access_token?: string }).access_token ?? null;
}

async function ownerOaDoc(ownerUid: string) {
    return (await db.collection(COLLECTION).where('owner_uid', '==', ownerUid).get()).docs[0] ?? null;
}

/** The OA a property's residents add: the team's own, else the shared one (the vendor OA for market stalls). */
export async function propertyOaId(ownerUid: string, buildingId: string): Promise<string | undefined> {
    const own = await ownerOaDoc(ownerUid);
    if (own) return own.data().oa_id as string;
    const [building, cfg] = await Promise.all([
        db.doc(`users/${ownerUid}/buildings/${buildingId}`).get(),
        db.doc(`users/${ownerUid}/buildings/${buildingId}/data/config`).get(),
    ]);
    const type = building.data()?.building_type ?? cfg.data()?.building_type;
    if (type === 'market' && process.env.VITE_LINE_MARKET_OA_ID) return process.env.VITE_LINE_MARKET_OA_ID;
    return process.env.VITE_LINE_OA_ID;
}

/** Tenants reachable only through this OA, in all of the team's properties. */
async function roomsOn(ownerUid: string, id: string): Promise<number> {
    const buildings = await db.collection(`users/${ownerUid}/buildings`).get();
    const counts = await Promise.all(buildings.docs.map(async b =>
        (await db.collection(`users/${ownerUid}/buildings/${b.id}/rooms`).where('line_channel', '==', `oa:${id}`).get()).size));
    return counts.reduce((a, b) => a + b, 0);
}

/**
 * What LINE says about a connected OA right now. `webhook_active`: "Use webhook" is on. `webhook_matches`: it still
 * points here. `token_valid`: the stored token still works (false after someone reissues it in the console).
 * Each is null when LINE could not be asked, so a slow answer never reads as a broken connection.
 */
async function liveWebhook(id: string): Promise<{ webhook_active: boolean | null; webhook_matches: boolean | null; token_valid: boolean | null }> {
    const unknown = { webhook_active: null, webhook_matches: null, token_valid: null };
    const oa = await loadTeamOa(id, { fresh: true });
    if (!oa) return unknown;
    try {
        const r = await fetch(`${LINE}/channel/webhook/endpoint`, { headers: { Authorization: `Bearer ${oa.token}` }, signal: AbortSignal.timeout(5000) });
        if (r.status === 401) return { webhook_active: null, webhook_matches: null, token_valid: false };
        if (!r.ok) return unknown;
        const e = await r.json() as { endpoint?: string; active?: boolean };
        return { webhook_active: e.active === true, webhook_matches: (e.endpoint ?? '').replace(/\/$/, '') === webhookUrl(id), token_valid: true };
    } catch {
        return unknown;
    }
}

interface Body {
    action?: 'status' | 'connect' | 'disconnect' | 'liff_setup' | 'liff_remove';
    owner_uid?: string; building_id?: string; channel_secret?: unknown; access_token?: unknown;
    login_channel_id?: unknown; login_channel_secret?: unknown;
}

const webhookUrl = (id: string) => `${appBaseUrl()}/api/line-team-webhook/${id}`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const body = (req.body ?? {}) as Body;
    const ctx = await authorize(req, res, { ownerUid: body.owner_uid, buildingId: body.building_id, permission: 'property.update' });
    if (!ctx) return;
    if (ctx.uid !== ctx.ownerUid) { res.status(403).json({ error: 'forbidden' }); return; }

    const audit = (note: string, label: string) => writeAudit({
        ownerUid: ctx.ownerUid, propertyId: null, userId: ctx.uid, userName: ctx.displayName, role: ctx.role,
        action: 'UPDATE', resourceType: 'config', resourceId: 'line_oa', resourceLabel: label, note, req,
    });
    const current = await ownerOaDoc(ctx.ownerUid);

    if (body.action === 'status') {
        const d = current?.data();
        if (!d) { res.status(200).json({ connected: false, encryption_ready: !!encKey() }); return; }
        // Asked of LINE each time, so the page can say what is still left to do in LINE's own console:
        // "Use webhook" can only be switched on there, and someone may have pointed the webhook elsewhere since.
        const live = await liveWebhook(current!.id);
        res.status(200).json({
            connected: true, oa_id: d.oa_id, display_name: d.display_name, connected_at: d.connected_at, webhook_url: webhookUrl(current!.id),
            ...live,
            liff_id: d.liff_id ?? null, login_channel_id: d.login_channel_id ?? null, liff_endpoint: liffEndpoint(current!.id),
        });
        return;
    }

    if (body.action === 'liff_setup') {
        if (!current) { res.status(409).json({ error: 'not_connected' }); return; }
        const channelId = typeof body.login_channel_id === 'string' ? body.login_channel_id.replace(/\s+/g, '') : '';
        const secret = typeof body.login_channel_secret === 'string' ? body.login_channel_secret.replace(/\s+/g, '').toLowerCase() : '';
        if (!/^\d{6,20}$/.test(channelId) || !/^[0-9a-f]{32}$/.test(secret)) { res.status(400).json({ error: 'invalid_input' }); return; }
        if (!encKey()) { res.status(503).json({ error: 'encryption_not_configured' }); return; }
        const token = await loginChannelToken(channelId, secret);
        if (!token) { res.status(400).json({ error: 'invalid_login_channel' }); return; }

        const d = current.data();
        const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
        const app = {
            view: { type: 'full', url: liffEndpoint(current.id) },
            description: `HorCare ลงทะเบียน · ${d.display_name ?? d.oa_id}`.slice(0, 64),
            features: { qrCode: true },
            scope: ['profile', 'openid'],
            // asks to add the linked OA as a friend on the way in (the channel's "Linked OA" setting decides which OA)
            botPrompt: 'aggressive',
        };
        let liffId: string | null = d.login_channel_id === channelId && d.liff_id ? d.liff_id : null;
        if (liffId) {
            const upd = await fetch(`${LIFF_API}/${liffId}`, { method: 'PUT', headers, body: JSON.stringify(app) });
            if (upd.status === 404) liffId = null;
            else if (!upd.ok) { res.status(502).json({ error: 'liff_failed', status: upd.status }); return; }
        }
        if (!liffId) {
            const add = await fetch(LIFF_API, { method: 'POST', headers, body: JSON.stringify(app) });
            if (!add.ok) { res.status(502).json({ error: 'liff_failed', status: add.status }); return; }
            liffId = ((await add.json()) as { liffId?: string }).liffId ?? null;
            if (!liffId) { res.status(502).json({ error: 'liff_failed' }); return; }
        }
        await current.ref.update({ login_channel_id: channelId, login_secret_enc: encryptSecret(secret), liff_id: liffId, liff_set_at: new Date().toISOString() });
        await audit('team LIFF app set up', liffId);
        res.status(200).json({ ok: true, liff_id: liffId, login_channel_id: channelId, liff_endpoint: liffEndpoint(current.id) });
        return;
    }

    if (body.action === 'liff_remove') {
        const d = current?.data();
        if (!current || !d?.liff_id) { res.status(200).json({ ok: true }); return; }
        // best effort: the LIFF app on LINE's side goes too, so nothing keeps pointing at HorCare
        try {
            const token = await loginChannelToken(String(d.login_channel_id), decryptSecret(d.login_secret_enc));
            if (token) await fetch(`${LIFF_API}/${d.liff_id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
        } catch { /* the stored fields are cleared either way */ }
        await current.ref.update({ login_channel_id: admin.firestore.FieldValue.delete(), login_secret_enc: admin.firestore.FieldValue.delete(), liff_id: admin.firestore.FieldValue.delete(), liff_set_at: admin.firestore.FieldValue.delete() });
        await audit('team LIFF app removed', String(d.liff_id));
        res.status(200).json({ ok: true });
        return;
    }

    if (body.action === 'disconnect') {
        if (!current) { res.status(200).json({ ok: true }); return; }
        // their token is the only way to reach these tenants: dropping it would silently stop their bills
        const rooms = await roomsOn(ctx.ownerUid, current.id);
        if (rooms > 0) { res.status(409).json({ error: 'rooms_linked', rooms }); return; }
        await current.ref.delete();
        cache.delete(current.id);
        await audit('team LINE OA disconnected', String(current.data().oa_id));
        res.status(200).json({ ok: true });
        return;
    }

    if (body.action === 'connect') {
        // pasted from a web page: stray spaces and line breaks inside the values are never part of them
        const secret = typeof body.channel_secret === 'string' ? body.channel_secret.replace(/\s+/g, '').toLowerCase() : '';
        const token = typeof body.access_token === 'string' ? body.access_token.replace(/\s+/g, '') : '';
        if (!/^[0-9a-f]{32}$/.test(secret) || !token || token.length > 2000) { res.status(400).json({ error: 'invalid_input' }); return; }
        if (!encKey()) { res.status(503).json({ error: 'encryption_not_configured' }); return; }

        const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
        const infoRes = await fetch(`${LINE}/info`, { headers });
        if (!infoRes.ok) { res.status(400).json({ error: 'invalid_token' }); return; }
        const info = await infoRes.json() as { userId: string; basicId: string; premiumId?: string; displayName: string };
        const oaId = info.premiumId || info.basicId;

        if ([process.env.VITE_LINE_OA_ID, process.env.VITE_LINE_MARKET_OA_ID, process.env.VITE_LINE_STAFF_OA_ID].includes(oaId)) {
            res.status(409).json({ error: 'shared_oa' });
            return;
        }
        const sameBot = await db.collection(COLLECTION).where('bot_user_id', '==', info.userId).get();
        if (sameBot.docs.some(d => d.data().owner_uid !== ctx.ownerUid)) { res.status(409).json({ error: 'oa_taken' }); return; }
        // a LINE user id belongs to its provider: tenants can't carry over to a different OA
        if (current && current.data().bot_user_id !== info.userId) {
            const rooms = await roomsOn(ctx.ownerUid, current.id);
            if (rooms > 0) { res.status(409).json({ error: 'rooms_linked', rooms }); return; }
        }

        const id = current?.id ?? randomBytes(16).toString('hex');
        const ref = db.collection(COLLECTION).doc(id);
        const previous = current?.data();
        const undo = () => (previous ? ref.set(previous) : ref.delete());
        const keepLiff = previous && previous.bot_user_id === info.userId && previous.liff_id
            ? { login_channel_id: previous.login_channel_id, login_secret_enc: previous.login_secret_enc, liff_id: previous.liff_id, liff_set_at: previous.liff_set_at ?? null }
            : {};
        await ref.set({
            owner_uid: ctx.ownerUid, oa_id: oaId, bot_user_id: info.userId, display_name: info.displayName,
            secret_enc: encryptSecret(secret), token_enc: encryptSecret(token),
            connected_at: new Date().toISOString(), connected_by: ctx.uid,
            ...keepLiff,
        });
        cache.delete(id);

        const endpoint = await fetch(`${LINE}/channel/webhook/endpoint`, { method: 'PUT', headers, body: JSON.stringify({ endpoint: webhookUrl(id) }) });
        if (!endpoint.ok) { await undo(); res.status(502).json({ error: 'webhook_failed' }); return; }

        // LINE signs a test delivery with the channel secret, so this is what proves the secret that was pasted
        const test = await fetch(`${LINE}/channel/webhook/test`, { method: 'POST', headers, body: JSON.stringify({ endpoint: webhookUrl(id) }) });
        const result = await test.json().catch(() => ({})) as { success?: boolean; statusCode?: number };
        if (!result.success) {
            await undo();
            res.status(400).json({ error: result.statusCode === 401 ? 'invalid_secret' : 'webhook_failed' });
            return;
        }
        const active = await (await fetch(`${LINE}/channel/webhook/endpoint`, { headers })).json().catch(() => ({})) as { active?: boolean };
        await audit('team LINE OA connected', oaId);
        res.status(200).json({ connected: true, oa_id: oaId, display_name: info.displayName, webhook_url: webhookUrl(id), webhook_active: active.active === true });
        return;
    }

    res.status(400).json({ error: 'unknown_action' });
}
