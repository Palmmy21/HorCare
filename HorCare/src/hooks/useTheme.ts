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
    name: 'HorCare Cyber (Navy, Cyan, Emerald, Orange)',
    icon: 'Shield',
    swatch: '#0EA5E9',
    swatchSecondary: '#10B981',
    vars: {
      '--color-primary':             '#0EA5E9',
      '--color-primary-dark':        '#0284C7',
      '--color-primary-light':       '#38BDF8',
      '--color-primary-ultra-light': 'rgba(14, 165, 233, 0.08)',
      '--color-navy':                '#0F172A',
      '--color-emerald':             '#10B981',
      '--color-orange':              '#F97316',
      '--gradient-primary':          'linear-gradient(135deg, #0EA5E9 0%, #10B981 100%)',
      '--gradient-accent':           'linear-gradient(135deg, #F97316 0%, #F59E0B 100%)',
      '--shadow-glow-primary':       '0 0 0 3px rgba(14, 165, 233, 0.22)',
      '--shadow-glow-success':       '0 0 0 3px rgba(16, 185, 129, 0.22)',
      '--sidebar-bg':                'linear-gradient(180deg, #0284C7 0%, #0369A1 50%, #075985 100%)',
    },
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
