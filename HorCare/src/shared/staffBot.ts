// The team LINE OA (HorCare Maintenance): what a message means, which rich menu a person gets, and how replies are worded.
// Written for people who rarely use apps: short sentences, one thing to do, a big button. Pure — the webhook does the I/O.
import { PORTAL_KEYWORDS } from './staffPortal.js';
import type { StaffRole } from './workOrders.js';

export type StaffCommand = 'jobs' | 'submit' | 'meter' | 'register' | 'guide' | 'help' | 'all_jobs' | 'team';

/** Whole-message matches (the rich-menu buttons send exactly these); anything else is conversation or a code. */
const COMMANDS: Record<StaffCommand, string[]> = {
    jobs: PORTAL_KEYWORDS,
    submit: ['ส่งงาน', 'งานถัดไป', 'งานล่าสุด'],
    meter: ['จดมิเตอร์', 'มิเตอร์', 'meter'],
    register: ['ลงทะเบียน', 'สมัคร', 'register'],
    guide: ['คู่มือ', 'วิธีลงทะเบียน', 'guide'],
    help: ['ช่วยเหลือ', 'เมนู', 'วิธีใช้', 'help', 'menu', '?'],
    all_jobs: ['งานทั้งหมด'],
    team: ['ทีมงาน', 'อนุมัติพนักงาน'],
};

export function parseStaffCommand(text: string): StaffCommand | null {
    const t = text.trim().toLowerCase();
    for (const cmd of Object.keys(COMMANDS) as StaffCommand[]) if (COMMANDS[cmd].includes(t)) return cmd;
    return null;
}

// ── rich menus ───────────────────────────────────────────────────────────────

/** One rich menu per kind of person. `register` is the OA's default: everyone sees it until they are linked. */
export type StaffMenu = 'register' | 'technician' | 'housekeeping' | 'admin';
export const STAFF_MENUS: StaffMenu[] = ['register', 'technician', 'housekeeping', 'admin'];
/** The `name` each menu is created with on LINE; the server finds a menu's id by it. */
export const staffMenuName = (menu: StaffMenu) => `horcare-staff-${menu}`;

/**
 * Which menu a LINE account should see. An admin (a HorCare account linked with an HCO- code) gets the admin menu;
 * staff get the menu of their job, housekeeping first because it holds everything the technician menu does plus meters.
 */
export function menuFor(who: { admin: boolean; roles: StaffRole[] }): StaffMenu {
    if (who.admin) return 'admin';
    if (who.roles.includes('housekeeping')) return 'housekeeping';
    if (who.roles.length > 0) return 'technician';
    return 'register';
}

// ── wording ──────────────────────────────────────────────────────────────────

export const REGISTER_HELP =
    '📝 ลงทะเบียนรับงาน ทำ 3 ขั้นตอน\n\n' +
    '1️⃣ ขอ QR จากผู้จัดการ\n' +
    '2️⃣ สแกน QR แล้วกด "ส่ง"\n' +
    '3️⃣ ตอบชื่อและเบอร์โทร แล้วรอผู้จัดการอนุมัติ\n\n' +
    'ไม่มี QR? พิมพ์รหัสที่ผู้จัดการให้ (ขึ้นต้น HCR- หรือ HCS-) ส่งมาในแชทนี้ได้เลยค่ะ\n\n' +
    'ผู้ดูแล / แอดมิน: สร้างรหัส HCO- ในแอป HorCare (ตั้งค่า → การเชื่อมต่อ) แล้วส่งมาที่นี่';

export const NOT_LINKED =
    '⚠️ LINE นี้ยังไม่ได้ลงทะเบียนค่ะ\n\nกดปุ่ม "ลงทะเบียน" ในเมนูด้านล่าง หรือขอ QR จากผู้จัดการแล้วสแกนได้เลย';

export const ADMIN_ONLY = 'เมนูนี้สำหรับผู้ดูแลค่ะ งานของคุณอยู่ที่ปุ่ม "งานของฉัน"';
export const METER_HOUSEKEEPING_ONLY = 'การจดมิเตอร์เปิดให้แม่บ้านและผู้ดูแลค่ะ หากต้องจดมิเตอร์ กรุณาแจ้งผู้จัดการ';

export function staffHelpText(who: { name: string; roles: StaffRole[] }): string {
    const lines = [
        '• "งานของฉัน" — ดูงานทั้งหมดที่ได้รับ',
        '• "ส่งงาน" — เปิดงานถัดไป ถ่ายรูป แล้วกด "งานเสร็จแล้ว"',
    ];
    if (who.roles.includes('housekeeping')) lines.push('• "จดมิเตอร์" — จดเลขมิเตอร์น้ำ-ไฟ หรือถ่ายรูปมิเตอร์');
    return `สวัสดีค่ะคุณ ${who.name} 👋\n\nกดปุ่มในเมนูด้านล่างได้เลย\n${lines.join('\n')}\n\nงานใหม่จะเด้งเข้ามาในแชทนี้เอง ไม่ต้องทำอะไรเพิ่ม`;
}

export const ADMIN_HELP =
    'เมนูผู้ดูแล 🛠️\n\n' +
    '• "งานทั้งหมด" — ใบงานซ่อมและทำความสะอาดของทุกคน\n' +
    '• "ทีมงาน" — อนุมัติช่าง/แม่บ้านที่ลงทะเบียน และ QR ลงทะเบียน\n' +
    '• "จดมิเตอร์" — หน้าจดมิเตอร์ในแอป\n\n' +
    'ปุ่มจะเปิดแอป HorCare ถ้ายังไม่ได้เข้าสู่ระบบ ให้เข้าสู่ระบบด้วยบัญชีของคุณก่อน';

export const quickLabels = (menu: StaffMenu): string[] => ({
    register: ['ลงทะเบียน', 'คู่มือ'],
    technician: ['งานของฉัน', 'ส่งงาน'],
    housekeeping: ['งานของฉัน', 'ส่งงาน', 'จดมิเตอร์'],
    admin: ['งานทั้งหมด', 'ทีมงาน', 'จดมิเตอร์'],
}[menu]);

/** A reply that is one sentence and one big button — easier than a long link for someone who does not read much. */
export function linkCard(title: string, body: string, label: string, url: string) {
    return {
        type: 'flex',
        altText: `${title}\n${url}`.slice(0, 400),
        contents: {
            type: 'bubble',
            body: {
                type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '20px',
                contents: [
                    { type: 'text', text: title, weight: 'bold', size: 'xl', color: '#102A43', wrap: true },
                    { type: 'text', text: body, size: 'md', color: '#3E5872', wrap: true },
                ],
            },
            footer: {
                type: 'box', layout: 'vertical', paddingAll: '16px',
                contents: [{ type: 'button', style: 'primary', color: '#0A6CC2', height: 'md', action: { type: 'uri', label: label.slice(0, 20), uri: url } }],
            },
        },
    };
}
