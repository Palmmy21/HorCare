// Parcel management — definitions shared by the API and the UI.

export const PARCEL_STATUSES = ['received', 'tenant_notified', 'waiting_pickup', 'picked_up'] as const;
export type ParcelStatus = (typeof PARCEL_STATUSES)[number];

export const PARCEL_STATUS_LABELS_TH: Record<ParcelStatus, string> = {
  received: 'รับพัสดุแล้ว',
  tenant_notified: 'แจ้งผู้เช่าแล้ว',
  waiting_pickup: 'รอรับพัสดุ',
  picked_up: 'รับไปแล้ว',
};

/** Workflow: Received → Tenant Notified → Waiting Pickup → Picked Up (a parcel may skip ahead, never back). */
const NEXT: Record<ParcelStatus, ParcelStatus[]> = {
  received: ['tenant_notified', 'waiting_pickup', 'picked_up'],
  tenant_notified: ['waiting_pickup', 'picked_up'],
  waiting_pickup: ['picked_up'],
  picked_up: [],
};

export function canTransition(from: ParcelStatus, to: ParcelStatus): boolean {
  return NEXT[from]?.includes(to) ?? false;
}

export function isParcelStatus(v: unknown): v is ParcelStatus {
  return typeof v === 'string' && (PARCEL_STATUSES as readonly string[]).includes(v);
}

export const CARRIERS = [
  'Kerry Express', 'Flash Express', 'J&T Express', 'Thailand Post', 'Shopee Express',
  'Lazada Express', 'Best Express', 'SCG Express', 'DHL', 'ไปรษณีย์/อื่นๆ',
] as const;

/** What the AI read off a shipping label (POST /api/parcels action read_label). Every field is a suggestion for staff to confirm. */
export interface ParcelLabelOcr {
  carrier: string | null;
  tracking_number: string | null;
  recipient_name: string | null;
  /** The recipient's phone as printed (may be partly masked, e.g. 08x-xxx-1234). */
  recipient_phone?: string | null;
  /** Room / unit number found in the address, as printed. */
  room_number: string | null;
  /** 0..1 */
  confidence: number;
}

/** read_label's answer: what the label says, and the room that fits it (from the label's room, else the name / phone). */
export interface ParcelLabelResult { data: ParcelLabelOcr; match: RoomSuggestion | null; candidates: { room_id: string; room_number: string; tenant_name: string | null }[] }

const CARRIER_ALIASES: [RegExp, (typeof CARRIERS)[number]][] = [
  [/kerry|เคอรี่/i, 'Kerry Express'],
  [/flash|แฟลช/i, 'Flash Express'],
  [/j\s*&\s*t|j\s*and\s*t|เจแอนด์ที/i, 'J&T Express'],
  [/thailand\s*post|thai\s*post|ไปรษณีย์ไทย|\bems\b/i, 'Thailand Post'],
  [/shopee|spx|ช้อปปี้/i, 'Shopee Express'],
  [/lazada|\blex\b|ลาซาด้า/i, 'Lazada Express'],
  [/best\s*express|\bbest\b/i, 'Best Express'],
  [/scg|nim\s*express|นิ่ม/i, 'SCG Express'],
  [/\bdhl\b/i, 'DHL'],
];

/** Map a carrier name read from a label onto CARRIERS; null when it is not one we list. */
export function matchCarrier(name: string | null | undefined): (typeof CARRIERS)[number] | null {
  if (!name) return null;
  return CARRIER_ALIASES.find(([re]) => re.test(name))?.[1] ?? null;
}

const roomKey = (s: string) => s.toLowerCase().replace(/^(ห้อง|room|rm\.?|unit|#)\s*/i, '').replace(/[\s\-_.]/g, '');

/** Find the active room whose number equals the one read from a label (ignoring "ห้อง", spaces, dashes and case). */
export function matchLabelRoom<R extends { id: string; room_number: string; is_active?: boolean }>(
  printed: string | null | undefined, rooms: R[],
): R | null {
  if (!printed) return null;
  const key = roomKey(printed);
  if (!key) return null;
  const hits = rooms.filter(r => r.is_active !== false && roomKey(r.room_number) === key);
  return hits.length === 1 ? hits[0] : null;
}

// ── Who is this parcel for? (no room on the label) ──────────────────────────
//
// A label often carries a name (and a phone, partly masked) but no room. The name is matched against the tenants:
// titles, spaces and punctuation are ignored, first + last name both matching is strong, a nickname or a first name
// alone is weaker, and the phone's last 4 digits confirm or decide. Only a clear winner is offered — and only as a
// suggestion: a person confirms the room before anything is saved.

/** One tenant as the matcher sees them. */
export interface RecipientCandidate { room_id: string; room_number: string; full_name?: string | null; nickname?: string | null; phone?: string | null }

/** How a parcel's room was suggested. */
export interface RoomSuggestion {
  room_id: string;
  room_number: string;
  tenant_name: string | null;
  by: 'label_room' | 'name' | 'phone' | 'ai';
  /** 0..1 */
  confidence: number;
}

const TITLES = /^(นางสาว|น\.ส\.|นส\.|นาย|นาง|ด\.ช\.|ด\.ญ\.|คุณ|ดร\.|mr\.?|mrs\.?|ms\.?|miss|dr\.?|k\.|khun)\s*/i;

/** The name's words, lowercase, without titles and punctuation: "นางสาว สมศรี  ใจดี" → ["สมศรี", "ใจดี"]. */
export function nameWords(name: string | null | undefined): string[] {
  if (!name) return [];
  let s = name.normalize('NFC').toLowerCase().replace(/[()[\]{}"'.,/\\|:;_*-]+/g, ' ').trim();
  for (let i = 0; i < 3 && TITLES.test(s); i++) s = s.replace(TITLES, '').trim();
  return s.split(/\s+/).map(w => w.replace(TITLES, '')).filter(w => w.length >= 2);
}

/** The digits a label shows of a phone ("08x-xxx-1234" → "1234"); null when fewer than 4 are readable at the end. */
export function phoneTail(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const m = phone.replace(/[\s-]/g, '').match(/(\d{4})$/);
  return m ? m[1] : null;
}

function nameScore(label: string[], c: RecipientCandidate): number {
  if (!label.length) return 0;
  const full = nameWords(c.full_name);
  const nick = nameWords(c.nickname);
  if (!full.length && !nick.length) return 0;
  const joined = (w: string[]) => w.join('');
  if (full.length && joined(label) === joined(full)) return 1;
  const has = (w: string) => full.includes(w);
  const first = full[0], last = full.length > 1 ? full[full.length - 1] : null;
  if (first && last && has(label[0]) && label.includes(first) && label.includes(last)) return 0.95;
  if (first && label[0] === first) return last && label.length > 1 && label[label.length - 1] !== last ? 0.4 : 0.7;   // same first name, other surname: weak
  if (nick.length && label.some(w => nick.includes(w))) return 0.6;
  if (last && label.includes(last)) return 0.5;
  // one word containing the other (a long name cut short on the label)
  if (label.some(w => w.length >= 3 && full.some(f => f.length >= 3 && (f.startsWith(w) || w.startsWith(f))))) return 0.5;
  return 0;
}

/**
 * The tenant a label's name / phone points to, or null when nobody clearly stands out (`candidates` then lists the
 * likely ones, best first). Clear = a score of 0.7 or more and at least 0.15 ahead of the next.
 */
export function matchRecipient(
  name: string | null | undefined, phone: string | null | undefined, tenants: RecipientCandidate[],
): { match: RoomSuggestion | null; candidates: RecipientCandidate[] } {
  const words = nameWords(name);
  const tail = phoneTail(phone);
  const scored = tenants.map(c => {
    let s = nameScore(words, c);
    const phoneHit = !!tail && phoneTail(c.phone) === tail;
    if (phoneHit) s = s > 0 ? Math.min(1, s + 0.3) : (words.length ? 0.55 : 0.75);   // a phone alone, with no name, still says a lot
    return { c, s, phoneHit };
  }).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
  const [best, next] = scored;
  const candidates = scored.filter(x => x.s >= 0.4).slice(0, 5).map(x => x.c);
  if (!best || best.s < 0.7 || (next && best.s - next.s < 0.15)) return { match: null, candidates };
  return {
    match: { room_id: best.c.room_id, room_number: best.c.room_number, tenant_name: best.c.full_name ?? null, by: best.phoneHit && nameScore(words, best.c) < 0.7 ? 'phone' : 'name', confidence: Math.round(best.s * 100) / 100 },
    candidates,
  };
}

/** A parcel nobody has put in a room yet (saved with what was known; a room is chosen later). */
export const hasRoom = (p: Pick<Parcel, 'room_id'>): boolean => !!p.room_id;

export interface Parcel {
  id: string;
  organization_id: string;
  property_id: string;
  /** '' while nobody has chosen the room (saved with what was known — hasRoom()). */
  room_id: string;
  room_number: string;
  /** Tenant assignment of the room at the time (profile id = room id). Set when a person confirms the room. */
  tenant_id: string;
  tenant_name: string | null;
  /** Free-text name printed on the label; informational only. */
  recipient_name: string | null;
  /** Phone as printed on the label (often masked); helps find the tenant. */
  recipient_phone?: string | null;
  /** A room the system thinks fits the label (name / phone) — shown to staff to confirm, never applied by itself. */
  suggested_room?: RoomSuggestion | null;
  carrier: string;
  tracking_number: string | null;
  storage_location: string | null;
  note: string | null;
  has_image: boolean;
  status: ParcelStatus;
  received_at: string;
  received_by: string;
  received_by_name: string;
  picked_up_at: string | null;
  picked_up_by: string | null;
  picked_up_by_name: string | null;
  notified_at: string | null;
  notify_channels: Record<string, 'sent' | 'failed' | 'skipped'> | null;
  last_reminded_at: string | null;
  reminder_count: number;
  created_at: string;
}

/** What the tenant portal may see: no tracking number, label name or photo. */
export interface TenantParcelView {
  id: string;
  carrier: string;
  status: ParcelStatus;
  received_at: string;
  storage_location: string | null;
  picked_up_at: string | null;
}

export const REMIND_AFTER_DAYS = 3;
export const REMIND_EVERY_DAYS = 3;
export const MAX_REMINDERS = 5;

/** Should the daily job nudge the tenant about this parcel? */
export function isDueForReminder(
  p: Pick<Parcel, 'status' | 'received_at' | 'last_reminded_at' | 'reminder_count'>,
  now: number = Date.now(),
): boolean {
  if (p.status !== 'tenant_notified' && p.status !== 'waiting_pickup') return false;
  if ((p.reminder_count ?? 0) >= MAX_REMINDERS) return false;
  const day = 86400_000;
  const received = Date.parse(p.received_at);
  if (!Number.isFinite(received) || now - received < REMIND_AFTER_DAYS * day) return false;
  if (p.last_reminded_at) {
    const last = Date.parse(p.last_reminded_at);
    if (Number.isFinite(last) && now - last < REMIND_EVERY_DAYS * day) return false;
  }
  return true;
}
