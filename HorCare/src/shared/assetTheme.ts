/**
 * A quiet hint of the kind of property being managed. The shell (sidebar, mobile header) is neutral; only the active
 * menu item and the branch's dot carry the property's pastel, so an owner with a dormitory, a market and a hotel still
 * sees which one is open without a loud coloured sidebar.
 *
 * `ink` is the text/icon on `soft` and must keep 4.5:1 contrast there, in both themes (assetTheme.test.ts).
 * The CSS lives in src/styles/assetTheme.css as `html[data-asset="…"]` rules; the test keeps it in step with this map.
 */
export type AssetKind = 'dormitory' | 'apartment' | 'condo' | 'house' | 'market' | 'commercial' | 'office' | 'hotel' | 'resort' | 'other';

export interface AssetColors {
  /** active item background, light theme */
  soft: string;
  /** active item text and icon, light theme */
  ink: string;
  /** the branch dot (decorative) */
  dot: string;
  /** active item background / text, dark theme */
  darkSoft: string;
  darkInk: string;
}

export const ASSET_COLORS: Record<AssetKind, AssetColors> = {
  dormitory:  { soft: '#E8F0FB', ink: '#1D4E89', dot: '#7BA7DB', darkSoft: '#1C2838', darkInk: '#B9D3F2' }, // blue
  apartment:  { soft: '#EDEDFB', ink: '#3F3A99', dot: '#A29BEA', darkSoft: '#24233A', darkInk: '#C9C5F5' }, // periwinkle
  condo:      { soft: '#F2ECFB', ink: '#5B2E9E', dot: '#B79BE6', darkSoft: '#2A2238', darkInk: '#D9C8F5' }, // lavender
  house:      { soft: '#E7F4EC', ink: '#22663F', dot: '#8CC7A2', darkSoft: '#1B2B23', darkInk: '#B6E0C5' }, // sage
  market:     { soft: '#FCEEE4', ink: '#934015', dot: '#F0AE82', darkSoft: '#33261D', darkInk: '#F6CDB0' }, // peach
  commercial: { soft: '#E4F3F1', ink: '#1C625C', dot: '#84C6BE', darkSoft: '#1A2B29', darkInk: '#B0DFD8' }, // mint
  office:     { soft: '#EDF0F4', ink: '#364152', dot: '#A3B0C2', darkSoft: '#22262D', darkInk: '#CBD4E0' }, // slate
  hotel:      { soft: '#FBEAEE', ink: '#8B2742', dot: '#E79AAE', darkSoft: '#33212A', darkInk: '#F3C3CF' }, // rose
  resort:     { soft: '#E4F2F6', ink: '#1A6175', dot: '#86C3D4', darkSoft: '#1A2A30', darkInk: '#B3DCE7' }, // lagoon
  other:      { soft: '#F0F0EF', ink: '#44403C', dot: '#B5B0AA', darkSoft: '#262523', darkInk: '#D6D3D1' }, // stone
};

export const ASSET_KINDS = Object.keys(ASSET_COLORS) as AssetKind[];

/** The phone's browser bar matches the (neutral) shell. */
export const SHELL_BAR_COLOR = { light: '#FFFFFF', dark: '#171A1F' };

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

/** The stylesheet line for one kind (the test checks src/styles/assetTheme.css holds exactly these). */
export function assetCssLines(k: AssetKind): [string, string] {
  const c = ASSET_COLORS[k];
  return [
    `html[data-asset="${k}"] { --accent-soft: ${c.soft}; --accent-ink: ${c.ink}; --accent-dot: ${c.dot}; }`,
    `html.dark[data-asset="${k}"] { --accent-soft: ${c.darkSoft}; --accent-ink: ${c.darkInk}; }`,
  ];
}
