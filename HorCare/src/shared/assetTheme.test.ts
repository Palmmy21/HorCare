// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ASSET_COLORS, ASSET_KINDS, assetCssLines, assetKindOf, contrast } from './assetTheme';
import { BUILDING_TYPE_LABELS } from '../utils/workspaceTerminology';

const css = readFileSync(new URL('../styles/assetTheme.css', import.meta.url), 'utf8');

describe('pastel accent per kind of property', () => {
  it('every building type the owner can pick has its own accent', () => {
    for (const t of Object.keys(BUILDING_TYPE_LABELS)) expect(ASSET_KINDS, t).toContain(t);
    const softs = ASSET_KINDS.map(k => ASSET_COLORS[k].soft.toLowerCase());
    expect(new Set(softs).size).toBe(softs.length);
  });

  it('the active item stays readable on its pastel, light and dark, and the pastel stays soft', () => {
    for (const k of ASSET_KINDS) {
      const c = ASSET_COLORS[k];
      expect(contrast(c.ink, c.soft), `${k} light`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.darkInk, c.darkSoft), `${k} dark`).toBeGreaterThanOrEqual(4.5);
      // a pastel, not a loud fill: close to white in light mode
      expect(contrast(c.soft, '#FFFFFF'), `${k} soft`).toBeLessThan(1.25);
    }
  });

  it('the stylesheet matches the map', () => {
    for (const k of ASSET_KINDS) for (const line of assetCssLines(k)) expect(css).toContain(line);
  });

  it('an untyped (older) building is a dormitory; an unknown type is "other"', () => {
    expect(assetKindOf(undefined)).toBe('dormitory');
    expect(assetKindOf('')).toBe('dormitory');
    expect(assetKindOf('market')).toBe('market');
    expect(assetKindOf('spaceport')).toBe('other');
  });
});
