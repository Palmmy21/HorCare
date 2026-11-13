import { describe, expect, it } from 'vitest';
import { canOpenOpsTab, canOpenView, firstOpenView, VIEW_PERMISSIONS } from './viewAccess';
import { ROLE_PERMISSIONS, ROLES } from './permissions';

const of = (role: keyof typeof ROLE_PERMISSIONS) => ROLE_PERMISSIONS[role];

describe('which screens a role sees', () => {
  it('the owner (null permissions) opens everything, including screens added later', () => {
    for (const v of [...Object.keys(VIEW_PERMISSIONS), 'brand-new-screen']) expect(canOpenView(v, null)).toBe(true);
  });

  it('a building manager runs the building but not the organisation: no team management, plans or platform admin', () => {
    const p = of('property_manager');
    for (const v of ['dashboard', 'rooms', 'tenants', 'operations', 'payments', 'leasing', 'settings']) expect(canOpenView(v, p), v).toBe(true);
    for (const v of ['security', 'pricing', 'admin']) expect(canOpenView(v, p), v).toBe(false);
  });

  it('other roles see only what their permissions allow', () => {
    expect(canOpenView('payments', of('finance'))).toBe(true);
    expect(canOpenView('ledger', of('finance'))).toBe(true);
    expect(canOpenView('settings', of('finance'))).toBe(false);
    // front desk takes repair requests, so it opens ระบบจัดการ (its tabs then show only the repair work)
    expect(canOpenView('operations', of('front_desk'))).toBe(true);
    expect(canOpenView('maintenance', of('front_desk'))).toBe(true);
    expect(canOpenView('operations', of('finance'))).toBe(false);
    expect(canOpenView('parcels', of('front_desk'))).toBe(true);
    expect(canOpenView('workorders', of('technician'))).toBe(true);
    expect(canOpenView('payments', of('technician'))).toBe(false);
    expect(canOpenView('rooms', of('housekeeping'))).toBe(true);
    expect(canOpenView('tenants', of('housekeeping'))).toBe(false);
  });

  it('nobody but the owner gets pricing or platform admin, whatever the role', () => {
    for (const role of ROLES.filter(r => r !== 'owner')) {
      expect(canOpenView('pricing', of(role)), role).toBe(false);
      expect(canOpenView('admin', of(role)), role).toBe(false);
    }
  });

  it('an unknown screen is closed to staff, an empty permission list sees only the dashboard', () => {
    expect(canOpenView('brand-new-screen', of('property_manager'))).toBe(false);
    expect(canOpenView('dashboard', [])).toBe(true);
    expect(canOpenView('rooms', [])).toBe(false);
  });

  it('lands on the first screen allowed, or the dashboard', () => {
    expect(firstOpenView(['payments', 'rooms', 'dashboard'], of('technician'))).toBe('rooms');
    expect(firstOpenView(['security', 'payments'], of('finance'))).toBe('payments');
    expect(firstOpenView([], [])).toBe('dashboard');
  });
});

describe('tabs of ระบบจัดการ', () => {
  it('staff with repair work only see the service tabs, never the back office', () => {
    const desk = of('front_desk');
    expect(canOpenOpsTab('maintenance', desk)).toBe(true);
    for (const t of ['vendors', 'stock', 'assets', 'expenses', 'fines', 'common_fees'] as const) expect(canOpenOpsTab(t, desk), t).toBe(false);
    expect(canOpenOpsTab('maintenance', of('technician'))).toBe(true);
    expect(canOpenOpsTab('team', of('technician'))).toBe(true);
    expect(canOpenOpsTab('stock', of('technician'))).toBe(false);
  });
  it('a building manager and the owner see every tab', () => {
    for (const t of ['maintenance', 'cleaning', 'team', 'vendors', 'stock', 'common_fees'] as const) {
      expect(canOpenOpsTab(t, of('property_manager')), t).toBe(true);
      expect(canOpenOpsTab(t, null), t).toBe(true);
    }
  });
});
