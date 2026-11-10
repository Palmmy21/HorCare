/**
 * A team's own LINE Official Account. Without one, a team's tenants use the shared HorCare OA; with one, new tenants
 * register, chat and receive bills through the team's OA, under the team's name. Tenants already on the shared OA stay
 * there and keep working: a room remembers the OA it linked through (`line_channel`, `oa:<id>` for a team's).
 *
 * `line_oas/{id}` is backend only (the rules' catch-all denies clients). The id doubles as the webhook address, and the
 * channel secret and access token are stored encrypted (AES-256-GCM, key in LINE_OA_ENC_KEY: 32 bytes, base64).
 *
 * /api/line-oa: status | connect | disconnect. Changing it affects every property of the team, so it is owner only.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { db } from './_firebase.js';
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

interface Body { action?: 'status' | 'connect' | 'disconnect'; owner_uid?: string; building_id?: string; channel_secret?: unknown; access_token?: unknown }

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
        });
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
        await ref.set({
            owner_uid: ctx.ownerUid, oa_id: oaId, bot_user_id: info.userId, display_name: info.displayName,
            secret_enc: encryptSecret(secret), token_enc: encryptSecret(token),
            connected_at: new Date().toISOString(), connected_by: ctx.uid,
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
