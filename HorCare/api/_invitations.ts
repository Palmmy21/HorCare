import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash, randomInt } from 'node:crypto';
import { db } from './_firebase.js';
import { channelAllowsOwner, currentLineChannel } from './_line.js';
import { propertyOaId } from './_line-oa.js';
import { authorize } from './_rbac.js';
import { writeAudit } from './_audit.js';
import { raiseBindingAlert } from './_security-alerts.js';
import { bindingDisplay, prepareBinding } from './_line-binding.js';

export const config = { maxDuration: 15 };

// Top-level collection `invitations/{sha256(token)}` — backend only (rules deny all
// client access). Only the hash is stored, so a database leak does not leak usable codes.
const COLLECTION = 'invitations';
const TOKEN_PREFIX = 'HCI-';
const TOKEN_RE = /^HCI-[A-HJ-NP-Z2-9]{10}$/;
// No 0/O/1/I so a code read aloud or typed by hand can't be misread.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const DEFAULT_TTL_HOURS = 72;
const MAX_TTL_HOURS = 24 * 30;
const SLOTS = 'invitation_slots';
const slotPath = (ownerUid: string, buildingId: string, roomId: string) => `users/${ownerUid}/buildings/${buildingId}/${SLOTS}/${roomId}`;
/** One live code per room; the room id is a single path segment, so a forged one can't reach another path. */
const isRoomId = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 128 && !x.includes('/');

export function isInvitationToken(text: string): boolean {
    return TOKEN_RE.test(text.trim().toUpperCase());
}

function hashToken(token: string): string {
    return createHash('sha256').update(token.trim().toUpperCase()).digest('hex');
}

function generateToken(): string {
    let out = '';
    for (let i = 0; i < 10; i++) out += ALPHABET[randomInt(ALPHABET.length)];
    return TOKEN_PREFIX + out;
}

export type RedeemResult =
    | { ok: true; ownerUid: string; buildingId: string; roomId: string; roomNumber: string; dormName: string;
          /** What this binding changed — drives the admin's security alert. */
          replacedExisting: boolean; movedFromRoomNumber: string | null; alreadyBound: boolean }
    | { ok: false; reason: 'not_found' | 'expired' | 'used' | 'revoked' | 'room_unavailable' | 'room_taken' };

/**
 * Bind a LINE user to the room named by an invitation. The room id comes from the
 * invitation document the owner created — the tenant never supplies it, so a tenant
 * cannot claim a different room by typing a different number.
 *
 * Runs in a transaction so a one-time code cannot be redeemed twice concurrently.
 */
export async function redeemInvitation(lineUserId: string, rawToken: string): Promise<RedeemResult> {
    if (!isInvitationToken(rawToken)) return { ok: false, reason: 'not_found' };
    const inviteRef = db.collection(COLLECTION).doc(hashToken(rawToken));

    // Looked up outside the transaction purely for display/billing metadata.
    const preview = await inviteRef.get();
    if (!preview.exists) return { ok: false, reason: 'not_found' };
    const p = preview.data()!;
    if (!channelAllowsOwner(p.owner_uid)) return { ok: false, reason: 'not_found' };
    const { dormName, dueDay } = await bindingDisplay(p.owner_uid, p.building_id, p.dorm_name);

    const result = await db.runTransaction<RedeemResult>(async (tx) => {
        const inviteSnap = await tx.get(inviteRef);
        if (!inviteSnap.exists) return { ok: false, reason: 'not_found' };
        const inv = inviteSnap.data()!;

        if (inv.status === 'revoked') return { ok: false, reason: 'revoked' };
        if (inv.expires_at <= Date.now()) return { ok: false, reason: 'expired' };
        // Re-scanning your own code is harmless; anyone else is blocked once used up.
        const sameUser = inv.used_by_line_user === lineUserId;
        if (!sameUser && (inv.status === 'used' || inv.use_count >= inv.max_uses)) return { ok: false, reason: 'used' };

        const binding = await prepareBinding(tx, { lineUserId, ownerUid: inv.owner_uid, buildingId: inv.building_id, roomId: inv.room_id });
        const slotRef = db.doc(slotPath(inv.owner_uid, inv.building_id, inv.room_id));
        const slotSnap = await tx.get(slotRef);
        if (!binding.room || binding.room.is_active === false) return { ok: false, reason: 'room_unavailable' };
        if (binding.effects.replacedExisting && !inv.replace_existing) return { ok: false, reason: 'room_taken' };

        // ── all reads done; writes below ──
        binding.commit({ channel: currentLineChannel(), dormName, dueDay, extra: { invitation_id: inviteRef.id } });
        const nextUse = sameUser ? inv.use_count : inv.use_count + 1;
        tx.update(inviteRef, {
            use_count: nextUse,
            status: nextUse >= inv.max_uses ? 'used' : 'active',
            used_by_line_user: lineUserId,
            used_at: new Date().toISOString(),
        });
        // codes issued before slots existed have none; a newer code owns the slot if there is one
        if (slotSnap.data()?.invitation_id === inviteRef.id) {
            tx.update(slotRef, { status: nextUse >= inv.max_uses ? 'used' : 'active', used_at: new Date().toISOString() });
        }
        return {
            ok: true, ownerUid: inv.owner_uid, buildingId: inv.building_id,
            roomId: inv.room_id, roomNumber: binding.room.room_number, dormName, ...binding.effects,
        };
    });

    if (result.ok) {
        if (!result.alreadyBound) {
            await raiseBindingAlert(result.ownerUid, result.buildingId, {
                roomId: result.roomId, roomNumber: result.roomNumber, lineUserId, via: 'invitation',
                replacedExisting: result.replacedExisting, movedFromRoomNumber: result.movedFromRoomNumber,
            });
        }
        await writeAudit({
            ownerUid: result.ownerUid, propertyId: result.buildingId,
            userId: `line:${lineUserId}`, role: 'tenant', action: 'UPDATE',
            resourceType: 'invitation', resourceId: inviteRef.id,
            resourceLabel: `Room ${result.roomNumber}`, note: 'invitation redeemed (LINE)',
        });
    }
    return result;
}

interface Body {
    action?: 'create' | 'list' | 'revoke';
    owner_uid?: string;
    building_id?: string;
    room_id?: string;
    tenant_name?: string;
    expires_in_hours?: number;
    one_time?: boolean;
    replace_existing?: boolean;
    invitation_id?: string;
}

/** Writes one room's new code and makes it the room's only live one: the code it replaces can no longer be redeemed. */
function issueCode(tx: FirebaseFirestore.Transaction, ctx: { ownerUid: string; uid: string }, buildingId: string, roomId: string,
    prevSlot: FirebaseFirestore.DocumentData | undefined, token: string,
    invitation: Record<string, unknown> & { room_number: string; expires_at: number; created_at: string }) {
    const id = hashToken(token);
    if (prevSlot?.status === 'active' && prevSlot.invitation_id) {
        tx.set(db.collection(COLLECTION).doc(prevSlot.invitation_id), {
            status: 'revoked', revoked_at: invitation.created_at, revoked_by: ctx.uid, revoked_reason: 'reissued',
        }, { merge: true });
    }
    tx.set(db.collection(COLLECTION).doc(id), invitation);
    tx.set(db.doc(slotPath(ctx.ownerUid, buildingId, roomId)), {
        room_id: roomId, invitation_id: id, status: 'active', expires_at: invitation.expires_at, issued_at: invitation.created_at,
    });
}

/** Owner/staff-facing: create, list and revoke room invitations. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const body = (req.body ?? {}) as Body;
    const buildingId = body.building_id;
    if (!buildingId || typeof buildingId !== 'string') { res.status(400).json({ error: 'building_id is required' }); return; }

    if (body.action === 'list') {
        const ctx = await authorize(req, res, { ownerUid: body.owner_uid, buildingId, permission: 'invitation.read' });
        if (!ctx) return;
        // Equality filters only, so Firestore serves this from single-field indexes; sorted in memory. Scoping to the room
        // is what keeps one room's history right in a property with thousands of codes.
        let query = db.collection(COLLECTION).where('owner_uid', '==', ctx.ownerUid).where('building_id', '==', buildingId);
        if (isRoomId(body.room_id)) query = query.where('room_id', '==', body.room_id);
        const snap = await query.get();
        const invitations = snap.docs
            .map(d => ({ id: d.id, ...d.data() }) as unknown as Record<string, unknown> & { created_at: string })
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .slice(0, 200);
        res.status(200).json({ invitations });
        return;
    }

    if (body.action === 'revoke') {
        const ctx = await authorize(req, res, { ownerUid: body.owner_uid, buildingId, permission: 'invitation.create' });
        if (!ctx) return;
        if (!body.invitation_id) { res.status(400).json({ error: 'invitation_id is required' }); return; }
        const ref = db.collection(COLLECTION).doc(body.invitation_id);
        const snap = await ref.get();
        // Same 404 for "missing" and "someone else's" so ids can't be probed.
        if (!snap.exists || snap.data()?.owner_uid !== ctx.ownerUid || snap.data()?.building_id !== buildingId) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        await ref.update({ status: 'revoked', revoked_at: new Date().toISOString(), revoked_by: ctx.uid });
        const slotRef = db.doc(slotPath(ctx.ownerUid, buildingId, String(snap.data()?.room_id)));
        if ((await slotRef.get()).data()?.invitation_id === ref.id) await slotRef.update({ status: 'revoked' });
        await writeAudit({
            ownerUid: ctx.ownerUid, propertyId: buildingId, userId: ctx.uid, userName: ctx.displayName, role: ctx.role,
            action: 'DELETE', resourceType: 'invitation', resourceId: ref.id,
            resourceLabel: `Room ${snap.data()?.room_number}`, note: 'invitation revoked', req,
        });
        res.status(200).json({ ok: true });
        return;
    }

    if (body.action === 'create') {
        const ctx = await authorize(req, res, { ownerUid: body.owner_uid, buildingId, permission: 'invitation.create' });
        if (!ctx) return;
        const roomId = body.room_id;
        if (!roomId || typeof roomId !== 'string') { res.status(400).json({ error: 'room_id is required' }); return; }

        const roomSnap = await db.doc(`users/${ctx.ownerUid}/buildings/${buildingId}/rooms/${roomId}`).get();
        if (!roomSnap.exists || roomSnap.data()?.is_active === false) {
            res.status(404).json({ error: 'room_not_found' });
            return;
        }
        const room = roomSnap.data()!;

        // The room must have a tenant assigned: either a saved profile or an explicit name.
        const profileSnap = await db.doc(`users/${ctx.ownerUid}/buildings/${buildingId}/tenants/${roomId}`).get();
        const tenantName = (body.tenant_name ?? '').trim() || (profileSnap.data()?.full_name as string | undefined) || '';
        if (!tenantName) {
            res.status(400).json({ error: 'tenant_required', message: 'ระบุชื่อผู้เช่า หรือบันทึกโปรไฟล์ผู้เช่าของห้องนี้ก่อน' });
            return;
        }

        const replace = body.replace_existing === true;
        if (room.line_user_id && !replace) {
            res.status(409).json({ error: 'room_already_registered', message: 'ห้องนี้มีผู้ลงทะเบียน LINE แล้ว' });
            return;
        }

        const ttl = Math.min(Math.max(Number(body.expires_in_hours) || DEFAULT_TTL_HOURS, 1), MAX_TTL_HOURS);
        const oneTime = body.one_time !== false;
        const token = generateToken();
        const now = Date.now();
        const cfgSnap = await db.doc(`users/${ctx.ownerUid}/buildings/${buildingId}/data/config`).get();

        const slotRef = db.doc(slotPath(ctx.ownerUid, buildingId, roomId));
        await db.runTransaction(async tx => {
            const slotSnap = await tx.get(slotRef);
            issueCode(tx, ctx, buildingId, roomId, slotSnap.data(), token, {
                owner_uid: ctx.ownerUid,
                building_id: buildingId,
                room_id: roomId,
                room_number: room.room_number,
                tenant_name: tenantName,
                dorm_name: cfgSnap.data()?.bill_customization?.dorm_name ?? '',
                one_time: oneTime,
                max_uses: oneTime ? 1 : 25,
                use_count: 0,
                replace_existing: replace,
                status: 'active',
                created_at: new Date(now).toISOString(),
                created_by: ctx.uid,
                expires_at: now + ttl * 3600 * 1000,
            });
        });
        await writeAudit({
            ownerUid: ctx.ownerUid, propertyId: buildingId, userId: ctx.uid, userName: ctx.displayName, role: ctx.role,
            action: 'CREATE', resourceType: 'invitation', resourceId: hashToken(token).slice(0, 12),
            resourceLabel: `Room ${room.room_number}`, after: { tenant_name: tenantName, one_time: oneTime, ttl_hours: ttl }, req,
        });
        // The plaintext code is returned exactly once.
        res.status(200).json({ code: token, expires_at: now + ttl * 3600 * 1000, one_time: oneTime, room_number: room.room_number, oa_id: await propertyOaId(ctx.ownerUid, buildingId) });
        return;
    }

    res.status(400).json({ error: 'unknown_action' });
}
