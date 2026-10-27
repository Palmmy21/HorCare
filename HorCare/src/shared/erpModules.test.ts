import { describe, expect, it } from 'vitest';
import { VIEW_LABELS_TH, erpModules } from './erpModules';
import { navGroupDefs } from '../utils/navGroups';

describe('erpModules', () => {
  it('uses the same ids as the sidebar groups (except the standalone home and plan links)', () => {
    const standalone = ['overview', 'plan'];
    for (const market of [false, true]) {
      const ids = erpModules(market).map(m => m.id);
      const groups = navGroupDefs(market).map(g => g.id).filter(id => !standalone.includes(id));
      expect(ids).toEqual(groups);
    }
  });

  it('every screen a module lists has a label and sits in that module\'s sidebar group', () => {
    const defs = navGroupDefs(true);
    for (const m of erpModules(true)) {
      const group = defs.find(g => g.id === m.id)!;
      for (const v of m.views) {
        expect(VIEW_LABELS_TH[v], v).toBeTruthy();
        expect(group.items, `${m.id}/${v}`).toContain(v);
      }
    }
  });

  it('a screen belongs to one module only', () => {
    const all = erpModules(true).flatMap(m => m.views);
    expect(new Set(all).size).toBe(all.length);
  });

  it('market-only screens are hidden from non-market workspaces', () => {
    expect(erpModules(false).flatMap(m => m.views)).not.toContain('market');
    expect(erpModules(true).flatMap(m => m.views)).toContain('market');
  });

  it('stays inside real estate: no manufacturing / payroll / general sales modules', () => {
    const text = JSON.stringify(erpModules(false));
    for (const banned of ['เงินเดือน', 'การผลิต', 'คลังสินค้า']) expect(text).not.toContain(banned);
  });
});
