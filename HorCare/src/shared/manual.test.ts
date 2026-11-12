import { describe, expect, it } from 'vitest';
import { MANUAL_CHANGES, MANUAL_GROUPS, MANUAL_SECTIONS, searchManual, sectionText } from './manual';
import { VIEW_PERMISSIONS } from './viewAccess';
import { TENANT_COMMAND_WORDS } from './tenantBot';
import { ALERT_INFO, ALERT_TYPES } from './alerts';
import { POS_QUICK } from './posCare';

const all = MANUAL_SECTIONS.map(sectionText).join('\n');

// These checks fail when something is added to HorCare without the manual saying how to use it.
describe('the manual covers everything', () => {
  it('every screen of the app has a section (admin is HorCare\'s own back office)', () => {
    const documented = new Set(MANUAL_SECTIONS.map(s => s.view).filter(Boolean));
    for (const view of Object.keys(VIEW_PERMISSIONS).filter(v => v !== 'admin')) expect(documented, `screen "${view}"`).toContain(view);
    expect(documented).toContain('archives');
  });

  it('every word the tenant / vendor / walk-in bot understands is explained', () => {
    for (const [cmd, word] of Object.entries(TENANT_COMMAND_WORDS)) expect(all, `command ${cmd} ("${word}")`).toContain(`"${word}"`);
  });

  it('every POS Care button and every alert kind is explained', () => {
    for (const b of POS_QUICK) expect(all, b).toContain(b);
    for (const t of ALERT_TYPES) expect(all, `alert ${t}`).toContain(ALERT_INFO[t].label);
  });

  it('sections are well formed and the latest changes come first', () => {
    const ids = MANUAL_SECTIONS.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of MANUAL_SECTIONS) {
      expect(MANUAL_GROUPS.map(g => g.id)).toContain(s.group);
      expect(s.summary.length).toBeGreaterThan(10);
      for (const st of s.steps ?? []) expect(st.items.length).toBeGreaterThan(0);
      for (const p of s.problems ?? []) expect(p.fix.length).toBeGreaterThan(0);
    }
    // every group has something in it, and what to do when things go wrong is there
    for (const g of MANUAL_GROUPS) expect(MANUAL_SECTIONS.some(s => s.group === g.id), g.id).toBe(true);
    const dates = MANUAL_CHANGES.map(c => c.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });
});

describe('search', () => {
  it('finds by title, keyword and body; titles first; every word must match', () => {
    expect(searchManual('').length).toBe(MANUAL_SECTIONS.length);
    expect(searchManual('ขาจร').slice(0, 2).map(s => s.id)).toEqual(expect.arrayContaining(['walkins', 'line-walkin']));
    expect(searchManual('สลิป').map(s => s.id)).toContain('payments');
    expect(searchManual('ขาจร ล็อก').every(s => sectionText(s).includes('ล็อก'))).toBe(true);
    expect(searchManual('zzzz-ไม่มีคำนี้')).toEqual([]);
  });
});
