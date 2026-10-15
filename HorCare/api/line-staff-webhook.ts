/**
 * LINE webhook for the STAFF Official Account (technicians & housekeepers).
 *
 * Separate from /api/line-webhook (tenants): different channel, secret and access token.
 * Its only job is connecting a staff member's LINE account to their HorCare staff record
 * when they send the code the manager gave them (HCS-XXXXXXXX). Job notifications are
 * pushed from api/_notify.ts using the same staff channel.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { lineReply, staffLineToken, verifyLineSignature } from './_line.js';
import { isStaffLinkCode, redeemStaffLink } from './_work-orders.js';
import { HELP, handleStaffChat } from './_staff-registration.js';

export const config = {
    api: { bodyParser: false },   // the signature is computed over the raw body
    maxDuration: 15,
};

async function getRawBody(req: VercelRequest): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    return Buffer.concat(chunks);
}

const FAILURES: Record<string, string> = {
    not_found: '❌ ไม่พบรหัสนี้ กรุณาตรวจสอบ หรือขอรหัสใหม่จากผู้จัดการ',
    expired: '⌛ รหัสนี้หมดอายุแล้ว กรุณาขอรหัสใหม่จากผู้จัดการ',
    used: '⚠️ รหัสนี้ถูกใช้ไปแล้ว กรุณาขอรหัสใหม่จากผู้จัดการ',
    staff_unavailable: '⚠️ บัญชีพนักงานนี้ถูกปิดใช้งาน กรุณาติดต่อผู้จัดการ',
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

    const secret = process.env.LINE_STAFF_CHANNEL_SECRET;
    if (!secret) { res.status(500).send('LINE_STAFF_CHANNEL_SECRET not set'); return; }

    const raw = await getRawBody(req);
    if (!verifyLineSignature(raw, secret, req.headers['x-line-signature'] as string)) {
        res.status(401).send('Invalid signature');
        return;
    }

    interface LineEvent {
        type?: string;
        replyToken?: string;
        source?: { userId?: string };
        message?: { type?: string; text?: string };
    }
    let events: LineEvent[] = [];
    try { events = JSON.parse(raw.toString('utf8')).events ?? []; } catch { /* treat as no events */ }

    const token = staffLineToken();
    await Promise.all(events.map(async (event) => {
        const lineUserId: string | undefined = event.source?.userId;
        const replyToken: string | undefined = event.replyToken;
        if (!lineUserId || !replyToken) return;
        try {
            if (event.type === 'follow') {
                await lineReply(replyToken, [{ type: 'text', text: HELP }], token);
                return;
            }
            if (event.type !== 'message' || event.message?.type !== 'text') return;
            const text: string = (event.message.text ?? '').trim();

            if (isStaffLinkCode(text)) {
                const r = await redeemStaffLink(lineUserId, text);
                await lineReply(replyToken, [{
                    type: 'text',
                    text: r.ok
                        ? `✅ เชื่อมต่อ LINE สำเร็จ\n\nสวัสดีคุณ ${r.staffName}${r.dormName ? ` (${r.dormName})` : ''}\nต่อไปนี้งานที่ได้รับมอบหมายจะส่งมาที่แชทนี้ค่ะ`
                        : FAILURES[r.reason],
                }], token);
                return;
            }
            // everything else: the registration conversation (HCR- code, role, name, phone) or a status / help answer
            await lineReply(replyToken, await handleStaffChat(lineUserId, text), token);
        } catch (err) {
            // One bad event must not make LINE retry the whole batch.
            console.error('[line-staff-webhook] event failed:', (err as Error).message);
        }
    }));

    res.status(200).send('OK');
}
