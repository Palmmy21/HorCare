/**
 * LINE webhook for the TEAM Official Account "HorCare Maintenance" (technicians, housekeepers, admins).
 *
 * Separate from /api/line-webhook (tenants): different channel, secret and access token.
 *   • Not linked yet: the registration menu and conversation (HCR- code → role, name, phone → manager approves), or an
 *     HCS- code from the manager, or an admin's HCO- code from the app.
 *   • Linked: the rich menu for the person's job (see _staff-menu.ts). Its buttons send the words handled here, and each
 *     answer is one sentence with one big button — งานของฉัน, ส่งงาน, จดมิเตอร์ for staff; งานทั้งหมด, ทีมงาน for admins.
 * Job notifications are pushed from api/_notify.ts using the same channel. Figures (#ยอด / #ค้าง / #ห้องว่าง) still answer
 * a linked account that may see finances (_owner-line.ts), but are not part of any menu.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { lineReply, staffLineToken, verifyLineSignature } from './_line.js';
import { isStaffLinkCode, redeemStaffLink } from './_work-orders.js';
import { handleStaffChat, staffHelp } from './_staff-registration.js';
import { handleOwnerCommand, redeemOwnerLink } from './_owner-line.js';
import { isOwnerLinkCode } from '../src/shared/ownerCommands.js';
import { issuePortalLink } from './_staff-portal.js';
import { staffIdentity, syncStaffMenu, type LineIdentity } from './_staff-menu.js';
import { appBaseUrl } from './_app-url.js';
import {
    ADMIN_ONLY, METER_HOUSEKEEPING_ONLY, NOT_LINKED, linkCard, parseStaffCommand, quickLabels, type StaffCommand,
} from '../src/shared/staffBot.js';

export const config = {
    api: { bodyParser: false },   // the signature is computed over the raw body
    maxDuration: 15,
};

async function getRawBody(req: VercelRequest): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    return Buffer.concat(chunks);
}

const quick = (labels: string[]) => ({ items: labels.map(label => ({ type: 'action', action: { type: 'message', label, text: label } })) });
const say = (text: string, labels: string[] = []) => ({ type: 'text', text, ...(labels.length ? { quickReply: quick(labels) } : {}) });

const TEXT_ONLY = 'แชทนี้อ่านรูปไม่ได้ค่ะ 🙏\n\nส่งรูปงาน: กดปุ่ม "ส่งงาน" ในเมนูด้านล่าง แล้วถ่ายรูปในหน้านั้น';
const FAILED = 'ขออภัยค่ะ ระบบขัดข้องชั่วคราว 🙏 กรุณาลองใหม่อีกครั้งในอีกสักครู่นะคะ';

const FAILURES: Record<string, string> = {
    not_found: '❌ ไม่พบรหัสนี้ กรุณาตรวจสอบ หรือขอรหัสใหม่จากผู้จัดการ',
    expired: '⌛ รหัสนี้หมดอายุแล้ว กรุณาขอรหัสใหม่จากผู้จัดการ',
    used: '⚠️ รหัสนี้ถูกใช้ไปแล้ว กรุณาขอรหัสใหม่จากผู้จัดการ',
    staff_unavailable: '⚠️ บัญชีพนักงานนี้ถูกปิดใช้งาน กรุณาติดต่อผู้จัดการ',
};

const guideCard = () => linkCard('📖 คู่มือการใช้งาน', 'วิธีลงทะเบียน รับงาน ส่งงาน และจดมิเตอร์ มีรูปประกอบทุกขั้นตอน', 'เปิดคู่มือ', `${appBaseUrl()}/?guide=staff`);

/** The answer to a rich-menu button, by who is asking. Every link is made for this person at this moment. */
async function answerCommand(cmd: Exclude<StaffCommand, 'help' | 'guide' | 'register'>, lineUserId: string, who: LineIdentity): Promise<object[]> {
    const app = appBaseUrl();
    const isHousekeeper = who.staff.some(s => s.staff.role === 'housekeeping');

    if (cmd === 'all_jobs' || cmd === 'team') {
        if (!who.admin) return [say(who.staff.length > 0 ? ADMIN_ONLY : NOT_LINKED, quickLabels(who.menu))];
        return [cmd === 'team'
            ? linkCard('👥 ทีมงาน', 'อนุมัติช่างและแม่บ้านที่ลงทะเบียน ดู QR ลงทะเบียน และรายชื่อทีมงาน', 'เปิดหน้าทีมงาน', `${app}/?view=operations&tab=team`)
            : linkCard('📋 งานทั้งหมด', 'ใบงานซ่อมและงานทำความสะอาดของทุกคน มอบหมายงานและตรวจรับงาน', 'เปิดหน้างาน', `${app}/?view=operations`)];
    }

    if (cmd === 'meter') {
        if (who.admin) return [linkCard('🔢 จดมิเตอร์', 'เปิดหน้าจดมิเตอร์น้ำ-ไฟในแอป HorCare', 'เปิดหน้าจดมิเตอร์', `${app}/?view=recording`)];
        if (who.staff.length === 0) return [say(NOT_LINKED, quickLabels(who.menu))];
        if (!isHousekeeper) return [say(METER_HOUSEKEEPING_ONLY, quickLabels(who.menu))];
        const url = await issuePortalLink(lineUserId);
        return url
            ? [linkCard('🔢 จดมิเตอร์', 'กดปุ่มด้านล่าง เลือกห้อง แล้วพิมพ์เลขมิเตอร์หรือถ่ายรูปมิเตอร์', 'เปิดหน้าจดมิเตอร์', `${url}&go=meter`)]
            : [say(NOT_LINKED)];
    }

    // jobs | submit
    if (who.staff.length === 0) {
        return who.admin
            ? [linkCard('📋 งานทั้งหมด', 'ใบงานซ่อมและงานทำความสะอาดของทุกคน', 'เปิดหน้างาน', `${app}/?view=operations`)]
            : [say(NOT_LINKED, quickLabels(who.menu))];
    }
    const url = await issuePortalLink(lineUserId);
    if (!url) return [say(NOT_LINKED)];
    return [cmd === 'submit'
        ? linkCard('📷 ส่งงาน', 'กดปุ่มด้านล่าง ถ่ายรูปงาน แล้วกด "งานเสร็จแล้ว"', 'เปิดงานถัดไป', `${url}&go=next`)
        : linkCard('📋 งานของฉัน', 'งานทั้งหมดที่คุณได้รับ กดที่งานเพื่อดูรายละเอียด', 'เปิดงานของฉัน', url)];
}

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
                await lineReply(replyToken, await staffHelp(lineUserId), token);
                await syncStaffMenu(lineUserId);
                return;
            }
            if (event.type !== 'message') return;
            // a photo of finished work sent here would otherwise vanish without a word
            if (['image', 'video', 'audio', 'file'].includes(event.message?.type ?? '')) {
                await lineReply(replyToken, [say(TEXT_ONLY, ['ส่งงาน'])], token);
                return;
            }
            if (event.message?.type !== 'text') return;
            const text: string = (event.message.text ?? '').trim();
            await lineReply(replyToken, await answerText(lineUserId, text), token);
            // whatever just happened (linked, approved elsewhere, switched off), leave them on the right menu
            await syncStaffMenu(lineUserId);
        } catch (err) {
            // One bad event must not make LINE retry the whole batch.
            console.error('[line-staff-webhook] event failed:', (err as Error).message);
            await lineReply(replyToken, [say(FAILED)], token).catch(() => undefined);
        }
    }));

    res.status(200).send('OK');
}

async function answerText(lineUserId: string, text: string): Promise<object[]> {
    const cmd = parseStaffCommand(text);

    // asked before anything else, so a rich-menu button is never taken as an answer in a registration
    if (cmd === 'help') return staffHelp(lineUserId);
    if (cmd === 'guide') return [guideCard()];

    // an admin's (or the owner's) HorCare account: link code, then the admin menu; figures for those who may see them
    if (isOwnerLinkCode(text)) {
        const answer = await redeemOwnerLink(lineUserId, text);
        return [say(answer, answer.startsWith('✅') ? quickLabels('admin') : [])];
    }
    const ownerReply = await handleOwnerCommand(lineUserId, text);
    if (ownerReply) return ownerReply;

    if (cmd && cmd !== 'register') return answerCommand(cmd, lineUserId, await staffIdentity(lineUserId));

    if (isStaffLinkCode(text)) {
        const r = await redeemStaffLink(lineUserId, text);
        if (!r.ok) return [say(FAILURES[r.reason])];
        const who = await staffIdentity(lineUserId);
        return [say(
            `✅ ลงทะเบียนสำเร็จ\n\nสวัสดีคุณ ${r.staffName}${r.dormName ? ` (${r.dormName})` : ''}\nเมนูด้านล่างเปลี่ยนเป็นเมนูทำงานแล้ว กด "งานของฉัน" เพื่อดูงานได้เลย งานใหม่จะเด้งเข้ามาในแชทนี้เอง`,
            quickLabels(who.menu),
        )];
    }

    // "ลงทะเบียน" from someone already linked: there is nothing to register, show what they can do
    if (cmd === 'register' && (await staffIdentity(lineUserId)).menu !== 'register') return staffHelp(lineUserId);

    // everything else: the registration conversation (HCR- code, role, name, phone) or where their request stands
    return handleStaffChat(lineUserId, text);
}
