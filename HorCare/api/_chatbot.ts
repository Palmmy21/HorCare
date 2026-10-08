/**
 * /api/chatbot — the auto-reply Q&A a property teaches its LINE bot.
 *
 * Writes only (create / update / delete); the UI reads straight from Firestore under rules that need
 * `chatbot.manage`. Answering is `findFaqAnswer`, called by the LINE webhook for registered tenants.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import { db } from './_firebase.js';
import { authorize, buildingExists } from './_rbac.js';
import { writeAudit } from './_audit.js';
import { cleanFaqInput, matchFaq, MAX_FAQS, type FaqEntry } from '../src/shared/chatbot.js';

export const config = { maxDuration: 15 };

interface Body {
    action?: 'create' | 'update' | 'delete';
    owner_uid?: string;
    building_id?: string;
    faq_id?: string;
    title?: unknown;
    keywords?: unknown;
    answer?: unknown;
    enabled?: unknown;
}

const colOf = (owner: string, bld: string) => `users/${owner}/buildings/${bld}/faqs`;

/**
 * The owner's answer for a tenant's message, or null to stay quiet (a person will reply).
 * Best-effort bookkeeping: a failed hit-count update never blocks the answer.
 */
export async function findFaqAnswer(link: { uid: string; building_id: string }, text: string): Promise<string | null> {
    const snap = await db.collection(colOf(link.uid, link.building_id)).get();
    const faq = matchFaq(text, snap.docs.map(d => d.data() as FaqEntry));
    if (!faq) return null;
    await db.doc(`${colOf(link.uid, link.building_id)}/${faq.id}`).update({ hit_count: (faq.hit_count ?? 0) + 1 }).catch(() => undefined);
    return faq.answer;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const body = (req.body ?? {}) as Body;
    const buildingId = body.building_id;
    if (!buildingId || typeof buildingId !== 'string') { res.status(400).json({ error: 'building_id is required' }); return; }
    if (body.action !== 'create' && body.action !== 'update' && body.action !== 'delete') { res.status(400).json({ error: 'unknown_action' }); return; }

    const ctx = await authorize(req, res, { ownerUid: body.owner_uid, buildingId, permission: 'chatbot.manage' });
    if (!ctx) return;
    if (!(await buildingExists(ctx.ownerUid, buildingId))) { res.status(404).json({ error: 'property_not_found' }); return; }

    const col = colOf(ctx.ownerUid, buildingId);
    const audit = (action: 'CREATE' | 'UPDATE' | 'DELETE', faq: Pick<FaqEntry, 'id' | 'title'>, extra: object = {}) => writeAudit({
        ownerUid: ctx.ownerUid, propertyId: buildingId, userId: ctx.uid, userName: ctx.displayName, role: ctx.role,
        action, resourceType: 'faq', resourceId: faq.id, resourceLabel: faq.title, req, ...extra,
    });
    const now = new Date().toISOString();

    if (body.action === 'create') {
        const input = cleanFaqInput(body);
        if (!input) { res.status(400).json({ error: 'invalid_input' }); return; }
        if ((await db.collection(col).get()).docs.length >= MAX_FAQS) { res.status(409).json({ error: 'limit_reached' }); return; }
        const faq: FaqEntry = { id: randomUUID(), ...input, hit_count: 0, created_at: now, updated_at: now };
        await db.doc(`${col}/${faq.id}`).set(faq);
        await audit('CREATE', faq);
        res.status(200).json({ faq });
        return;
    }

    if (!body.faq_id || typeof body.faq_id !== 'string') { res.status(400).json({ error: 'faq_id is required' }); return; }
    const ref = db.doc(`${col}/${body.faq_id}`);
    const snap = await ref.get();
    if (!snap.exists) { res.status(404).json({ error: 'not_found' }); return; }
    const current = snap.data() as FaqEntry;

    if (body.action === 'delete') {
        await ref.delete();
        await audit('DELETE', current);
        res.status(200).json({ ok: true });
        return;
    }

    // update: absent fields keep their current value
    const input = cleanFaqInput({
        title: body.title ?? current.title, keywords: body.keywords ?? current.keywords,
        answer: body.answer ?? current.answer, enabled: body.enabled ?? current.enabled,
    });
    if (!input) { res.status(400).json({ error: 'invalid_input' }); return; }
    await ref.update({ ...input, updated_at: now });
    await audit('UPDATE', current, { before: { enabled: current.enabled }, after: { enabled: input.enabled } });
    res.status(200).json({ ok: true });
}
