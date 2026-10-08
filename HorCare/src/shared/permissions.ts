// HorCare - RBAC catalog.
// Single source of truth shared by the frontend (UI gating only) and the Vercel
// API (`api/_rbac.ts`, the real enforcement point). Keep this file dependency-free.

export const ROLES = [
  'owner',
  'property_manager',
  'finance',
  'front_desk',
  'technician',
  'housekeeping',
  'market_admin',
  'shop_owner',
  'tenant',
] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'property.update',
  'room.read', 'room.create', 'room.update', 'room.delete',
  'tenant.read', 'tenant.update',
  'invitation.read', 'invitation.create',
  'meter.read', 'meter.record',
  'finance.read',
  'payment.create', 'payment.update', 'payment.reconcile',
  /** Add / edit / disable the bank accounts the property receives money into. */
  'bank_account.manage',
  'contract.read', 'contract.create', 'contract.sign',
  'work_order.read', 'work_order.create', 'work_order.update',
  /** Verify, close or reopen a completed job — kept apart from `update` so the person who did the work can't sign it off. */
  'work_order.verify',
  'parcel.read', 'parcel.create', 'parcel.update',
  'shop.read', 'shop.update',
  'visitor.read', 'visitor.create',
  /** LINE inbox: read tenant conversations / reply as the property. */
  'message.read', 'message.send',
  /** Edit the auto-reply Q&A the LINE bot answers from. */
  'chatbot.manage',
  /** Publish / edit / archive announcements to tenants. */
  'announcement.manage',
  /** Accounting export: set up the profile / code mappings (the accountant's approval). */
  'accounting.manage',
  /** Accounting export: preview, create, download and confirm the import of export files. */
  'accounting.export',
  'audit_log.read',
  'member.read', 'member.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL: Permission[] = [...PERMISSIONS];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: ALL,
  // Everything except managing who else has access.
  property_manager: ALL.filter(p => p !== 'member.manage'),
  finance: [
    'room.read', 'tenant.read', 'finance.read', 'meter.read',
    'payment.create', 'payment.update', 'payment.reconcile', 'contract.read', 'accounting.export',
  ],
  front_desk: [
    'room.read', 'tenant.read', 'invitation.read', 'invitation.create', 'meter.read',
    'payment.create', 'parcel.read', 'parcel.create', 'parcel.update',
    'work_order.read', 'work_order.create', 'visitor.read', 'visitor.create',
    'message.read', 'message.send', 'announcement.manage',
  ],
  technician: ['room.read', 'meter.read', 'work_order.read', 'work_order.update'],
  housekeeping: ['room.read', 'work_order.read', 'work_order.update'],
  market_admin: [
    'room.read', 'room.update', 'tenant.read', 'shop.read', 'shop.update',
    'visitor.read', 'visitor.create',
  ],
  shop_owner: ['shop.read'],
  tenant: [],
};

/** Roles an owner may assign to a member (never 'owner'; tenants don't use this system). */
export const ASSIGNABLE_ROLES: Role[] = ROLES.filter(r => r !== 'owner' && r !== 'tenant');

export const ROLE_LABELS_TH: Record<Role, string> = {
  owner: 'เจ้าของ',
  property_manager: 'ผู้จัดการอาคาร',
  finance: 'การเงิน',
  front_desk: 'เคาน์เตอร์/ต้อนรับ',
  technician: 'ช่าง',
  housekeeping: 'แม่บ้าน',
  market_admin: 'ผู้ดูแลตลาด',
  shop_owner: 'เจ้าของร้านค้า',
  tenant: 'ผู้เช่า',
};

export function permissionsForRole(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export function can(role: Role | null | undefined, permission: Permission): boolean {
  return !!role && permissionsForRole(role).includes(permission);
}

/** Member document stored at users/{ownerUid}/members/{memberUid}. */
export interface MemberDoc {
  uid: string;
  email: string;
  display_name: string;
  role: Role;
  /** Denormalised from the role at write time so Firestore rules can check it. */
  permissions: Permission[];
  /** Building ids this member may access, or ['*'] for every property. */
  property_ids: string[];
  status: 'active' | 'disabled';
  created_at: string;
  created_by: string;
}
