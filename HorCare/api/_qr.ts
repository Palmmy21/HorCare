/**
 * GET /api/qr?p=<payload>&s=<pixels> — renders a Thai QR payment code as a PNG.
 *
 * LINE needs a public image URL for the QR it sends with a bill, and we do not want to hand the receiver's
 * account details (and the amount) to a third-party QR service. Only payloads that are valid Thai QR
 * credit-transfer codes are drawn (header, PromptPay AID, matching CRC), so this cannot be used as a general
 * "make me any QR" service. The same payload always gives the same image, so it is cached hard.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import QRCode from 'qrcode';
import { isValidThaiQrPayload } from '../src/shared/thaiQr.js';

export const config = { maxDuration: 10 };

const MIN_SIZE = 200;
const MAX_SIZE = 600;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const raw = req.query.p;
    const payload = Array.isArray(raw) ? raw[0] : raw;
    if (typeof payload !== 'string' || !isValidThaiQrPayload(payload)) { res.status(400).json({ error: 'invalid_payload' }); return; }

    const sizeRaw = Number(Array.isArray(req.query.s) ? req.query.s[0] : req.query.s);
    const size = Number.isFinite(sizeRaw) ? Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(sizeRaw))) : 300;

    const png = await QRCode.toBuffer(payload, { type: 'png', width: size, margin: 2, errorCorrectionLevel: 'M' });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.status(200).send(png);
}
