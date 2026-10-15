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
  /** Room / unit number found in the address, as printed. */
  room_number: string | null;
  /** 0..1 */
  confidence: number;
}

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

export interface Parcel {
  id: string;
  organization_id: string;
  property_id: string;
  room_id: string;
  room_number: string;
  /** Tenant assignment of the room at the time (profile id = room id). Never inferred from a name. */
  tenant_id: string;
  tenant_name: string | null;
  /** Free-text name printed on the label; informational only. */
  recipient_name: string | null;
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
