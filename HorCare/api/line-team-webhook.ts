/**
 * LINE webhook for a team's own Official Account: /api/line-team-webhook/<id>, set on the OA by /api/line-oa.
 *
 * The same conversation as the shared tenant OA, so it runs /api/line-webhook's handler inside that team's channel: the
 * signature is checked with the team's secret, every reply uses the team's token, and only the team's rooms can be
 * registered here (channelAllowsOwner).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import tenantWebhook from './line-webhook.js';
import { runInLineChannel } from './_line.js';
import { loadTeamOa } from './_line-oa.js';

export const config = {
    api: { bodyParser: false },   // the signature is computed over the raw body
    maxDuration: 60,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
    const oa = typeof id === 'string' && /^[0-9a-f]{32}$/.test(id) ? await loadTeamOa(id, { fresh: true }) : null;
    if (!oa) { res.status(404).send('Not found'); return; }
    return runInLineChannel(`oa:${oa.id}`, () => tenantWebhook(req, res), { token: oa.token, secret: oa.secret, ownerUid: oa.ownerUid });
}
