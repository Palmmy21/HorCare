/**
 * Central Notification Service.
 *
 * Features raise an *event* ("parcel.received", "work_order.assigned"); this module
 * decides which channels carry it (LINE, in-app, later email/push) and renders the
 * message. Feature code never talks to LINE directly, so adding a channel or changing
 * wording happens here.
 *
 * Never throws: a failed notification must not fail the business action behind it.
 */
import { randomUUID } from 'node:crypto';
import { db } from './_firebase.js';
import { linePush, staffLineToken } from './_line.js';
import { portalUrlFor } from './_portal-link.js';

export type NotificationEvent =
    | 'parcel.received'
    | 'parcel.overdue'
    | 'work_order.assigned'
    | 'shop.closure_submitted'
    | 'visitor.arriving'
    | 'staff.registration_pending'
    | 'payment.needs_review';
// Planned: 'invoice.overdue' | 'contract.expiring'

export type Channel = 'line' | 'in_app';
export type ChannelResult = 'sent' | 'failed' | 'skipped';

export type NotifyData = Record<string, string | number | null | undefined>;

export interface NotifyInput {
    event: NotificationEvent;
    ownerUid: string;
    buildingId: string;
    /** Tenant notifications: recipients are resolved from the room, never from a name. */
    roomId?: string;
    /** Staff notifications: the LINE account the staff member linked themselves. */
    lineUserId?: string;
    data: NotifyData;
    /** Link the recipient can open (portal / work page). */
    url?: string;
}

export interface NotifyResult {
    channels: Record<Channel, ChannelResult>;
    /** True when at least one channel delivered. */
    delivered: boolean;
}

/** Which channels apply for a recipient. In-app always; LINE only if they have a linked LINE account. */
export function decideChannels(recipient: { line_user_id?: string } | undefined): Channel[] {
    return recipient?.line_user_id ? ['in_app', 'line'] : ['in_app'];
}

export interface RenderedMessage {
    title: string;
    /** Plain-text body (also the in-app text and the LINE fallback). */
    body: string;
    /** Optional rich LINE message; used instead of the text when present. */
    lineMessage?: object;
}

const PRIORITY_TH: Record<string, string> = { low: 'ต่ำ', normal: 'ปกติ', high: 'สูง', urgent: 'ด่วน' };
const PRIORITY_COLOR: Record<string, string> = { low: '#64748B', normal: '#0284C7', high: '#D97706', urgent: '#DC2626' };

/** LINE Flex bubble for a newly assigned job, with a "view job" button. Pure — easy to test. */
export function buildWorkOrderFlex(d: NotifyData, dormName: string, url: string): object {
    const row = (label: string, value: string) => ({
        type: 'box', layout: 'baseline', spacing: 'sm',
        contents: [
            { type: 'text', text: label, color: '#94A3B8', size: 'sm', flex: 2 },
            { type: 'text', text: value, color: '#0F172A', size: 'sm', flex: 5, wrap: true },
        ],
    });
    const priority = String(d.priority ?? 'normal');
    const desc = String(d.description ?? '').slice(0, 120);
    return {
        type: 'flex',
        altText: `งานใหม่: ${d.area ?? ''} (${dormName})`.slice(0, 400),
        contents: {
            type: 'bubble',
            header: {
                type: 'box', layout: 'vertical', backgroundColor: PRIORITY_COLOR[priority] ?? '#0284C7', paddingAll: 'lg',
                contents: [
                    { type: 'text', text: '🔧 งานใหม่ที่ได้รับมอบหมาย', color: '#FFFFFF', weight: 'bold', size: 'md' },
                    { type: 'text', text: dormName, color: '#FFFFFFCC', size: 'xs' },
                ],
            },
            body: {
                type: 'box', layout: 'vertical', spacing: 'md',
                contents: [
                    row('ห้อง/พื้นที่', String(d.area ?? '-')),
                    row('ประเภทงาน', String(d.work_type_label ?? '-')),
                    row('ความสำคัญ', PRIORITY_TH[priority] ?? priority),
                    row('กำหนดเสร็จ', d.due_date ? String(d.due_date) : 'ไม่ระบุ'),
                    ...(desc ? [{ type: 'separator', margin: 'md' }, { type: 'text', text: desc, size: 'sm', wrap: true, color: '#334155' }] : []),
                ],
            },
            footer: {
                type: 'box', layout: 'vertical',
                contents: [{ type: 'button', style: 'primary', action: { type: 'uri', label: 'ดูงาน', uri: url } }],
            },
        },
    };
}

export function renderMessage(
    event: NotificationEvent,
    data: NotifyData,
    dormName: string,
    url: string,
): RenderedMessage {
    const room = data.room_number ?? '';
    const carrier = data.carrier ? ` (${data.carrier})` : '';
    const where = data.storage_location ? `\nรับได้ที่: ${data.storage_location}` : '';
    switch (event) {
        case 'parcel.received':
            return {
                title: 'มีพัสดุมาถึง',
                body: `📦 ${dormName}\nห้อง ${room} มีพัสดุมาถึง${carrier}${where}\n\nดูรายละเอียด: ${url}`,
            };
        case 'parcel.overdue':
            return {
                title: 'พัสดุค้างรับ',
                body: `⏰ ${dormName}\nห้อง ${room} มีพัสดุค้างรับ${carrier} มาแล้ว ${data.days ?? '?'} วัน${where}\nกรุณามารับพัสดุนะคะ\n\n${url}`,
            };
        case 'shop.closure_submitted':
            return {
                title: 'ร้านค้าแจ้งหยุด',
                body: `🔕 ${dormName}\nแผง ${room} แจ้งหยุด ${data.from_date}${data.to_date && data.to_date !== data.from_date ? ' ถึง ' + data.to_date : ''}${data.reason ? ' (' + data.reason + ')' : ''}`,
            };
        case 'visitor.arriving':
            return {
                title: 'ขาจรแจ้งเข้าขาย',
                body: `🧺 ${dormName}\nขาจร ${data.name ?? ''} แจ้งเข้าขายวันที่ ${data.date ?? ''} (${data.goods ?? ''})`,
            };
        case 'payment.needs_review':
            return {
                title: 'ยอดจาก Payment Gateway ไม่ตรง — ต้องตรวจสอบ',
                body: `💳 ${dormName}\nรหัสอ้างอิง ${data.reference ?? ''}: ควรได้ ${data.expected ?? ''} บาท แต่ได้รับ ${data.received ?? ''} บาท (${data.reason ?? ''})\nระบบยังไม่ตัดยอดให้ — ตรวจสอบและคืนเงิน/รับส่วนต่างด้วยตนเอง`,
            };
        case 'staff.registration_pending':
            return {
                title: 'มีคนลงทะเบียนเป็นช่าง/แม่บ้าน',
                body: `🧑‍🔧 ${dormName}\n${data.name ?? ''} (${data.role_label ?? ''}) ขอลงทะเบียนผ่าน LINE — เข้า ระบบจัดการ → ทีมช่าง/แม่บ้าน เพื่ออนุมัติ`,
            };
        case 'work_order.assigned':
            return {
                title: 'งานใหม่ที่ได้รับมอบหมาย',
                body: `🔧 ${dormName}\nงานใหม่: ${data.area ?? ''} (${data.work_type_label ?? ''})\nความสำคัญ: ${PRIORITY_TH[String(data.priority)] ?? ''}${data.due_date ? `\nกำหนดเสร็จ: ${data.due_date}` : ''}\n\nดูงาน: ${url}`,
                lineMessage: buildWorkOrderFlex(data, dormName, url),
            };
    }
}

export { appBaseUrl } from './_app-url.js';

export async function notify(input: NotifyInput): Promise<NotifyResult> {
    const channels: Record<Channel, ChannelResult> = { line: 'skipped', in_app: 'skipped' };
    try {
        const base = `users/${input.ownerUid}/buildings/${input.buildingId}`;
        const cfgSnap = await db.doc(`${base}/data/config`).get();
        const dormName: string = cfgSnap.data()?.bill_customization?.dorm_name || 'หอพัก';

        let recipient: { line_user_id?: string } | undefined;
        let data = input.data;
        let url = input.url ?? '';
        if (input.lineUserId) {
            recipient = { line_user_id: input.lineUserId };
        } else if (input.roomId) {
            const roomSnap = await db.doc(`${base}/rooms/${input.roomId}`).get();
            const room = roomSnap.data() as { line_user_id?: string; room_number?: string } | undefined;
            recipient = room;
            data = { room_number: room?.room_number, ...input.data };
            url = url || await portalUrlFor(input.ownerUid, input.buildingId, input.roomId);
        }
        const msg = renderMessage(input.event, data, dormName, url);

        for (const ch of decideChannels(recipient)) {
            try {
                if (ch === 'in_app') {
                    const id = randomUUID();
                    await db.doc(`${base}/notifications/${id}`).set({
                        id, event: input.event, room_id: input.roomId ?? null, title: msg.title, body: msg.body,
                        data: JSON.parse(JSON.stringify(input.data)), created_at: new Date().toISOString(), read: false,
                    });
                    channels.in_app = 'sent';
                } else if (ch === 'line') {
                    // Staff have their own LINE OA; tenants use the main one. A LINE user id only
                    // works with the channel it was issued for, so never mix the two.
                    const token = input.lineUserId ? staffLineToken() : process.env.LINE_CHANNEL_ACCESS_TOKEN;
                    // linePush silently no-ops without a token; don't report that as delivered.
                    if (!token) { channels.line = 'skipped'; continue; }
                    await linePush(recipient!.line_user_id!, [msg.lineMessage ?? { type: 'text', text: msg.body }], token);
                    channels.line = 'sent';
                }
            } catch (err) {
                console.error(`[notify] ${input.event} via ${ch} failed:`, (err as Error).message);
                channels[ch] = 'failed';
            }
        }
    } catch (err) {
        console.error('[notify] failed:', (err as Error).message);
    }
    return { channels, delivered: channels.line === 'sent' || channels.in_app === 'sent' };
}
