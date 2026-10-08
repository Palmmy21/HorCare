// HorCare - Activity Log schema, shared by the client helper and the API.

export const AUDIT_ACTIONS = [
  'LOGIN', 'LOGOUT',
  'VIEW', 'CREATE', 'UPDATE', 'DELETE',
  'EXPORT', 'DOWNLOAD',
  'PAYMENT_MODIFY', 'PERMISSION_CHANGE',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ACTION_LABELS_TH: Record<AuditAction, string> = {
  LOGIN: 'เข้าสู่ระบบ',
  LOGOUT: 'ออกจากระบบ',
  VIEW: 'เปิดดูข้อมูลสำคัญ',
  CREATE: 'สร้าง',
  UPDATE: 'แก้ไข',
  DELETE: 'ลบ',
  EXPORT: 'ส่งออก',
  DOWNLOAD: 'ดาวน์โหลด',
  PAYMENT_MODIFY: 'แก้ไขการชำระเงิน',
  PERMISSION_CHANGE: 'เปลี่ยนสิทธิ์',
};

export type AuditResourceType =
  | 'session' | 'room' | 'tenant' | 'meter' | 'bill' | 'payment'
  | 'contract' | 'invitation' | 'member' | 'property' | 'config' | 'parcel' | 'work_order' | 'staff' | 'message' | 'bank_account' | 'faq' | 'announcement'
  | 'bank_transaction' | 'shop_closure' | 'walkin' | 'security_alert' | 'line_link' | 'accounting_profile' | 'accounting_export' | 'ledger' | 'journal_entry' | 'lead' | 'lease';

export interface AuditEntry {
  event_id: string;
  organization_id: string;
  property_id: string | null;
  user_id: string;
  user_name: string;
  role: string;
  action: AuditAction;
  resource_type: AuditResourceType;
  resource_id: string | null;
  /** Human readable label, e.g. "Room 305". */
  resource_label?: string | null;
  timestamp: string;     // ISO
  timestamp_ms: number;  // for ordering / range queries
  ip_address?: string | null;
  user_agent?: string | null;
  before?: unknown;
  after?: unknown;
  note?: string | null;
}
