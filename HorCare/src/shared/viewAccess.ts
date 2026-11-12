// Which screens a staff account may open. UI gating only: every API call and every Firestore rule re-checks the same
// permissions on the same building, so hiding a screen is a convenience and never the protection.
import type { Permission } from './permissions.js';

/** A screen is visible when the account holds ANY of its permissions. `null` = anyone signed in; `'owner'` = the owner only. */
export const VIEW_PERMISSIONS: Record<string, Permission[] | null | 'owner'> = {
  dashboard: null,
  rooms: ['room.read'],
  parking: ['room.read'],
  floorplan: ['room.read'],
  collections: ['collections.read', 'booking.read'],
  recording: ['meter.record', 'meter.read'],
  summary: ['finance.read'],
  tenants: ['tenant.read'],
  maintenance: ['work_order.read', 'work_order.create'],
  cleaning: ['work_order.read', 'work_order.create'],
  // ระบบจัดการ also holds repairs, work orders and housekeeping: each tab re-checks its own permission
  operations: ['property.update', 'work_order.read', 'work_order.create'],
  payments: ['payment.create', 'payment.update', 'finance.read'],
  ledger: ['ledger.read'],
  accounting: ['accounting.export'],
  leasing: ['leasing.read'],
  market: ['shop.read', 'visitor.read', 'finance.read'],
  parcels: ['parcel.read'],
  workorders: ['work_order.read'],
  messages: ['message.read'],
  announcements: ['announcement.manage'],
  // team management, the activity log and LINE-binding alerts span the whole organisation
  security: ['member.manage'],
  settings: ['property.update'],
  // the manual: everyone signed in (it only explains; each screen it opens is checked as usual)
  manual: null,
  pricing: 'owner',
  admin: 'owner',
};

/**
 * `permissions` is null for the owner (everything). Unknown screens are closed to staff, so a new screen has to be
 * listed here on purpose.
 */
export function canOpenView(view: string, permissions: readonly Permission[] | null): boolean {
  if (permissions === null) return true;
  const need = VIEW_PERMISSIONS[view];
  if (need === undefined || need === 'owner') return false;
  if (need === null) return true;
  return need.some(p => permissions.includes(p));
}

/** The first screen worth landing on for this account. */
export function firstOpenView(order: string[], permissions: readonly Permission[] | null): string {
  return order.find(v => canOpenView(v, permissions)) ?? 'dashboard';
}

/** Tabs of ระบบจัดการ. แจ้งซ่อม / ใบงาน / งานแม่บ้าน used to be screens of their own. */
export type OpsTab = 'maintenance' | 'workorders' | 'cleaning' | 'team' | 'vendors' | 'stock' | 'assets' | 'expenses' | 'fines' | 'common_fees';

const SERVICE_TAB_VIEW: Partial<Record<OpsTab, string>> = { maintenance: 'maintenance', workorders: 'workorders', cleaning: 'cleaning', team: 'workorders' };

/**
 * The service tabs follow the permissions of the screens they replaced, so staff keep exactly the access they had;
 * the back office (vendors, stock, assets, expenses, fines, common fees) still needs property.update.
 */
export function canOpenOpsTab(tab: OpsTab, permissions: readonly Permission[] | null): boolean {
  if (permissions === null) return true;
  const view = SERVICE_TAB_VIEW[tab];
  return view ? canOpenView(view, permissions) : permissions.includes('property.update');
}
