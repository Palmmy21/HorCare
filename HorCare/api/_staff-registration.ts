/**
 * Registering technicians and housekeepers through the staff LINE Official Account.
 *
 * Two entry points:
 *  • handleStaffChat  – called by the LINE webhook for each text the staff OA receives (no HorCare login; the LINE
 *                       signature already proved the call came from LINE). Runs the conversation in
 *                       src/shared/staffRegistration.ts and stores a pending request.
 *  • default handler  – /api/staff-registration for signed-in managers (work_order.create): connection status,
 *                       the property's registration code, and approving / rejecting requests.
 *
 * Nobody becomes staff, and no LINE account is linked, until a manager approves.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { db } from './_firebase.js';
import { authorize, buildingExists } from './_rbac.js';
import { writeAudit } from './_audit.js';
import { appBaseUrl, notify } from './_notify.js';
import { linePush, staffLineToken } from './_line.js';
import { rateLimitBy } from './_abuse-guard.js';
import {
    MAX_PENDING_PER_PROPERTY, REG_CODE_TTL_DAYS, ROLE_TH, isRegCode, samePhone, sessionExpired, stepRegistration,
    type BotReply, type RegSession, type StaffRegistration,
} from '../src/shared/staffRegistration.js';
import type { WorkStaff } from '../src/shared/workOrders.js';

export const config = { maxDuration: 20 };

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const baseOf = (o: string, b: string) => `users/${o}/buildings/${b}`;
const DAY_MS = 86_400_000;

// ── what the bot says ────────────────────────────────────────────────────────

const quick = (labels: string[]) => ({
    items: labels.map(label => ({ type: 'action', action: { type: 'message', label, text: label } })),
});
const text = (t: string, labels?: string[]) => ({ type: 'text', text: t, ...(labels ? { quickReply: quick(labels) } : {}) });

export const HELP =
    'สวัสดีค่ะ 👋 นี่คือ LINE สำหรับรับงานช่าง/แม่บ้านของ HorCare\n\n' +
    '• ยังไม่ได้ลงทะเบียน: ขอ "รหัสลงทะเบียน" (ขึ้นต้น HCR-) หรือสแกน QR จากผู้จัดการ แล้วพิมพ์ส่งมาในแชทนี้\n' +
    '• ผู้จัดการเพิ่มชื่อคุณไว้แล้ว: พิมพ์ "รหัสเชื่อม LINE" (ขึ้นต้น HCS-) ที่ได้รับ';

export function replyMessages(reply: BotReply): object[] {
    switch (reply.kind) {
        case 'ask_role':
            return [text('เริ่มลงทะเบียนนะคะ 📝\nคุณทำหน้าที่อะไร? (พิมพ์ "ยกเลิก" เมื่อไรก็ได้)', ['ช่าง', 'แม่บ้าน'])];
        case 'ask_name':
            return [text('ชื่อ-นามสกุลของคุณคืออะไรคะ?')];
        case 'ask_phone':
            return [text('เบอร์โทรศัพท์มือถือ (เช่น 0812345678)')];
        case 'ask_confirm':
            return [text(`ตรวจสอบข้อมูลอีกครั้งนะคะ\n\nหน้าที่: ${ROLE_TH[reply.role]}\nชื่อ: ${reply.name}\nเบอร์: ${reply.phone}\n\nถูกต้องไหมคะ?`, ['ใช่', 'แก้ไข', 'ยกเลิก'])];
        case 'retry':
            return [reply.step === 'role' ? text('กรุณาเลือก "ช่าง" หรือ "แม่บ้าน" ค่ะ', ['ช่าง', 'แม่บ้าน'])
                : reply.step === 'name' ? text('ขอชื่อ-นามสกุลเป็นตัวอักษร 2–60 ตัวค่ะ')
                : reply.step === 'phone' ? text('เบอร์โทรไม่ถูกต้อง ขอเป็นเบอร์มือถือ 9–10 หลัก เช่น 0812345678 ค่ะ')
                : text('กรุณาตอบ "ใช่" หรือ "แก้ไข" ค่ะ', ['ใช่', 'แก้ไข', 'ยกเลิก'])];
        case 'cancelled':
            return [text('ยกเลิกการลงทะเบียนแล้วค่ะ หากต้องการเริ่มใหม่ ส่งรหัสลงทะเบียน (HCR-…) มาอีกครั้งได้เลย')];
        case 'submit':
            return [text('ส่งเรื่องให้ผู้จัดการแล้วค่ะ ✅\nเมื่ออนุมัติ ระบบจะแจ้งในแชทนี้ และงานที่ได้รับมอบหมายจะส่งมาที่นี่')];
    }
}

const STATUS_MESSAGES = {
    pending: 'คำขอลงทะเบียนของคุณรอผู้จัดการอนุมัติอยู่ค่ะ ⏳ เมื่ออนุมัติแล้วจะแจ้งในแชทนี้',
    approved: 'คุณลงทะเบียนเรียบร้อยแล้วค่ะ ✅ งานที่ได้รับมอบหมายจะส่งมาที่แชทนี้ ไม่ต้องพิมพ์อะไรเพิ่ม',
    rejected: 'คำขอลงทะเบียนครั้งก่อนไม่ได้รับอนุมัติค่ะ หากต้องการลองใหม่ ขอรหัสลงทะเบียนจากผู้จัดการอีกครั้ง',
} as const;

const CODE_FAILURES: Record<string, string> = {
    invalid: '❌ ไม่พบรหัสนี้ หรือผู้จัดการปิดรหัสไปแล้ว กรุณาขอรหัสใหม่',
    expired: '⌛ รหัสนี้หมดอายุแล้ว กรุณาขอรหัสใหม่จากผู้จัดการ',
    full: '⚠️ ขณะนี้มีคำขอรออนุมัติจำนวนมาก กรุณาแจ้งผู้จัดการ',
    too_many: '⚠️ ลองรหัสผิดหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่',
};

// ── the LINE side ────────────────────────────────────────────────────────────

export interface RegCodeDoc { owner_uid: string; building_id: string; active: boolean; expires_at: number; created_at: string; created_by: string }

/** What to reply to one text message sent to the staff OA (HCS- link codes are handled before this). */
export async function handleStaffChat(lineUserId: string, rawText: string, now: number = Date.now()): Promise<object[]> {
    const t = rawText.trim();

    if (isRegCode(t)) {
        // every code try counts, right or wrong, so the code space cannot be guessed at
        if (!(await rateLimitBy(`line:${lineUserId}`, 'staffreg-code', 10, 3600, now)).ok) return [text(CODE_FAILURES.too_many)];
        const snap = await db.collection('staff_reg_codes').doc(sha256(t.toUpperCase())).get();
        const doc = snap.exists ? (snap.data() as RegCodeDoc) : null;
        if (!doc || !doc.active) return [text(CODE_FAILURES.invalid)];
        if (doc.expires_at <= now) return [text(CODE_FAILURES.expired)];
        if (!(await buildingExists(doc.owner_uid, doc.building_id))) return [text(CODE_FAILURES.invalid)];

        const regs = (await db.collection(`${baseOf(doc.owner_uid, doc.building_id)}/staff_registrations`).where('status', '==', 'pending').get()).docs.map(d => d.data() as StaffRegistration);
        if (regs.some(r => r.line_user_id === lineUserId)) return [text(STATUS_MESSAGES.pending)];
        if (regs.length >= MAX_PENDING_PER_PROPERTY) return [text(CODE_FAILURES.full)];

        const session: RegSession = { line_user_id: lineUserId, owner_uid: doc.owner_uid, building_id: doc.building_id, step: 'role', updated_at: now };
        await db.doc(`staff_reg_sessions/${lineUserId}`).set(session);
        return replyMessages({ kind: 'ask_role' });
    }

    const sessionSnap = await db.doc(`staff_reg_sessions/${lineUserId}`).get();
    const session = sessionSnap.exists ? (sessionSnap.data() as RegSession) : null;
    if (session && !sessionExpired(session, now)) {
        if (!(await rateLimitBy(`line:${lineUserId}`, 'staffreg-turn', 60, 3600, now)).ok) return [text(CODE_FAILURES.too_many)];
        const { session: next, reply } = stepRegistration(session, t, now);
        if (next) await db.doc(`staff_reg_sessions/${lineUserId}`).set(next);
        else await db.doc(`staff_reg_sessions/${lineUserId}`).delete();
        if (reply.kind === 'submit') await submitRegistration(session, reply, now);
        return replyMessages(reply);
    }
    if (session) await db.doc(`staff_reg_sessions/${lineUserId}`).delete(); // expired

    // not in a conversation: tell them where their request stands, if they made one
    const idx = await db.doc(`staff_reg_index/${lineUserId}`).get();
    if (idx.exists) {
        const { owner_uid, building_id, registration_id } = idx.data() as { owner_uid: string; building_id: string; registration_id: string };
        const reg = await db.doc(`${baseOf(owner_uid, building_id)}/staff_registrations/${registration_id}`).get();
        if (reg.exists) return [text(STATUS_MESSAGES[(reg.data() as StaffRegistration).status])];
    }
    return [text(HELP)];
}

async function submitRegistration(s: RegSession, a: Extract<BotReply, { kind: 'submit' }>, now: number): Promise<void> {
    const id = randomUUID();
    const reg: StaffRegistration = {
        id, owner_uid: s.owner_uid, building_id: s.building_id, line_user_id: s.line_user_id,
        role: a.role, name: a.name, phone: a.phone, status: 'pending', created_at: new Date(now).toISOString(),
    };
    await db.doc(`${baseOf(s.owner_uid, s.building_id)}/staff_registrations/${id}`).set(reg);
    await db.doc(`staff_reg_index/${s.line_user_id}`).set({ owner_uid: s.owner_uid, building_id: s.building_id, registration_id: id });
    await notify({ event: 'staff.registration_pending', ownerUid: s.owner_uid, buildingId: s.building_id, data: { name: a.name, role_label: ROLE_TH[a.role], phone: a.phone } });
}

// ── the manager side ─────────────────────────────────────────────────────────

type Action = 'status' | 'code_get' | 'code_rotate' | 'code_revoke' | 'list' | 'approve' | 'reject';
const ACTIONS: Action[] = ['status', 'code_get', 'code_rotate', 'code_revoke', 'list', 'approve', 'reject'];

interface Body { action?: Action; owner_uid?: string; building_id?: string; registration_id?: string; link_staff_id?: string; replace?: boolean; reason?: unknown }

class HttpError extends Error { constructor(public status: number, public code: string) { super(code); } }

/** Basic-ID and webhook of the connected OA, straight from LINE. Best effort: a slow or failing LINE answer is just "unknown". */
async function lineOaInfo(token: string): Promise<{ basic_id: string | null; display_name: string | null; webhook_url: string | null; webhook_active: boolean | null }> {
    const get = async (path: string) => {
        const r = await fetch('https://api.line.me/v2/bot/' + path, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
        return r.ok ? ((await r.json()) as Record<string, unknown>) : null;
    };
    try {
        const [info, hook] = await Promise.all([get('info'), get('channel/webhook/endpoint')]);
        return {
            basic_id: typeof info?.basicId === 'string' ? info.basicId : null,
            display_name: typeof info?.displayName === 'string' ? info.displayName : null,
            webhook_url: typeof hook?.endpoint === 'string' ? hook.endpoint : null,
            webhook_active: typeof hook?.active === 'boolean' ? hook.active : null,
        };
    } catch {
        return { basic_id: null, display_name: null, webhook_url: null, webhook_active: null };
    }
}

function newCode(): string {
    let c = 'HCR-';
    for (let i = 0; i < 8; i++) c += ALPHABET[randomInt(ALPHABET.length)];
    return c;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const body = (req.body ?? {}) as Body;
    const action = body.action;
    const buildingId = body.building_id;
    if (!action || !ACTIONS.includes(action)) { res.status(400).json({ error: 'unknown_action' }); return; }
    if (typeof buildingId !== 'string' || !buildingId) { res.status(400).json({ error: 'building_id is required' }); return; }
    const ctx = await authorize(req, res, { ownerUid: body.owner_uid, buildingId, permission: 'work_order.create' });
    if (!ctx) return;
    if (!(await buildingExists(ctx.ownerUid, buildingId))) { res.status(404).json({ error: 'property_not_found' }); return; }

    const owner = ctx.ownerUid;
    const base = baseOf(owner, buildingId);
    const audit = (act: 'CREATE' | 'UPDATE', id: string, label: string, note: string, extra: object = {}) =>
        writeAudit({ ownerUid: owner, propertyId: buildingId, userId: ctx.uid, userName: ctx.displayName, role: ctx.role, action: act, resourceType: 'staff', resourceId: id, resourceLabel: label, note, req, ...extra });
    const codeRef = db.doc(`${base}/data/staff_reg_code`);
    const regs = async () => (await db.collection(`${base}/staff_registrations`).get()).docs.map(d => d.data() as StaffRegistration);

    try {
        if (action === 'status') {
            const token = staffLineToken();
            const secret = !!process.env.LINE_STAFF_CHANNEL_SECRET;
            const oa = token ? await lineOaInfo(token) : { basic_id: null, display_name: null, webhook_url: null, webhook_active: null };
            const expected = `${appBaseUrl()}/api/line-staff-webhook`;
            res.status(200).json({
                token_set: !!token, secret_set: secret, ...oa, expected_webhook_url: expected,
                webhook_matches: oa.webhook_url === null ? null : oa.webhook_url.replace(/\/$/, '') === expected,
            });
            return;
        }

        if (action === 'code_get' || action === 'code_rotate' || action === 'code_revoke') {
            const current = (await codeRef.get()).data() as { code: string; expires_at: number } | undefined;
            if (action === 'code_get') {
                res.status(200).json({ code: current && current.expires_at > Date.now() ? current.code : null, expires_at: current?.expires_at ?? null });
                return;
            }
            if (current?.code) await db.collection('staff_reg_codes').doc(sha256(current.code)).update({ active: false });
            if (action === 'code_revoke') {
                await codeRef.set({ code: null, expires_at: 0 });
                await audit('UPDATE', buildingId, 'registration code', 'staff registration code revoked');
                res.status(200).json({ code: null });
                return;
            }
            const code = newCode();
            const expires = Date.now() + REG_CODE_TTL_DAYS * DAY_MS;
            const doc: RegCodeDoc = { owner_uid: owner, building_id: buildingId, active: true, expires_at: expires, created_at: new Date().toISOString(), created_by: ctx.uid };
            await db.collection('staff_reg_codes').doc(sha256(code)).set(doc);
            await codeRef.set({ code, expires_at: expires });
            await audit('CREATE', buildingId, 'registration code', 'staff registration code issued');
            res.status(200).json({ code, expires_at: expires });
            return;
        }

        if (action === 'list') {
            const all = await regs();
            const staff = (await db.collection(`${base}/staff`).get()).docs.map(d => d.data() as WorkStaff);
            const pending = all.filter(r => r.status === 'pending').sort((a, b) => a.created_at.localeCompare(b.created_at));
            const recent = all.filter(r => r.status !== 'pending').sort((a, b) => (b.decided_at ?? '').localeCompare(a.decided_at ?? '')).slice(0, 30);
            res.status(200).json({
                pending: pending.map(r => ({ ...r, match: staff.find(s => s.active && samePhone(s.phone, r.phone))?.id ?? null })),
                recent,
            });
            return;
        }

        // approve | reject
        const id = body.registration_id;
        if (typeof id !== 'string' || !id) throw new HttpError(400, 'invalid_input');
        const regRef = db.doc(`${base}/staff_registrations/${id}`);
        const snap = await regRef.get();
        if (!snap.exists) throw new HttpError(404, 'not_found');
        const reg = snap.data() as StaffRegistration;
        if (reg.status !== 'pending') throw new HttpError(409, 'already_decided');
        const now = new Date().toISOString();

        if (action === 'reject') {
            const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 200) : '';
            await regRef.update({ status: 'rejected', decided_at: now, decided_by: ctx.displayName, ...(reason ? { reject_reason: reason } : {}) });
            await audit('UPDATE', id, reg.name, `staff registration rejected${reason ? `: ${reason}` : ''}`);
            await linePush(reg.line_user_id, [text(`คำขอลงทะเบียนไม่ได้รับอนุมัติค่ะ${reason ? `\nเหตุผล: ${reason}` : ''}\nหากสงสัย กรุณาติดต่อผู้จัดการ`)], staffLineToken()).catch(() => undefined);
            res.status(200).json({ ok: true });
            return;
        }

        // approve: a new staff record, or link this LINE account to an existing one (matched by phone, or chosen by the manager)
        let staff: WorkStaff;
        if (body.link_staff_id !== undefined) {
            if (typeof body.link_staff_id !== 'string') throw new HttpError(400, 'invalid_input');
            const s = await db.doc(`${base}/staff/${body.link_staff_id}`).get();
            if (!s.exists || (s.data() as WorkStaff).active === false) throw new HttpError(404, 'staff_not_found');
            staff = s.data() as WorkStaff;
            if (staff.line_user_id && staff.line_user_id !== reg.line_user_id && body.replace !== true) throw new HttpError(409, 'staff_already_linked');
            await db.doc(`${base}/staff/${staff.id}`).update({ line_user_id: reg.line_user_id, linked_at: now });
        } else {
            staff = { id: randomUUID(), name: reg.name, phone: reg.phone, role: reg.role, active: true, line_user_id: reg.line_user_id, linked_at: now, created_at: now };
            await db.doc(`${base}/staff/${staff.id}`).set(staff);
        }
        await regRef.update({ status: 'approved', decided_at: now, decided_by: ctx.displayName, staff_id: staff.id });
        await audit('CREATE', staff.id, staff.name, 'staff approved from LINE registration', { after: { role: staff.role } });
        await linePush(reg.line_user_id, [text(`✅ อนุมัติแล้วค่ะ ยินดีต้อนรับคุณ ${staff.name} (${ROLE_TH[staff.role]})\nงานที่ได้รับมอบหมายจะส่งมาที่แชทนี้`)], staffLineToken()).catch(() => undefined);
        res.status(200).json({ ok: true, staff_id: staff.id });
    } catch (e) {
        if (e instanceof HttpError) { res.status(e.status).json({ error: e.code }); return; }
        console.error('staff-registration error', e);
        res.status(500).json({ error: 'internal_error' });
    }
}
