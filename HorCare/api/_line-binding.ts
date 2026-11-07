/**
 * The one place a LINE account gets bound to a room, whichever way it got there (a one-time invitation, the room's
 * permanent QR, or an admin approving a request). Keeps the room, `line_rooms` and the rooms it replaces in step.
 *
 * Two steps because a Firestore transaction reads before it writes: prepareBinding reads, the caller decides whether
 * the binding is allowed, then `commit` writes.
 */
import { admin, db } from './_firebase.js';
import type { LineChannel } from './_line.js';

const del = () => admin.firestore.FieldValue.delete();

interface BindingTarget { lineUserId: string; ownerUid: string; buildingId: string; roomId: string }

export async function prepareBinding(tx: FirebaseFirestore.Transaction, t: BindingTarget) {
    const roomRef = db.doc(`users/${t.ownerUid}/buildings/${t.buildingId}/rooms/${t.roomId}`);
    const linkRef = db.collection('line_rooms').doc(t.lineUserId);
    const roomSnap = await tx.get(roomRef);
    const linkSnap = await tx.get(linkRef);
    const prevLink = linkSnap.exists ? linkSnap.data()! : null;
    const sameRoom = !!prevLink && prevLink.uid === t.ownerUid && prevLink.building_id === t.buildingId && prevLink.room_id === t.roomId;
    const prevRoomRef = prevLink && !sameRoom ? db.doc(`users/${prevLink.uid}/buildings/${prevLink.building_id}/rooms/${prevLink.room_id}`) : null;
    const prevRoomSnap = prevRoomRef ? await tx.get(prevRoomRef) : null;

    const room = roomSnap.exists ? roomSnap.data()! : null;
    const existingLine = room?.line_user_id as string | undefined;
    const replacedExisting = !!existingLine && existingLine !== t.lineUserId;

    return {
        room,
        existingLine,
        /** What this binding changes, for the admin's security alert. */
        effects: {
            replacedExisting,
            movedFromRoomNumber: prevLink && !sameRoom ? String(prevLink.room_number ?? '') || null : null,
            alreadyBound: existingLine === t.lineUserId && sameRoom,
        },
        commit(opts: { channel: LineChannel; dormName: string; dueDay: number; extra?: Record<string, unknown> }) {
            tx.update(roomRef, { line_user_id: t.lineUserId, line_channel: opts.channel, line_unreachable: del() });
            if (replacedExisting) tx.delete(db.collection('line_rooms').doc(existingLine!));
            if (prevRoomRef && prevRoomSnap?.exists && prevRoomSnap.data()?.line_user_id === t.lineUserId) {
                tx.update(prevRoomRef, { line_user_id: del(), line_channel: del(), line_unreachable: del() });
            }
            tx.set(linkRef, {
                uid: t.ownerUid,
                building_id: t.buildingId,
                room_id: t.roomId,
                room_number: room!.room_number,
                dorm_name: opts.dormName,
                due_day: opts.dueDay,
                registered_at: admin.firestore.FieldValue.serverTimestamp(),
                ...opts.extra,
            });
        },
    };
}

/** What a property's tenants see at registration; read outside the transaction since it is display only. */
export async function bindingDisplay(ownerUid: string, buildingId: string, fallbackName = ''): Promise<{ dormName: string; dueDay: number }> {
    const cfg = (await db.doc(`users/${ownerUid}/buildings/${buildingId}/data/config`).get()).data();
    return { dormName: cfg?.bill_customization?.dorm_name || fallbackName, dueDay: cfg?.bill_customization?.due_day ?? 5 };
}
