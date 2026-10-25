import { useState, useEffect } from 'react';

/* ── Mode ─────────────────────────────────────── */
export type ThemeMode = 'light' | 'dark' | 'system';

const MODE_KEY = 'horcare_mode';
const THEME_KEY = 'horcare_theme';

function getSystemDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyMode(mode: ThemeMode) {
  const isDark = mode === 'dark' || (mode === 'system' && getSystemDark());
  if (isDark) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

/* ── Theme preset ──────────────────────────────── */
export interface ThemePreset {
  id: string;
  name: string;
  icon: string;
  emoji?: string;
  vars: Record<string, string>;
  swatch: string;
  swatchSecondary: string;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'cyber-minimal',
    name: 'HorCare (Blue, Orange, Green)',
    icon: 'Shield',
    swatch: '#0A6CC2',
    swatchSecondary: '#E8740C',
    // Colours live in index.css (:root and html.dark) so dark mode can restep them; inline vars would pin the light values.
    vars: {},
  },
];

function applyTheme(preset: ThemePreset) {
  const root = document.documentElement;
  Object.entries(preset.vars).forEach(([key, value]) => {
    root.style.setProperty(key, value);
  });
}

/* ── Hook ──────────────────────────────────────── */
export function useTheme() {
  const [themeId, setThemeId] = useState<string>(() => {
    return 'cyber-minimal';
  });

  const [mode, setModeState] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(MODE_KEY) as ThemeMode;
    // Default to light mode (bright and vibrant HorCare theme)
    if (!saved || saved === 'dark') {
      localStorage.setItem(MODE_KEY, 'light');
      return 'light';
    }
    return saved;
  });

  const currentTheme = THEME_PRESETS.find(t => t.id === themeId) ?? THEME_PRESETS[0];

  // Apply theme CSS variables
  useEffect(() => {
    applyTheme(currentTheme);
    localStorage.setItem(THEME_KEY, currentTheme.id);
  }, [themeId, currentTheme]);

  // Apply mode (dark/light/system) + listen for OS changes
  useEffect(() => {
    applyMode(mode);
    localStorage.setItem(MODE_KEY, mode);

    if (mode !== 'system') return;

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyMode('system');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [mode]);

  const setTheme = (id: string) => setThemeId(id);
  const setMode  = (m: ThemeMode) => setModeState(m);

  return { themeId, currentTheme, setTheme, themes: THEME_PRESETS, mode, setMode };
}
