// Sidebar categories. Pure helpers so the grouping and open/closed rules can be tested.

export interface NavGroupDef {
  id: string;
  label: string;
  /** View ids that belong to this group, in display order. */
  items: string[];
}

/** Category layout. Labels adapt to a market workspace. Views not listed fall into the last group. */
export function navGroupDefs(isMarket: boolean): NavGroupDef[] {
  return [
    // Real-estate ERP modules: property → leasing → billing → accounting → operations → residents → system
    { id: 'overview', label: 'ภาพรวม', items: ['dashboard'] },
    { id: 'property', label: isMarket ? 'แผงค้า' : 'ทรัพย์สิน', items: ['floorplan', 'rooms', 'collections', 'recording', 'summary'] },
    { id: 'leasing', label: 'ปล่อยเช่า', items: ['leasing', 'tenants'] },
    { id: 'billing', label: 'เรียกเก็บและรับเงิน', items: ['payments'] },
    { id: 'accounting', label: 'บัญชี', items: ['ledger', 'accounting', 'archives'] },
    { id: 'service', label: 'ซ่อมบำรุงและบริการ', items: ['maintenance', 'cleaning', 'workorders', 'operations'] },
    { id: 'residents', label: isMarket ? 'ผู้ค้าและการสื่อสาร' : 'ลูกบ้านและการสื่อสาร', items: ['parcels', 'market', 'messages', 'announcements'] },
    // Plan & billing sits on its own (a one-item group renders as a plain top-level link, not a category)
    { id: 'plan', label: 'แพ็กเกจ', items: ['pricing'] },
    { id: 'system', label: 'ระบบ', items: ['security', 'settings', 'admin'] },
  ];
}

export interface NavGroup<T> { id: string; label: string; items: T[] }

/**
 * Arrange visible nav items into groups. Order inside a group follows the definition, empty
 * groups are dropped, and any item without a group is appended to the last one so a new view
 * can never silently disappear from the menu.
 */
export function groupNav<T extends { id: string }>(items: T[], defs: NavGroupDef[]): NavGroup<T>[] {
  const byId = new Map(items.map(i => [i.id, i]));
  const placed = new Set<string>();
  const groups: NavGroup<T>[] = defs.map(d => ({
    id: d.id,
    label: d.label,
    items: d.items.flatMap(id => {
      const it = byId.get(id);
      if (!it) return [];
      placed.add(id);
      return [it];
    }),
  }));
  const leftovers = items.filter(i => !placed.has(i.id));
  if (leftovers.length > 0 && groups.length > 0) groups[groups.length - 1].items.push(...leftovers);
  return groups.filter(g => g.items.length > 0);
}

export function groupOfView<T extends { id: string }>(groups: NavGroup<T>[], viewId: string): string | null {
  return groups.find(g => g.items.some(i => i.id === viewId))?.id ?? null;
}

/** Persisted open/closed choice per group (only used for groups that don't hold the current page). */
export type NavGroupState = Record<string, 'open' | 'closed'>;

/** The user collapsed the group that holds the page they are on; valid only while on that page. */
export interface TransientClose { groupId: string; view: string }

/**
 * Is a group expanded?
 *  • the group holding the current page is open, unless the user just collapsed it on this page
 *  • every other group follows the saved choice and is closed by default
 */
export function isGroupOpen(
  groupId: string,
  activeGroupId: string | null,
  saved: NavGroupState,
  transient: TransientClose | null,
  currentView: string,
): boolean {
  if (groupId === activeGroupId) {
    return !(transient && transient.groupId === groupId && transient.view === currentView);
  }
  return saved[groupId] === 'open';
}

export function parseSavedState(raw: string | null): NavGroupState {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw) as unknown;
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    const out: NavGroupState = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (v === 'open' || v === 'closed') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}
