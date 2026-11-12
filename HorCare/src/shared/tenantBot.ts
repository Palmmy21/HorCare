// What the resident LINE bots understand and say: the tenant OA, the vendor (market) OA and a team's own OA all run
// the same conversation. Pure: the webhook decides what to do, this file decides what a message means and how to word it.
import { normalizeForMatch } from './chatbot.js';

export type TenantCommand = 'bill' | 'slip' | 'portal' | 'repair' | 'announcements' | 'contact' | 'register' | 'cancel' | 'help' | 'support' | 'close_shop' | 'my_closures' | 'walkin_status' | 'walkin_new';

/**
 * Whole-message matches only (after normalizing), never "contains": "บิลเดือนที่แล้วผิดค่ะ ช่วยดูหน่อย" is a message for
 * a person, not a request to see the bill. Bare words an owner is likely to teach the Q&A bot (ค่าเช่า, ยอด) stay out.
 */
const COMMANDS: Record<TenantCommand, string[]> = {
    bill: ['บิล', 'ดูบิล', 'บิลล่าสุด', 'บิลเดือนนี้', 'เช็คบิล', 'เช็กบิล', 'ยอดเดือนนี้', 'ค่าเช่าเดือนนี้', 'bill', 'mybill'],
    slip: ['ส่งสลิป', 'สลิป', 'แจ้งโอน', 'แจ้งโอนเงิน', 'แจ้งชำระ', 'แจ้งชำระเงิน', 'slip'],
    portal: ['พอร์ทัล', 'พอทัล', 'portal'],
    repair: ['แจ้งซ่อม', 'ซ่อม', 'repair'],
    announcements: ['ประกาศ', 'ประกาศล่าสุด', 'ดูประกาศ'],
    // market vendors: say the stall is closed on a day (anyone else is told it is for market stalls)
    close_shop: ['แจ้งหยุด', 'แจ้งหยุดร้าน', 'หยุดร้าน', 'ปิดร้าน', 'แจ้งปิดร้าน'],
    my_closures: ['วันหยุดที่แจ้ง', 'ดูวันหยุด', 'ยกเลิกแจ้งหยุด'],
    // walk-in vendors (ขาจร, not registered): the walk-in rich menu and its quick replies
    walkin_status: ['สถานะขาจร', 'สถานะการจอง', 'ผลการจอง', 'ผลการพิจารณา', 'ดูสถานะ'],
    walkin_new: ['แจ้งเข้าขาย', 'จองวันขาย', 'แจ้งขาจร', 'จองล็อก'],
    contact: ['ติดต่อแอดมิน'],
    // the rich menu's help button: a person at the property is told right away (not the HorCare team: that is contact)
    support: ['ขอความช่วยเหลือ', 'ต้องการความช่วยเหลือ', 'ความช่วยเหลือ', 'เรียกเจ้าหน้าที่', 'ติดต่อเจ้าหน้าที่', 'ขอคุยกับเจ้าหน้าที่', 'คุยกับเจ้าหน้าที่', 'ติดต่อเจ้าของหอ', 'ติดต่อเจ้าของตลาด', 'ติดต่อนิติ', 'sos'],
    register: ['ลงทะเบียน', 'register'],
    cancel: ['ยกเลิก', 'cancel'],
    help: ['ช่วยเหลือ', 'เมนู', 'วิธีใช้', 'คำสั่ง', 'ทำอะไรได้บ้าง', 'help', 'menu'],
};

/** The main word of each command (what the menus send) — the in-app manual must explain every one (manual.test.ts). */
export const TENANT_COMMAND_WORDS: Readonly<Record<TenantCommand, string>> = Object.fromEntries(
    (Object.entries(COMMANDS) as [TenantCommand, string[]][]).map(([cmd, words]) => [cmd, words[0]]),
) as Record<TenantCommand, string>;

const LOOKUP = new Map<string, TenantCommand>();
for (const [cmd, words] of Object.entries(COMMANDS) as [TenantCommand, string[]][]) {
    for (const w of words) LOOKUP.set(normalizeForMatch(w), cmd);
}

const POLITE_END = /(ครับผม|ครับ|คับ|ค่ะ|คะ|ค่า|จ้า|จ้ะ|นะ|หน่อย|ด้วย)+$/u;
const ASK_START = /^(ขอดู|ขอ|อยากดู)/u;

/** The command a message is, or null when it is ordinary conversation. "ขอดูบิลหน่อยครับ" and "Bill" are both `bill`. */
export function parseTenantCommand(text: string): TenantCommand | null {
    const raw = text.trim();
    if (raw === '?' || raw === '？') return 'help';
    if (raw.length > 40) return null;
    const n = normalizeForMatch(raw);
    if (!n) return null;
    const direct = LOOKUP.get(n);
    if (direct) return direct;
    const bare = n.replace(POLITE_END, '');
    return LOOKUP.get(bare) ?? LOOKUP.get(bare.replace(ASK_START, '')) ?? null;
}

/** The vendor OA talks about a market and its stalls, the others about a dorm and its rooms. */
export interface BotVocab { place: string; unit: string; owner: string }
export const botVocab = (market: boolean): BotVocab => market
    ? { place: 'ตลาด', unit: 'แผง', owner: 'เจ้าของตลาด' }
    : { place: 'หอพัก', unit: 'ห้อง', owner: 'เจ้าของหอ' };

/** Buttons shown under a reply; each sends its own label back as a message. */
export const TENANT_QUICK = ['บิล', 'ส่งสลิป', 'พอร์ทัล', 'ประกาศ'];
export const GUEST_QUICK = ['ลงทะเบียน'];

export const quickReply = (labels: string[]) => ({
    items: labels.slice(0, 13).map(label => ({ type: 'action', action: { type: 'message', label: label.slice(0, 20), text: label } })),
});

/** A LINE text message, with quick-reply buttons when there are any. */
export const botText = (text: string, labels: string[] = []) => ({
    type: 'text', text: text.slice(0, 4900), ...(labels.length ? { quickReply: quickReply(labels) } : {}),
});

const menuLines = (v: BotVocab) =>
    '• "บิล" — ดูบิลล่าสุด\n' +
    '• "ส่งสลิป" — แจ้งชำระด้วยรูปสลิปโอนเงิน\n' +
    '• "พอร์ทัล" — ประวัติบิล สถานะการชำระ และแจ้งซ่อม\n' +
    `• "ประกาศ" — ประกาศล่าสุดจาก${v.place}\n` +
    `• "ขอความช่วยเหลือ" — เรียกเจ้าหน้าที่${v.place}ทันที`;

export function helpText(registered: boolean, market: boolean): string {
    const v = botVocab(market);
    const vendor = market ? '\n• "แจ้งหยุด" — แจ้งว่าแผงหยุดวันไหน (ดู/ยกเลิก: "วันหยุดที่แจ้ง")' : '';
    return registered
        ? `📋 สิ่งที่ทำได้ในแชทนี้\n\n${menuLines(v)}${vendor}\n\nเรื่องอื่น ๆ พิมพ์มาได้เลยค่ะ ${v.owner}จะตอบกลับในแชทนี้`
        : notRegisteredText(market);
}

export function notRegisteredText(market: boolean): string {
    const v = botVocab(market);
    return `สวัสดีค่ะ 😊 บัญชีนี้ใช้รับบิลและแจ้งชำระเงินของ${v.place}\n\n` +
        `คุณยังไม่ได้ลงทะเบียน: สแกน QR หรือกดลิงก์ที่${v.owner}ให้ไว้ได้เลยค่ะ\n` +
        `หรือพิมพ์ "ลงทะเบียน" เพื่อใส่รหัส${v.place}ด้วยตนเอง`;
}

/** Sent when someone adds the OA as a friend. */
export function welcomeText(link: { room_number?: string; dorm_name?: string } | null, market: boolean): string {
    if (!link) return notRegisteredText(market);
    const v = botVocab(market);
    const where = `${v.unit} ${link.room_number ?? '-'}${link.dorm_name ? ` (${link.dorm_name})` : ''}`;
    return `ยินดีต้อนรับค่ะ 🎉\n\nคุณลงทะเบียน${where} ไว้แล้ว บิลและการแจ้งเตือนจะส่งมาที่แชทนี้\n\n${menuLines(v)}`;
}

export function ackText(market: boolean): string {
    return `ได้รับข้อความแล้วค่ะ 🙏 ${botVocab(market).owner}จะตอบกลับโดยเร็วที่สุด\n\nระหว่างนี้พิมพ์ "บิล" เพื่อดูบิลล่าสุด หรือ "เมนู" เพื่อดูสิ่งที่ทำได้ในแชทนี้`;
}
