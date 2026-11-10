/**
 * The one place a LINE account gets bound to a room, whichever way it got there (a one-time invitation, the room's
 * permanent QR, or an admin approving a request). Keeps the room, `line_rooms` and the rooms it replaces in step.
 *
 * One LINE account may hold several rooms (src/shared/lineRooms.ts). `mode` says what a new room means for someone
 * who already has one: 'move' leaves the old room (a tenant changing rooms — the behaviour before several rooms
 * existed), 'add' keeps it (one person paying for several rooms).
 *
 * Two steps because a Firestore transaction reads before it writes: prepareBinding reads, the caller decides whether
 * the binding is allowed, then `commit` writes.
 */
import { admin, db } from './_firebase.js';
import type { LineChannel } from './_line.js';
import {
    addRoom, linkWithRooms, registrationChoice, removeRoom, roomsOfLink, sameRoom, type BindMode, type LinkedRoom,
} from '../src/shared/lineRooms.js';

const del = () => admin.firestore.FieldValue.delete();
const roomRefOf = (r: Pick<LinkedRoom, 'uid' | 'building_id' | 'room_id'>) => db.doc(`users/${r.uid}/buildings/${r.building_id}/rooms/${r.room_id}`);
const linkRefOf = (lineUserId: string) => db.collection('line_rooms').doc(lineUserId);

interface BindingTarget { lineUserId: string; ownerUid: string; buildingId: string; roomId: string; mode?: BindMode }

/** Write a `line_rooms` document for a list of rooms, or delete it when the list is empty. */
function writeLink(tx: FirebaseFirestore.Transaction, lineUserId: string, link: Record<string, unknown> | null, rooms: LinkedRoom[]) {
    const next = linkWithRooms(link, rooms);
    if (next) tx.set(linkRefOf(lineUserId), next);
    else tx.delete(linkRefOf(lineUserId));
}

export async function prepareBinding(tx: FirebaseFirestore.Transaction, t: BindingTarget) {
    const target = { uid: t.ownerUid, building_id: t.buildingId, room_id: t.roomId };
    const roomRef = roomRefOf(target);
    const roomSnap = await tx.get(roomRef);
    const linkSnap = await tx.get(linkRefOf(t.lineUserId));
    const prevLink = linkSnap.exists ? linkSnap.data()! : null;
    const prevRooms = roomsOfLink(prevLink);
    const has = prevRooms.some(r => sameRoom(r, target));
    const choice = registrationChoice(prevRooms, target);
    // several rooms already: one more can only be added; one room and no instruction: the tenant is changing rooms
    const mode: BindMode = choice === 'add' ? 'add' : (t.mode ?? 'move');
    const leaving = !has && mode === 'move' ? prevRooms : [];
    const leavingSnaps = await Promise.all(leaving.map(r => tx.get(roomRefOf(r))));

    const room = roomSnap.exists ? roomSnap.data()! : null;
    const existingLine = room?.line_user_id as string | undefined;
    const replacedExisting = !!existingLine && existingLine !== t.lineUserId;
    // the account that held this room keeps its other rooms
    const replacedSnap = replacedExisting ? await tx.get(linkRefOf(existingLine!)) : null;

    return {
        room,
        existingLine,
        /** Rooms this account holds now, before the binding. */
        currentRooms: prevRooms,
        /** 'ask' = has one other room and the caller gave no mode: find out whether they are moving or adding. */
        choice,
        /** What this binding changes, for the admin's security alert. */
        effects: {
            replacedExisting,
            movedFromRoomNumber: leaving.length > 0 ? String(leaving[0].room_number ?? '') || null : null,
            alreadyBound: existingLine === t.lineUserId && has,
            /** The other rooms this account keeps (an added room), for the alert and the reply. */
            keptRoomNumbers: !has && mode === 'add' ? prevRooms.map(r => r.room_number) : [],
        },
        commit(opts: { channel: LineChannel; dormName: string; dueDay: number; extra?: Record<string, unknown> }) {
            tx.update(roomRef, { line_user_id: t.lineUserId, line_channel: opts.channel, line_unreachable: del() });
            if (replacedExisting) {
                const theirs = replacedSnap?.exists ? replacedSnap.data()! : null;
                writeLink(tx, existingLine!, theirs, removeRoom(roomsOfLink(theirs), target));
            }
            leaving.forEach((r, i) => {
                if (leavingSnaps[i].exists && leavingSnaps[i].data()?.line_user_id === t.lineUserId) {
                    tx.update(roomRefOf(r), { line_user_id: del(), line_channel: del(), line_unreachable: del() });
                }
            });
            const entry: LinkedRoom = { ...target, room_number: String(room!.room_number), dorm_name: opts.dormName, due_day: opts.dueDay };
            const rooms = mode === 'add' || has ? addRoom(prevRooms, entry) : [entry];
            // a first registration, or a move, starts a fresh document (as before); an added room keeps the account's state
            const base = mode === 'add' || has ? prevLink : null;
            tx.set(linkRefOf(t.lineUserId), {
                ...linkWithRooms(base, rooms)!,
                registered_at: admin.firestore.FieldValue.serverTimestamp(),
                ...opts.extra,
            });
        },
    };
}

/**
 * Take one room away from a LINE account (the owner unlinked it, or moved it to another room), inside a transaction
 * that has already read `link`. The account keeps its other rooms; with none left the document goes.
 */
export function unlinkRoomInTx(
    tx: FirebaseFirestore.Transaction, lineUserId: string, link: Record<string, unknown> | null,
    room: Pick<LinkedRoom, 'uid' | 'building_id' | 'room_id'>, replaceWith?: LinkedRoom,
) {
    const rooms = roomsOfLink(link);
    const next = replaceWith ? rooms.map(r => (sameRoom(r, room) ? { ...r, ...replaceWith } : r)) : removeRoom(rooms, room);
    writeLink(tx, lineUserId, link, next);
}

/**
 * The rooms a LINE account can act on right now. With several rooms each is checked against the room itself — a room
 * whose LINE was cleared in the app (a tenant moved out) is dropped from the list here, so its bill is never shown.
 * A single room is returned as stored, exactly as before several rooms existed.
 */
export async function linkedRooms(lineUserId: string): Promise<LinkedRoom[]> {
    const ref = linkRefOf(lineUserId);
    const link = (await ref.get()).data() ?? null;
    const rooms = roomsOfLink(link);
    if (rooms.length <= 1) return rooms;
    const snaps = await Promise.all(rooms.map(r => roomRefOf(r).get()));
    const live = rooms.filter((_, i) => snaps[i].exists && snaps[i].data()?.line_user_id === lineUserId);
    if (live.length !== rooms.length) {
        const next = linkWithRooms(link, live);
        await (next ? ref.set(next) : ref.delete()).catch(() => undefined);
    }
    return live;
}

/** What a property's tenants see at registration; read outside the transaction since it is display only. */
export async function bindingDisplay(ownerUid: string, buildingId: string, fallbackName = ''): Promise<{ dormName: string; dueDay: number }> {
    const cfg = (await db.doc(`users/${ownerUid}/buildings/${buildingId}/data/config`).get()).data();
    return { dormName: cfg?.bill_customization?.dorm_name || fallbackName, dueDay: cfg?.bill_customization?.due_day ?? 5 };
}

/** A registered person added or blocked the OA: keeps every room's "can we reach them" flag true to LINE. Never throws. */
export async function recordFriendship(lineUserId: string, friend: boolean): Promise<void> {
    try {
        const rooms = roomsOfLink((await linkRefOf(lineUserId).get()).data());
        await Promise.all(rooms.map(r => roomRefOf(r).update({ line_unreachable: friend ? del() : true }).catch(() => undefined)));
    } catch (err) {
        console.error('[line-binding] friendship update failed:', (err as Error).message);
    }
}
