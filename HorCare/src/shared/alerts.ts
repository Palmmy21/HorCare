// Alerts: the things worth interrupting someone for, who may receive each, and each person's own switches.
//
// One catalogue for every kind of account — the owner, an admin / front desk, accounting, a housekeeper or technician
// with a HorCare account. A person is sent an alert only when (1) their role may see what it is about at that
// property and (2) they have not switched that kind off. Pure: shared by the server (which decides) and the app
// (which shows the switches a role can actually use).
import type { Permission } from './permissions.js';

export const ALERT_TYPES = [
    'staff_link', 'line_request', 'maintenance', 'cleaning', 'job_status', 'help_request', 'chat', 'booking', 'payment', 'stock', 'monthly_summary',
    'shop_closure', 'walk_in',
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export interface AlertInfo {
    label: string;
    /** One line for the settings list. */
    hint: string;
    /** The role must hold ANY of these (the owner holds all). */
    permissions: Permission[];
    /** Where tapping the alert goes (see App's /?view= links). */
    url: string;
}

export const ALERT_INFO: Record<AlertType, AlertInfo> = {
    staff_link: {
        label: 'ช่าง / แม่บ้านเชื่อม LINE', hint: 'มีคนลงทะเบียนเป็นช่างหรือแม่บ้าน หรือเชื่อม LINE สำเร็จ',
        permissions: ['work_order.create'], url: '/?view=operations&tab=team',
    },
    line_request: {
        label: 'คำขอลงทะเบียน LINE ของผู้เช่า', hint: 'ผู้เช่าขอลงทะเบียนห้องที่มีคนอยู่แล้ว หรือขอเพิ่มห้อง รออนุมัติ',
        permissions: ['tenant.update'], url: '/?view=tenants',
    },
    maintenance: {
        label: 'งานแจ้งซ่อมใหม่', hint: 'ผู้เช่าแจ้งซ่อม ต้องมอบหมายช่าง',
        permissions: ['work_order.read', 'work_order.create'], url: '/?view=operations&tab=maintenance',
    },
    cleaning: {
        label: 'งานแม่บ้านใหม่', hint: 'มีคำขอทำความสะอาดเข้ามา',
        permissions: ['work_order.read', 'work_order.create'], url: '/?view=operations&tab=cleaning',
    },
    job_status: {
        label: 'สถานะงานช่าง / แม่บ้าน', hint: 'รับงาน เริ่มงาน หรือทำเสร็จรอตรวจ',
        permissions: ['work_order.read', 'work_order.create'], url: '/?view=operations&tab=workorders',
    },
    help_request: {
        label: 'ผู้เช่าขอความช่วยเหลือ', hint: 'ผู้เช่าหรือผู้ค้ากดปุ่ม "ขอความช่วยเหลือ" ใน LINE — รอคนเข้าไปตอบ',
        permissions: ['message.read'], url: '/?view=messages',
    },
    booking: {
        label: 'การจอง / สัญญาเช่า', hint: 'มีการจองห้องหรือแผง ยกเลิกจอง ทำสัญญาเช่า หรือสัญญาสิ้นสุด',
        permissions: ['room.read', 'leasing.read'], url: '/?view=rooms',
    },
    chat: {
        label: 'แชทจากผู้เช่า', hint: 'ผู้เช่าส่งข้อความ รูป หรือไฟล์ทาง LINE',
        permissions: ['message.read'], url: '/?view=messages',
    },
    payment: {
        label: 'เงินเข้า / สลิป', hint: 'ผู้เช่าส่งสลิป หรือระบบรับยอดอัตโนมัติ',
        permissions: ['finance.read', 'payment.create', 'payment.update'], url: '/?view=payments',
    },
    stock: {
        label: 'การปรับสต๊อก', hint: 'มีการเบิก เติม หรือแก้จำนวนของในสต๊อก',
        permissions: ['property.update'], url: '/?view=operations&tab=stock',
    },
    monthly_summary: {
        label: 'ยอดรายเดือน', hint: 'สรุปยอดเก็บเงินของเดือนที่ผ่านมา ทุกวันที่ 1',
        permissions: ['finance.read'], url: '/?view=summary',
    },
    shop_closure: {
        label: 'ร้านค้าแจ้งหยุด', hint: 'พ่อค้าแม่ค้าแจ้งหยุดขายทาง LINE หรือหน้าร้านค้า — วันนั้นไม่เก็บค่าแผง',
        permissions: ['shop.read', 'collections.read'], url: '/?view=market',
    },
    walk_in: {
        label: 'ขาจรแจ้งเข้าขาย', hint: 'ขาจรส่งคำขอเข้าขายจากลิงก์ของตลาด รออนุมัติ',
        permissions: ['shop.read', 'collections.collect'], url: '/?view=market',
    },
};

export const isAlertType = (v: unknown): v is AlertType => typeof v === 'string' && (ALERT_TYPES as readonly string[]).includes(v);

/** May this account receive this kind at all? `permissions` null = the owner. */
export function canReceiveAlert(type: AlertType, permissions: readonly Permission[] | null): boolean {
    return permissions === null || ALERT_INFO[type].permissions.some(p => permissions.includes(p));
}

/** The kinds an account can be sent — what its settings list shows. */
export const alertTypesFor = (permissions: readonly Permission[] | null): AlertType[] => ALERT_TYPES.filter(t => canReceiveAlert(t, permissions));

/**
 * A person's own switches. Anything not set is on: a new kind of alert reaches people until they say otherwise.
 * `push` is the master switch for notifications outside the app (the phone's notification, with the app closed).
 */
export type AlertPrefs = Partial<Record<AlertType, boolean>> & { push?: boolean };

export const wantsAlert = (prefs: AlertPrefs | null | undefined, type: AlertType): boolean => prefs?.[type] !== false;
export const wantsPush = (prefs: AlertPrefs | null | undefined): boolean => prefs?.push !== false;

/** Keep only known switches with boolean values (input from a client). */
export function cleanAlertPrefs(raw: unknown): AlertPrefs {
    const out: AlertPrefs = {};
    if (!raw || typeof raw !== 'object') return out;
    const src = raw as Record<string, unknown>;
    for (const t of ALERT_TYPES) if (typeof src[t] === 'boolean') out[t] = src[t] as boolean;
    if (typeof src.push === 'boolean') out.push = src.push;
    return out;
}

/** One entry of a person's inbox: users/{uid}/inbox/{id}. */
export interface InboxItem {
    id: string;
    type: AlertType;
    title: string;
    body: string;
    url: string;
    owner_uid: string;
    building_id: string;
    created_at: string;
    /** Finer than `type`, for the app (e.g. job_status of a 'cleaning' request vs a 'work_order'). */
    kind?: string;
}
