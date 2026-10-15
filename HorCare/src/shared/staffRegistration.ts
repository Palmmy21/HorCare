// Registering technicians and housekeepers through the staff LINE Official Account.
//
// Flow: the manager shows a property's registration code (HCR-…) as a QR / link → the person adds the OA and sends the code
// → the bot asks role, name and phone one step at a time → the request waits for the manager → on approval the staff record
// exists, their LINE is linked, and job notifications start arriving in the same chat.
// The conversation rules are pure so they can be tested without LINE; the server only stores the state and replies.
import { cleanPhone } from './leasing.js';
import type { StaffRole } from './workOrders.js';

export const REG_CODE_RE = /^HCR-[A-HJ-NP-Z2-9]{8}$/;
export const isRegCode = (t: string) => REG_CODE_RE.test(t.trim().toUpperCase());
export const REG_CODE_TTL_DAYS = 30;
export const MAX_PENDING_PER_PROPERTY = 50;
export const SESSION_TTL_MS = 30 * 60 * 1000;

export type RegStep = 'role' | 'name' | 'phone' | 'confirm';

export interface RegSession {
  line_user_id: string;
  owner_uid: string;
  building_id: string;
  step: RegStep;
  role?: StaffRole;
  name?: string;
  phone?: string;
  updated_at: number;
}

export type RegistrationStatus = 'pending' | 'approved' | 'rejected';

/** users/{owner}/buildings/{b}/staff_registrations/{id} */
export interface StaffRegistration {
  id: string;
  owner_uid: string;
  building_id: string;
  line_user_id: string;
  role: StaffRole;
  name: string;
  phone: string;
  status: RegistrationStatus;
  created_at: string;
  decided_at?: string;
  decided_by?: string;
  reject_reason?: string;
  /** The staff record this person became (new, or an existing one matched by phone). */
  staff_id?: string;
}

const ROLE_WORDS: Record<StaffRole, string[]> = {
  technician: ['ช่าง', 'ช่างซ่อม', 'technician', '1', 'role:technician'],
  housekeeping: ['แม่บ้าน', 'แม่บ้านทำความสะอาด', 'housekeeping', 'housekeeper', '2', 'role:housekeeping'],
};

export function parseRole(text: string): StaffRole | null {
  const t = text.trim().toLowerCase();
  for (const role of Object.keys(ROLE_WORDS) as StaffRole[]) if (ROLE_WORDS[role].includes(t)) return role;
  return null;
}

/** A person's name: 2–60 characters, no digits-only or symbol-only answers. */
export function cleanPersonName(text: string): string | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 60) return null;
  if (!/[A-Za-zก-๙]/.test(t) || /[<>{}\\]/.test(t)) return null;
  return t;
}

export const CANCEL_WORDS = ['ยกเลิก', 'cancel', 'ออก'];
export const isCancel = (t: string) => CANCEL_WORDS.includes(t.trim().toLowerCase());

export const ROLE_TH: Record<StaffRole, string> = { technician: 'ช่าง', housekeeping: 'แม่บ้าน' };

export type BotReply =
  | { kind: 'ask_role' }
  | { kind: 'ask_name' }
  | { kind: 'ask_phone' }
  | { kind: 'ask_confirm'; role: StaffRole; name: string; phone: string }
  | { kind: 'retry'; step: RegStep }
  | { kind: 'cancelled' }
  | { kind: 'submit'; role: StaffRole; name: string; phone: string };

/**
 * One turn of the registration conversation. Returns the next state (null = the conversation is over) and what to say.
 * "ยกเลิก" works at every step; a wrong answer repeats the question instead of failing.
 */
export function stepRegistration(session: RegSession, text: string, now: number = Date.now()): { session: RegSession | null; reply: BotReply } {
  if (isCancel(text)) return { session: null, reply: { kind: 'cancelled' } };
  const next = (patch: Partial<RegSession>): RegSession => ({ ...session, ...patch, updated_at: now });
  switch (session.step) {
    case 'role': {
      const role = parseRole(text);
      return role ? { session: next({ role, step: 'name' }), reply: { kind: 'ask_name' } } : { session, reply: { kind: 'retry', step: 'role' } };
    }
    case 'name': {
      const name = cleanPersonName(text);
      return name ? { session: next({ name, step: 'phone' }), reply: { kind: 'ask_phone' } } : { session, reply: { kind: 'retry', step: 'name' } };
    }
    case 'phone': {
      const phone = cleanPhone(text);
      return typeof phone === 'string'
        ? { session: next({ phone, step: 'confirm' }), reply: { kind: 'ask_confirm', role: session.role!, name: session.name!, phone } }
        : { session, reply: { kind: 'retry', step: 'phone' } };
    }
    case 'confirm': {
      const t = text.trim().toLowerCase();
      if (['ใช่', 'ยืนยัน', 'ถูกต้อง', 'ok', 'yes', 'confirm'].includes(t)) return { session: null, reply: { kind: 'submit', role: session.role!, name: session.name!, phone: session.phone! } };
      if (['แก้ไข', 'ไม่', 'ไม่ถูก', 'no', 'edit'].includes(t)) return { session: next({ step: 'role', role: undefined, name: undefined, phone: undefined }), reply: { kind: 'ask_role' } };
      return { session, reply: { kind: 'ask_confirm', role: session.role!, name: session.name!, phone: session.phone! } };
    }
  }
}

export const sessionExpired = (s: Pick<RegSession, 'updated_at'>, now: number = Date.now()) => now - s.updated_at > SESSION_TTL_MS;

/** Two phone numbers are the same person's when their digits match (0812345678 = 081-234-5678). */
export const samePhone = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.replace(/\D/g, '') === b.replace(/\D/g, '');
