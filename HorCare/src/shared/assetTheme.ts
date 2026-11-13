/**
 * The sidebar (and the mobile header) takes the colour of the kind of property being managed, so an owner with a
 * dormitory, a market and a hotel sees at a glance which one is open. White text sits on every colour, so each one
 * keeps at least 4.5:1 contrast with white (checked in assetTheme.test.ts).
 *
 * The CSS lives in src/styles/assetTheme.css as `html[data-asset="…"]` rules; the test keeps it in step with this map.
 */
export type AssetKind = 'dormitory' | 'apartment' | 'condo' | 'house' | 'market' | 'commercial' | 'office' | 'hotel' | 'resort' | 'other';

export interface AssetColors {
  /** sidebar background, light theme */
  light: string;
  /** sidebar background, dark theme */
  dark: string;
  /** icon of the active menu item (must stand out on `light`) */
  accent: string;
}

export const ASSET_COLORS: Record<AssetKind, AssetColors> = {
  dormitory:  { light: '#0A5DAA', dark: '#0D2E52', accent: '#FFB36B' }, // HorCare blue (unchanged)
  apartment:  { light: '#4338CA', dark: '#221E5C', accent: '#FFB36B' }, // indigo
  condo:      { light: '#6D28D9', dark: '#331566', accent: '#FCD34D' }, // violet
  house:      { light: '#15803D', dark: '#0E3B20', accent: '#FDE68A' }, // green
  market:     { light: '#C2410C', dark: '#55210B', accent: '#FEF08A' }, // orange
  commercial: { light: '#0F766E', dark: '#0B3B37', accent: '#FFB36B' }, // teal
  office:     { light: '#334155', dark: '#1E293B', accent: '#7DD3FC' }, // slate
  hotel:      { light: '#9F1239', dark: '#4C0A1E', accent: '#FDE68A' }, // wine
  resort:     { light: '#0E7490', dark: '#0A3846', accent: '#FDE68A' }, // lagoon
  other:      { light: '#475569', dark: '#1F2937', accent: '#FFB36B' }, // grey
};

export const ASSET_KINDS = Object.keys(ASSET_COLORS) as AssetKind[];

/** A building with no type (older data) is a dormitory, as everywhere else in the app. */
export function assetKindOf(type: string | null | undefined): AssetKind {
  if (!type) return 'dormitory';
  return (ASSET_KINDS as string[]).includes(type) ? type as AssetKind : 'other';
}

/** WCAG relative luminance of #RRGGBB. */
export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
