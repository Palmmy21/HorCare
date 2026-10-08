// HorCare - Activity Log schema, shared by the client helper and the API.

export const AUDIT_ACTIONS = [
  'LOGIN', 'LOGOUT',
  'VIEW', 'CREATE', 'UPDATE', 'DELETE',
  'EXPORT', 'DOWNLOAD',
  'PAYMENT_MODIFY', 'PERMISSION_CHANGE',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ACTION_LABELS_TH: Record<AuditAction, string> = {
  LOGIN: 'เน€เธเนเธฒเธชเธนเนเธฃเธฐเธเธ',
  LOGOUT: 'เธญเธญเธเธเธฒเธเธฃเธฐเธเธ',
  VIEW: 'เน€เธเธดเธ”เธ”เธนเธเนเธญเธกเธนเธฅเธชเธณเธเธฑเธ',
  CREATE: 'เธชเธฃเนเธฒเธ',
  UPDATE: 'เนเธเนเนเธ',
  DELETE: 'เธฅเธ',
  EXPORT: 'เธชเนเธเธญเธญเธ',
  DOWNLOAD: 'เธ”เธฒเธงเธเนเนเธซเธฅเธ”',
  PAYMENT_MODIFY: 'เนเธเนเนเธเธเธฒเธฃเธเธณเธฃเธฐเน€เธเธดเธ',
  PERMISSION_CHANGE: 'เน€เธเธฅเธตเนเธขเธเธชเธดเธ—เธเธดเน',
};

export type AuditResourceType =
  | 'session' | 'room' | 'tenant' | 'meter' | 'bill' | 'payment'
  | 'contract' | 'invitation' | 'member' | 'property' | 'config' | 'parcel' | 'work_order' | 'staff' | 'message' | 'bank_account' | 'bank_transaction' | 'faq' | 'announcement' | 'shop_closure' | 'walkin' | 'security_alert' | 'line_link';

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
