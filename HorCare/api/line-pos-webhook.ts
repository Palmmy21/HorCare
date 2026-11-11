/**
 * LINE webhook for "HorCare Staff" — POS Care, for the people who take money on site (see api/_pos.ts).
 * Its own channel: LINE_POS_CHANNEL_SECRET / LINE_POS_CHANNEL_ACCESS_TOKEN.
 *
 *   HCP-XXXXXXXX      link this LINE to the HorCare account that made the code
 *   เปิด POS Care      a sign-in link (single use, 10 minutes) to the POS page
 *   ยอดวันนี้           today's takings per place
 *   ร้านหยุดวันนี้       stalls that said they are closed, zones where the market is shut
 *   ปิดยอด             the sign-in link, opening on the day close
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { lineReply, verifyLineSignature } from './_line.js';
import { issuePosSession, posBindingOf, posClosedToday, posDaySummaries, redeemPosLink } from './_pos.js';
import { POS_HELP, POS_NOT_LINKED, POS_QUICK, formatPosDay, isPosLinkCode, parsePosCommand } from '../src/shared/posCare.js';
import { linkCard } from '../src/shared/staffBot.js';

export const config = {
    api: { bodyParser: false },   // the signature is computed over the raw body
    maxDuration: 30,
};

async function getRawBody(req: VercelRequest): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    return Buffer.concat(chunks);
}

const quick = (labels: string[]) => ({ items: labels.map(label => ({ type: 'action', action: { type: 'message', label: label.slice(0, 20), text: label } })) });
const say = (text: string, labels: string[] = []) => ({ type: 'text', text: text.slice(0, 4900), ...(labels.length ? { quickReply: quick(labels) } : {}) });
const FAILED = 'ขออภัยค่ะ ระบบขัดข้องชั่วคราว 🙏 กรุณาลองใหม่อีกครั้งในอีกสักครู่นะคะ';

export async function answerPos(lineUserId: string, text: string): Promise<object[]> {
    if (isPosLinkCode(text)) {
        const r = await redeemPosLink(lineUserId, text);
        return [say(r.text, r.ok ? POS_QUICK : [])];
    }
    const cmd = parsePosCommand(text);
    const linked = await posBindingOf(lineUserId);
    if (!linked) return [say(POS_NOT_LINKED)];
    if (cmd === 'open' || cmd === 'close_day') {
        const url = await issuePosSession(linked.binding, cmd === 'close_day' ? 'close' : undefined);
        return [linkCard(
            cmd === 'close_day' ? '🧾 ปิดยอดวันนี้' : '💵 POS Care',
            cmd === 'close_day' ? 'นับเงินสดในกระเป๋า แล้วกรอกยอดที่นับได้ ระบบจะเทียบกับเงินสดที่บันทึกให้' : 'เดินเก็บแผง รับเงินค่าห้อง เก็บค่าขาจร รับเงินสดหรือโอน',
            cmd === 'close_day' ? 'เปิดหน้าปิดยอด' : 'เปิด POS Care', url,
        )];
    }
    if (cmd === 'today') {
        const days = await posDaySummaries(linked.places);
        return [say(days.slice(0, 5).map(formatPosDay).join('\n\n') || 'ยังไม่มีข้อมูลวันนี้', POS_QUICK)];
    }
    if (cmd === 'closed_today') return [say(await posClosedToday(linked.places), POS_QUICK)];
    return [say(`${POS_HELP}\n\nเชื่อมกับ: ${linked.places.map(p => p.name).join(', ')}`, POS_QUICK)];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const secret = process.env.LINE_POS_CHANNEL_SECRET;
    if (!secret) { res.status(500).send('LINE_POS_CHANNEL_SECRET not set'); return; }
    const raw = await getRawBody(req);
    if (!verifyLineSignature(raw, secret, req.headers['x-line-signature'] as string)) { res.status(401).send('Invalid signature'); return; }

    interface LineEvent { type?: string; replyToken?: string; source?: { userId?: string }; message?: { type?: string; text?: string } }
    let events: LineEvent[] = [];
    try { events = JSON.parse(raw.toString('utf8')).events ?? []; } catch { /* treat as no events */ }

    const token = process.env.LINE_POS_CHANNEL_ACCESS_TOKEN;
    await Promise.all(events.map(async event => {
        const lineUserId = event.source?.userId;
        const replyToken = event.replyToken;
        if (!lineUserId || !replyToken) return;
        try {
            if (event.type === 'follow') {
                const linked = await posBindingOf(lineUserId);
                await lineReply(replyToken, [linked ? say(`ยินดีต้อนรับกลับค่ะ คุณ${linked.binding.name}\n\n${POS_HELP}`, POS_QUICK) : say(POS_NOT_LINKED)], token);
                return;
            }
            if (event.type !== 'message') return;
            if (event.message?.type !== 'text') {
                await lineReply(replyToken, [say('แชทนี้อ่านได้เฉพาะข้อความค่ะ รับสลิปหรือรูปได้ในหน้า POS Care', ['เปิด POS Care'])], token);
                return;
            }
            await lineReply(replyToken, await answerPos(lineUserId, (event.message.text ?? '').trim()), token);
        } catch (err) {
            console.error('[line-pos-webhook] event failed:', (err as Error).message);
            await lineReply(replyToken, [say(FAILED)], token).catch(() => undefined);
        }
    }));
    res.status(200).send('OK');
}
