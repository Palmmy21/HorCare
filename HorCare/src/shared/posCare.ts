// POS Care — the LINE OA "HorCare Staff" for the people who collect money on site (a market's collectors, a resort's or
// hotel's front desk), and the mobile page it opens. Pure rules shared by the webhook, the API and the page.
import type { Permission } from './permissions.js';

/** One-time code a HorCare account sends to the OA to link its LINE (made in the app, 15 minutes, single use). */
export const POS_LINK_CODE_RE = /^HCP-[A-HJ-NP-Z2-9]{8}$/;
export const isPosLinkCode = (t: string): boolean => POS_LINK_CODE_RE.test(t.trim().toUpperCase());
export const POS_LINK_TTL_MS = 15 * 60 * 1000;
/** A sign-in link from the OA works once, for this long. */
export const POS_SESSION_TTL_MS = 10 * 60 * 1000;

/** Who may use POS Care at a property: whoever takes money there (`null` = the owner). */
export function canUsePos(permissions: readonly Permission[] | null): boolean {
    return permissions === null || permissions.includes('collections.collect') || permissions.includes('booking.manage');
}
export const canClosePosDay = (permissions: readonly Permission[] | null): boolean => permissions === null || permissions.includes('collections.close');

export type PosCommand = 'open' | 'today' | 'closed_today' | 'close_day' | 'help';

/** The rich-menu buttons send exactly these; a few everyday words work too. */
const WORDS: Record<PosCommand, string[]> = {
    open: ['เปิด pos care', 'เปิด pos', 'pos care', 'pos', 'เก็บเงิน', 'เปิดเก็บเงิน'],
    today: ['ยอดวันนี้', 'ยอด', 'สรุปวันนี้'],
    closed_today: ['ร้านหยุดวันนี้', 'แผงหยุดวันนี้', 'หยุดวันนี้', 'ใครหยุด'],
    close_day: ['ปิดยอด', 'ปิดยอดวันนี้', 'ปิดรอบ'],
    help: ['ช่วยเหลือ', 'เมนู', 'วิธีใช้', 'help', 'menu', '?'],
};

export function parsePosCommand(text: string): PosCommand | null {
    const t = text.trim().toLowerCase().replace(/\s+/g, ' ');
    for (const cmd of Object.keys(WORDS) as PosCommand[]) if (WORDS[cmd].includes(t)) return cmd;
    return null;
}

export const POS_QUICK = ['เปิด POS Care', 'ยอดวันนี้', 'ร้านหยุดวันนี้', 'ปิดยอด'];

export const POS_NOT_LINKED =
    'สวัสดีค่ะ 👋 นี่คือ LINE สำหรับทีมเก็บเงิน (POS Care)\n\n' +
    'เชื่อม LINE กับบัญชี HorCare ของคุณก่อน (ทำครั้งเดียว):\n' +
    '1️⃣ เข้าแอป HorCare ด้วยบัญชีของคุณ\n' +
    '2️⃣ เปิดเมนู "เก็บเงินแผง" หรือ "เก็บค่าห้อง" → "POS Care ทาง LINE" แล้วกด "สร้างรหัส"\n' +
    '3️⃣ ส่งรหัสที่ขึ้นต้นด้วย HCP- มาในแชทนี้\n\n' +
    'ถ้าไม่เห็นเมนูนี้ ให้ผู้จัดการเพิ่มคุณเป็นทีมงานที่มีสิทธิ์เก็บเงินก่อน';

export const POS_HELP =
    'POS Care 💵\n\n' +
    '• "เปิด POS Care" — เปิดหน้าเก็บเงิน (เดินเก็บแผง / รับเงินค่าห้อง / ขาจร)\n' +
    '• "ยอดวันนี้" — เงินที่เก็บได้วันนี้ เงินสด โอน และที่ยังค้าง\n' +
    '• "ร้านหยุดวันนี้" — แผงที่แจ้งหยุด และโซนที่ตลาดหยุด\n' +
    '• "ปิดยอด" — นับเงินสดและปิดยอดประจำวัน\n\n' +
    'ลิงก์เปิด POS Care ใช้ได้ครั้งเดียวภายใน 10 นาที กดปุ่มใหม่ได้ทุกเมื่อ';

export interface PosDaySummary {
    name: string;
    style: 'monthly' | 'nightly' | 'stall';
    cash_satang: number;
    transfer_satang: number;
    payments: number;
    /** Stall round only: still to collect today. */
    due_stalls: number;
    due_satang: number;
    closed_today: number;
    day_closed: boolean;
}

const baht = (s: number) => `฿${Math.round(s / 100).toLocaleString('th-TH')}`;

export function formatPosDay(s: PosDaySummary): string {
    const lines = [
        `📊 ${s.name} — วันนี้`,
        `เก็บได้ ${baht(s.cash_satang + s.transfer_satang)} (${s.payments} รายการ)`,
        `เงินสด ${baht(s.cash_satang)} · โอน ${baht(s.transfer_satang)}`,
    ];
    if (s.style === 'stall') lines.push(s.due_stalls > 0 ? `ยังค้างเก็บ ${s.due_stalls} แผง ${baht(s.due_satang)}` : 'เก็บครบทุกแผงแล้ว ✅');
    if (s.closed_today > 0) lines.push(`แจ้งหยุดวันนี้ ${s.closed_today} แผง`);
    lines.push(s.day_closed ? 'ปิดยอดวันนี้แล้ว ✅' : 'ยังไม่ได้ปิดยอดวันนี้');
    return lines.join('\n');
}
