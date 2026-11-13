// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ASSET_COLORS, ASSET_KINDS, assetKindOf, contrast } from './assetTheme';
import { BUILDING_TYPE_LABELS } from '../utils/workspaceTerminology';

const css = readFileSync(new URL('../styles/assetTheme.css', import.meta.url), 'utf8');

describe('sidebar colour per kind of property', () => {
  it('every building type the owner can pick has its own colour', () => {
    for (const t of Object.keys(BUILDING_TYPE_LABELS)) expect(ASSET_KINDS, t).toContain(t);
    const lights = ASSET_KINDS.map(k => ASSET_COLORS[k].light.toLowerCase());
    expect(new Set(lights).size).toBe(lights.length);
  });

  it('white menu text stays readable on every colour, light and dark, and the active icon stands out', () => {
    for (const k of ASSET_KINDS) {
      const c = ASSET_COLORS[k];
      expect(contrast(c.light, '#FFFFFF'), `${k} light`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.dark, '#FFFFFF'), `${k} dark`).toBeGreaterThanOrEqual(7);
      expect(contrast(c.accent, c.light), `${k} accent`).toBeGreaterThanOrEqual(3);
    }
  });

  it('the stylesheet matches the map', () => {
    for (const k of ASSET_KINDS) {
      const c = ASSET_COLORS[k];
      expect(css).toContain(`html[data-asset="${k}"] { --sidebar-bg: ${c.light}; --sidebar-active-icon: ${c.accent}; }`);
      expect(css).toContain(`html.dark[data-asset="${k}"] { --sidebar-bg: ${c.dark}; }`);
    }
  });

  it('an untyped (older) building is a dormitory; an unknown type is "other"', () => {
    expect(assetKindOf(undefined)).toBe('dormitory');
    expect(assetKindOf('')).toBe('dormitory');
    expect(assetKindOf('market')).toBe('market');
    expect(assetKindOf('spaceport')).toBe('other');
  });
});
