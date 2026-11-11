// Staff portal (technicians & housekeepers): what the portal shows, shared by /api/staff-portal and the page.
import type { Priority, StaffRole, WorkStatus, WorkType } from './workOrders.js';

/** Work-order statuses still in the staff member's hands (completed = waiting for the manager's check). */
export const OPEN_WORK: WorkStatus[] = ['assigned', 'accepted', 'in_progress', 'completed'];
export const CLOSED_CLEANING = ['completed', 'done', 'cancelled'];

/** LINE messages that open the portal (sent to the team OA, or by the rich-menu button). */
export const PORTAL_KEYWORDS = ['งานของฉัน', 'งาน', 'portal', 'my jobs', 'myjobs'];
export const isPortalRequest = (text: string): boolean => PORTAL_KEYWORDS.includes(text.trim().toLowerCase());

/** Phone numbers compared by their last 9 digits, so 081-234-5678, 0812345678 and +66812345678 match. */
export function phoneKey(phone: string): string {
    return phone.replace(/\D/g, '').slice(-9);
}

export interface PortalWorkJob {
    key: string;                 // owner~building~id
    dorm_name: string;
    area: string;
    work_type: WorkType;
    description: string;
    priority: Priority;
    due_date: string | null;
    status: WorkStatus;
    reopen_note: string | null;
}

export interface PortalCleaningJob {
    key: string;
    dorm_name: string;
    room_number: string;
    service_type: string;
    description: string | null;
    preferred_date: string | null;
    preferred_time_slot: string | null;
    status: string;
    urgent: boolean;
    /** Nobody has taken it yet: starting it makes it this person's. */
    unassigned?: boolean;
}

export interface PortalOverview {
    name: string;
    /** the jobs this person holds across their properties */
    roles: StaffRole[];
    /** a housekeeper with a phone number on file: may open the meter page */
    can_meter: boolean;
    /** how many staff records (properties) this LINE account is linked to */
    properties: number;
    work: PortalWorkJob[];
    cleaning: PortalCleaningJob[];
}

const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

/** Jobs in the order a person should do them: sent back for rework, urgent, overdue/due soonest, waiting for check last. */
export function sortWork(jobs: PortalWorkJob[]): PortalWorkJob[] {
    const rank = (j: PortalWorkJob) => (j.status === 'completed' ? 2 : j.reopen_note && j.status !== 'in_progress' ? 0 : 1);
    return [...jobs].sort((a, b) =>
        rank(a) - rank(b)
        || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
        || (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'));
}
