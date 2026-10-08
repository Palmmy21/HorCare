// Work orders (technician / housekeeping jobs) — definitions shared by the API and the UI.

export const WORK_STATUSES = ['created', 'assigned', 'accepted', 'in_progress', 'completed', 'closed'] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];

export const WORK_STATUS_LABELS_TH: Record<WorkStatus, string> = {
  created: 'สร้างแล้ว',
  assigned: 'มอบหมายแล้ว',
  accepted: 'รับงานแล้ว',
  in_progress: 'กำลังทำ',
  completed: 'ทำเสร็จ รอตรวจ',
  closed: 'ตรวจแล้ว ปิดงาน',
};

export const WORK_TYPES = ['maintenance', 'repair', 'cleaning', 'inspection', 'room_preparation', 'other'] as const;
export type WorkType = (typeof WORK_TYPES)[number];
export const WORK_TYPE_LABELS_TH: Record<WorkType, string> = {
  maintenance: 'บำรุงรักษา',
  repair: 'ซ่อม',
  cleaning: 'ทำความสะอาด',
  inspection: 'ตรวจสอบ',
  room_preparation: 'เตรียมห้อง',
  other: 'อื่นๆ',
};

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS_TH: Record<Priority, string> = { low: 'ต่ำ', normal: 'ปกติ', high: 'สูง', urgent: 'ด่วน' };

/** Who is acting: a signed-in manager, or the assigned staff member via their personal link. */
export type Actor = 'manager' | 'staff';

/**
 * Created → Assigned → Accepted → In Progress → Completed → Verified/Closed.
 * Staff drive accepted / in_progress / completed. Managers assign, then verify (close) or
 * send a completed job back to in_progress.
 */
const TRANSITIONS: Record<Actor, Partial<Record<WorkStatus, WorkStatus[]>>> = {
  manager: {
    created: ['assigned'],
    assigned: ['assigned'],                // reassign
    accepted: ['assigned'],                // reassign before work starts
    completed: ['closed', 'in_progress'],  // verify, or reopen
  },
  staff: {
    assigned: ['accepted'],
    accepted: ['in_progress'],
    in_progress: ['completed'],
  },
};

export function canTransition(actor: Actor, from: WorkStatus, to: WorkStatus): boolean {
  return TRANSITIONS[actor][from]?.includes(to) ?? false;
}

export function isWorkStatus(v: unknown): v is WorkStatus {
  return typeof v === 'string' && (WORK_STATUSES as readonly string[]).includes(v);
}
export function isWorkType(v: unknown): v is WorkType {
  return typeof v === 'string' && (WORK_TYPES as readonly string[]).includes(v);
}
export function isPriority(v: unknown): v is Priority {
  return typeof v === 'string' && (PRIORITIES as readonly string[]).includes(v);
}

export type StaffRole = 'technician' | 'housekeeping';
export const STAFF_ROLE_LABELS_TH: Record<StaffRole, string> = { technician: 'ช่าง', housekeeping: 'แม่บ้าน' };

/** Staff directory entry: users/{owner}/buildings/{b}/staff/{id}. */
export interface WorkStaff {
  id: string;
  name: string;
  phone: string | null;
  role: StaffRole;
  active: boolean;
  /** Set when the person sends their link code to the LINE OA. */
  line_user_id: string | null;
  linked_at: string | null;
  created_at: string;
}

export interface WorkEvent {
  at: string;
  by: string;          // display name, or "staff:<name>"
  type: 'created' | 'assigned' | 'status' | 'note';
  status?: WorkStatus;
  note?: string;
}

export interface WorkOrder {
  id: string;
  organization_id: string;
  property_id: string;
  /** Room id when the job is for a room; null for common areas. */
  room_id: string | null;
  /** Room number or free-text area ("ลิฟต์", "ลานจอดรถ"). */
  area: string;
  work_type: WorkType;
  description: string;
  priority: Priority;
  due_date: string | null;          // YYYY-MM-DD
  status: WorkStatus;
  assigned_staff_id: string | null;
  assigned_staff_name: string | null;
  assigned_at: string | null;
  /** sha256 of the staff link token. The token itself is never stored. */
  staff_token_hash: string | null;
  image_count: number;
  completion_note: string | null;
  reopen_note: string | null;
  events: WorkEvent[];
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  closed_at: string | null;
  closed_by_name: string | null;
}

export type WorkImageKind = 'issue' | 'before' | 'after';
export const MAX_WORK_IMAGES = 8;

/** What the staff page is allowed to see — no org ids, token hash, or other staff data. */
export interface StaffWorkView {
  id: string;
  area: string;
  work_type: WorkType;
  description: string;
  priority: Priority;
  due_date: string | null;
  status: WorkStatus;
  staff_name: string;
  dorm_name: string;
  completion_note: string | null;
  reopen_note: string | null;
  image_count: number;
}

export function isOverdue(o: Pick<WorkOrder, 'due_date' | 'status'>, today: string): boolean {
  return !!o.due_date && o.status !== 'closed' && o.status !== 'completed' && o.due_date < today;
}
