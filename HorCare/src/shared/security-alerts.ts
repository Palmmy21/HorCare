// Security alerts shown on the Security page. Raised by the server when something changes who can
// act as a tenant — chiefly when a LINE account is bound to a room — so an admin can spot a wrong
// or suspicious binding quickly. Stored per property: users/{owner}/buildings/{b}/security_alerts/{id}.

export type AlertType = 'line_bound' | 'line_replaced' | 'line_moved';
export type AlertVia = 'invitation' | 'room_number';

export interface SecurityAlert {
  id: string;
  type: AlertType;
  severity: 'info' | 'warning';
  room_id: string;
  room_number: string;
  /** Set when the LINE account was previously bound to another room. */
  from_room_number: string | null;
  /** Last 4 characters of the LINE user id — enough to tell accounts apart, not enough to use. */
  line_ref: string;
  via: AlertVia;
  message: string;
  status: 'open' | 'acknowledged';
  created_at: string;
  ack_by?: string;
  ack_at?: string;
}

export const ALERT_TYPE_LABELS_TH: Record<AlertType, string> = {
  line_bound: 'ผูก LINE กับห้องใหม่',
  line_replaced: 'เปลี่ยนบัญชี LINE ของห้อง',
  line_moved: 'บัญชี LINE ย้ายห้อง',
};

export interface BindingEvent {
  roomNumber: string;
  /** The room already had a different LINE account, which this binding replaced. */
  replacedExisting: boolean;
  /** The LINE account used to belong to this other room. */
  movedFromRoomNumber: string | null;
  via: AlertVia;
}

/** Decide what (if anything) to tell the admin about a LINE binding. Always returns an alert: every new binding is visible. */
export function describeBinding(e: BindingEvent): Pick<SecurityAlert, 'type' | 'severity' | 'message'> {
  const via = e.via === 'invitation' ? 'ผ่านรหัสเชิญ' : 'โดยพิมพ์เลขห้อง';
  if (e.movedFromRoomNumber) {
    return { type: 'line_moved', severity: 'warning', message: `บัญชี LINE นี้ย้ายจากห้อง ${e.movedFromRoomNumber} มาผูกกับห้อง ${e.roomNumber} (${via}) — ตรวจสอบว่าเป็นผู้เช่าห้อง ${e.roomNumber} จริง` };
  }
  if (e.replacedExisting) {
    return { type: 'line_replaced', severity: 'warning', message: `ห้อง ${e.roomNumber} เปลี่ยนไปใช้บัญชี LINE ใหม่ (${via}) — บัญชีเดิมถูกถอดออก` };
  }
  return { type: 'line_bound', severity: 'info', message: `มีผู้ผูกบัญชี LINE กับห้อง ${e.roomNumber} (${via})` };
}

export const lineRef = (lineUserId: string) => lineUserId.slice(-4);

export function openAlertCount(list: Pick<SecurityAlert, 'status'>[]): number {
  return list.filter(a => a.status === 'open').length;
}

/** Warnings first, then newest. */
export function sortAlerts<T extends Pick<SecurityAlert, 'status' | 'severity' | 'created_at'>>(list: T[]): T[] {
  return [...list].sort((a, b) =>
    Number(b.status === 'open') - Number(a.status === 'open')
    || Number(b.severity === 'warning') - Number(a.severity === 'warning')
    || b.created_at.localeCompare(a.created_at));
}