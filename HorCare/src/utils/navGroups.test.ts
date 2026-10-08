import { describe, expect, it } from 'vitest';
import { groupNav, groupOfView, isGroupOpen, navGroupDefs, parseSavedState } from './navGroups';

const ids = (xs: { id: string }[]) => xs.map(x => x.id);
const item = (id: string) => ({ id, label: id });
const ALL = ['dashboard', 'rooms', 'recording', 'tenants', 'maintenance', 'cleaning', 'operations', 'payments',
  'summary', 'archives', 'parcels', 'workorders', 'messages', 'security', 'settings', 'pricing'].map(item);

describe('groupNav', () => {
  it('puts every view in a category, in definition order', () => {
    const groups = groupNav(ALL, navGroupDefs(false));
    expect(groups.map(g => g.id)).toEqual(['overview', 'property', 'leasing', 'billing', 'accounting', 'service', 'residents', 'system']);
    expect(ids(groups.find(g => g.id === 'billing')!.items)).toEqual(['payments']);
    expect(ids(groups.find(g => g.id === 'accounting')!.items)).toEqual(['archives']);
    expect(ids(groups.find(g => g.id === 'property')!.items)).toEqual(['rooms', 'recording', 'summary']);
    expect(ids(groups.find(g => g.id === 'service')!.items)).toEqual(['maintenance', 'cleaning', 'workorders', 'operations']);
    expect(groups.flatMap(g => ids(g.items)).sort()).toEqual(ids(ALL).sort()); // nothing lost, nothing duplicated
  });

  it('drops empty groups (e.g. the maid portal only sees two views)', () => {
    const groups = groupNav([item('cleaning'), item('recording')], navGroupDefs(false));
    expect(groups.map(g => g.id)).toEqual(['property', 'service']);
  });

  it('never loses a view that has no category — it joins the last group', () => {
    const groups = groupNav([item('dashboard'), item('brand_new_view')], navGroupDefs(false));
    expect(groups.at(-1)!.id).toBe('system');
    expect(ids(groups.at(-1)!.items)).toEqual(['brand_new_view']);
  });

  it('includes admin under the system group when present', () => {
    const groups = groupNav([...ALL, item('admin')], navGroupDefs(false));
    expect(ids(groups.find(g => g.id === 'system')!.items)).toEqual(['security', 'settings', 'pricing', 'admin']);
  });

  it('adapts labels for a market workspace', () => {
    expect(navGroupDefs(true).find(g => g.id === 'property')!.label).toBe('แผงค้า');
    expect(navGroupDefs(false).find(g => g.id === 'property')!.label).toBe('ทรัพย์สิน');
  });

  it('the new ERP views land in their modules', () => {
    const groups = groupNav([item('dashboard'), item('leasing'), item('tenants'), item('ledger'), item('accounting'), item('market'), item('announcements')], navGroupDefs(false));
    expect(ids(groups.find(g => g.id === 'overview')!.items)).toEqual(['dashboard']);
    expect(ids(groups.find(g => g.id === 'leasing')!.items)).toEqual(['leasing', 'tenants']);
    expect(ids(groups.find(g => g.id === 'accounting')!.items)).toEqual(['ledger', 'accounting']);
    expect(ids(groups.find(g => g.id === 'residents')!.items)).toEqual(['market', 'announcements']);
  });

  it('handles an empty list', () => {
    expect(groupNav([], navGroupDefs(false))).toEqual([]);
  });
});

describe('groupOfView', () => {
  const groups = groupNav(ALL, navGroupDefs(false));
  it('finds the category of a page', () => {
    expect(groupOfView(groups, 'payments')).toBe('billing');
    expect(groupOfView(groups, 'messages')).toBe('residents');
    expect(groupOfView(groups, 'nope')).toBeNull();
  });
});

describe('isGroupOpen', () => {
  it('the group with the current page is open by default; others are closed', () => {
    expect(isGroupOpen('money', 'money', {}, null, 'payments')).toBe(true);
    expect(isGroupOpen('service', 'money', {}, null, 'payments')).toBe(false);
  });
  it('other groups follow the saved choice', () => {
    expect(isGroupOpen('service', 'money', { service: 'open' }, null, 'payments')).toBe(true);
    expect(isGroupOpen('service', 'money', { service: 'closed' }, null, 'payments')).toBe(false);
  });
  it('the active group can be collapsed, but only for the page it was collapsed on', () => {
    const t = { groupId: 'money', view: 'payments' };
    expect(isGroupOpen('money', 'money', {}, t, 'payments')).toBe(false);
    // moving to another page in the same group re-opens it
    expect(isGroupOpen('money', 'money', {}, t, 'summary')).toBe(true);
  });
  it('a saved "closed" never hides the group that holds the current page', () => {
    expect(isGroupOpen('money', 'money', { money: 'closed' }, null, 'payments')).toBe(true);
  });
});

describe('parseSavedState', () => {
  it('reads valid state and ignores junk', () => {
    expect(parseSavedState('{"money":"open","service":"closed"}')).toEqual({ money: 'open', service: 'closed' });
    expect(parseSavedState('{"money":"maybe","x":1}')).toEqual({});
    for (const bad of [null, '', 'not json', '[]', '"x"', '42']) expect(parseSavedState(bad as string | null)).toEqual({});
  });
});
