import { describe, expect, it } from 'vitest';
import {
    ASSIGNABLE_ROLES, PERMISSIONS, ROLES, ROLE_PERMISSIONS, can, isRole, permissionsForRole,
} from './permissions';

describe('RBAC catalog', () => {
    it('owner holds every permission', () => {
        expect(permissionsForRole('owner')).toEqual([...PERMISSIONS]);
    });

    it('only the owner can manage members', () => {
        for (const role of ROLES) expect(can(role, 'member.manage')).toBe(role === 'owner');
    });

    it('every role grants only known permissions', () => {
        for (const role of ROLES) {
            for (const p of ROLE_PERMISSIONS[role]) expect(PERMISSIONS).toContain(p);
        }
    });

    it('least privilege: staff roles cannot reach finance/audit/contract powers they do not need', () => {
        expect(can('technician', 'payment.create')).toBe(false);
        expect(can('technician', 'audit_log.read')).toBe(false);
        expect(can('housekeeping', 'tenant.read')).toBe(false);
        expect(can('front_desk', 'payment.reconcile')).toBe(false);
        expect(can('front_desk', 'audit_log.read')).toBe(false);
        expect(can('finance', 'room.delete')).toBe(false);
        expect(can('shop_owner', 'room.read')).toBe(false);
    });

    it('only owner and property manager can manage bank accounts; finance can read finance data but not change accounts', () => {
    for (const role of ROLES) {
      expect(can(role, 'bank_account.manage')).toBe(role === 'owner' || role === 'property_manager');
    }
    expect(can('finance', 'finance.read')).toBe(true);
  });

  it('only owner and manager edit the chatbot; front desk may also publish announcements; finance and staff may not', () => {
    for (const role of ROLES) {
      expect(can(role, 'chatbot.manage')).toBe(role === 'owner' || role === 'property_manager');
      expect(can(role, 'announcement.manage')).toBe(role === 'owner' || role === 'property_manager' || role === 'front_desk');
    }
  });

  it('accounting: only owner and manager set up the profile; finance may export; others may not', () => {
    for (const role of ROLES) {
      expect(can(role, 'accounting.manage')).toBe(role === 'owner' || role === 'property_manager');
      expect(can(role, 'accounting.export')).toBe(role === 'owner' || role === 'property_manager' || role === 'finance');
    }
  });

  it('leasing: owner, manager and front desk manage; finance may read; staff roles have no access', () => {
    for (const role of ROLES) {
      expect(can(role, 'leasing.manage')).toBe(role === 'owner' || role === 'property_manager' || role === 'front_desk');
      expect(can(role, 'leasing.read')).toBe(['owner', 'property_manager', 'front_desk', 'finance'].includes(role));
    }
  });

  it('finance can reconcile, front desk can invite tenants', () => {
        expect(can('finance', 'payment.reconcile')).toBe(true);
        expect(can('front_desk', 'invitation.create')).toBe(true);
    });

    it('tenants and unknown roles have no permissions', () => {
        expect(permissionsForRole('tenant')).toEqual([]);
        expect(can(undefined, 'room.read')).toBe(false);
        expect(can(null, 'room.read')).toBe(false);
        expect(permissionsForRole('bogus' as never)).toEqual([]);
    });

    it('owner/tenant are not assignable to team members', () => {
        expect(ASSIGNABLE_ROLES).not.toContain('owner');
        expect(ASSIGNABLE_ROLES).not.toContain('tenant');
        expect(ASSIGNABLE_ROLES).toContain('property_manager');
    });

    it('isRole validates untrusted input', () => {
        expect(isRole('finance')).toBe(true);
        expect(isRole('root')).toBe(false);
        expect(isRole(7)).toBe(false);
        expect(isRole(undefined)).toBe(false);
    });
});
