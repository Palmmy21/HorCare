/**
 * Central Notification Service.
 *
 * Features raise an *event* ("parcel.received"); this module decides which channels
 * carry it (LINE, in-app, later email/push) and renders the message. Feature code
 * never talks to LINE directly, so adding a channel or changing wording happens here.
 *
 * Never throws: a failed notification must not fail the business action behind it.
 */
import { randomUUID } from 'node:crypto';
import { db } from './_firebase.js';
import { linePush } from './_line.js';

export type NotificationEvent =
    | 'parcel.received'
    | 'parcel.overdue';
// Planned: 'work_order.assigned' | 'invoice.overdue' | 'contract.expiring' | 'shop.closure_submitted' | 'visitor.arriving'

export type Channel = 'line' | 'in_app';
export type ChannelResult = 'sent' | 'failed' | 'skipped';

export interface NotifyInput {
    event: NotificationEvent;
    ownerUid: string;
    buildingId: string;
    /** The tenant's room — recipients are resolved from it, never from a name. */
    roomId: string;
    data: Record<string, string | number | null | undefined>;
}

export interface NotifyResult {
    channels: Record<Channel, ChannelResult>;
    /** True when at least one channel delivered. */
    delivered: boolean;
}

/** Which channels apply for a room. In-app always; LINE only if the room is linked. */
export function decideChannels(room: { line_user_id?: string } | undefined): Channel[] {
    return room?.line_user_id ? ['in_app', 'line'] : ['in_app'];
}

export function renderMessage(
    event: NotificationEvent,
    data: NotifyInput['data'],
    dormName: string,
    portalUrl: string,
): { title: string; body: string } {
    const room = data.room_number ?? '';
    const carrier = data.carrier ? ` (${data.carrier})` : '';
    const where = data.storage_location ? `\nรับได้ที่: ${data.storage_location}` : '';
    switch (event) {
        case 'parcel.received':
            return {
                title: 'มีพัสดุมาถึง',
                body: `📦 ${dormName}\nห้อง ${room} มีพัสดุมาถึง${carrier}${where}\n\nดูรายละเอียด: ${portalUrl}`,
            };
        case 'parcel.overdue':
            return {
                title: 'พัสดุค้างรับ',
                body: `⏰ ${dormName}\nห้อง ${room} มีพัสดุค้างรับ${carrier} มาแล้ว ${data.days ?? '?'} วัน${where}\nกรุณามารับพัสดุนะคะ\n\n${portalUrl}`,
            };
    }
}

export function portalUrlFor(ownerUid: string, buildingId: string, roomId: string): string {
    const base = (process.env.PUBLIC_APP_URL || 'https://hor-care.vercel.app').replace(/\/$/, '');
    return `${base}/?uid=${encodeURIComponent(ownerUid)}&bid=${encodeURIComponent(buildingId)}&rid=${encodeURIComponent(roomId)}`;
}

export async function notify(input: NotifyInput): Promise<NotifyResult> {
    const channels: Record<Channel, ChannelResult> = { line: 'skipped', in_app: 'skipped' };
    try {
        const base = `users/${input.ownerUid}/buildings/${input.buildingId}`;
        const [roomSnap, cfgSnap] = await Promise.all([
            db.doc(`${base}/rooms/${input.roomId}`).get(),
            db.doc(`${base}/data/config`).get(),
        ]);
        const room = roomSnap.data() as { line_user_id?: string; room_number?: string } | undefined;
        const dormName: string = cfgSnap.data()?.bill_customization?.dorm_name || 'หอพัก';
        const msg = renderMessage(
            input.event,
            { room_number: room?.room_number, ...input.data },
            dormName,
            portalUrlFor(input.ownerUid, input.buildingId, input.roomId),
        );

        for (const ch of decideChannels(room)) {
            try {
                if (ch === 'in_app') {
                    const id = randomUUID();
                    await db.doc(`${base}/notifications/${id}`).set({
                        id, event: input.event, room_id: input.roomId, title: msg.title, body: msg.body,
                        data: JSON.parse(JSON.stringify(input.data)), created_at: new Date().toISOString(), read: false,
                    });
                    channels.in_app = 'sent';
                } else if (ch === 'line') {
                    // linePush silently no-ops without a token; don't report that as delivered.
                    if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) { channels.line = 'skipped'; continue; }
                    await linePush(room!.line_user_id!, [{ type: 'text', text: msg.body }]);
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
