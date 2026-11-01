/**
 * LINE webhook for the VENDOR Official Account (market stalls' พ่อค้าแม่ค้า).
 *
 * The same conversation as the tenant OA — register with an invitation / code, see the bill, send a slip, chat — so it
 * runs /api/line-webhook's handler inside runInLineChannel('market'): the signature is checked with
 * LINE_MARKET_CHANNEL_SECRET and every reply / push / image download uses LINE_MARKET_CHANNEL_ACCESS_TOKEN.
 * Rooms linked here remember it (`line_channel: 'market'`), so later bills and reminders go out through this OA.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import tenantWebhook from './line-webhook.js';
import { runInLineChannel } from './_line.js';

export const config = {
    api: { bodyParser: false },   // the signature is computed over the raw body
    maxDuration: 60,
};

export default function handler(req: VercelRequest, res: VercelResponse) {
    return runInLineChannel('market', () => tenantWebhook(req, res));
}
