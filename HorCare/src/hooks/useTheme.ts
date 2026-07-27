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
    id: 'default',
    name: 'Ocean Blue',
    icon: 'Waves',
    emoji: '🌊',
    swatch: '#3B6ECD',
    swatchSecondary: '#5B8EEF',
    vars: {
      '--color-primary':             'oklch(0.590 0.140 230)',
      '--color-primary-dark':        'oklch(0.490 0.150 230)',
      '--color-primary-light':       'oklch(0.700 0.120 230)',
      '--color-primary-ultra-light': 'oklch(0.970 0.015 230)',
      '--gradient-primary':          'linear-gradient(135deg, oklch(0.590 0.140 230) 0%, oklch(0.490 0.150 230) 100%)',
      '--shadow-glow-primary':       '0 0 0 3px oklch(0.590 0.140 230 / 0.15)',
      '--sidebar-bg':                'oklch(0.180 0.010 230)',
    },
  },
  {
    id: 'purple',
    name: 'Purple Night',
    icon: 'Sparkles',
    emoji: '🔮',
    swatch: '#7C3AED',
    swatchSecondary: '#A78BFA',
    vars: {
      '--color-primary':             'oklch(0.520 0.200 290)',
      '--color-primary-dark':        'oklch(0.420 0.210 290)',
      '--color-primary-light':       'oklch(0.640 0.180 290)',
      '--color-primary-ultra-light': 'oklch(0.970 0.015 290)',
      '--gradient-primary':          'linear-gradient(135deg, oklch(0.520 0.200 290) 0%, oklch(0.420 0.210 290) 100%)',
      '--shadow-glow-primary':       '0 0 0 3px oklch(0.520 0.200 290 / 0.18)',
      '--sidebar-bg':                'oklch(0.165 0.035 290)',
    },
  },
  {
    id: 'emerald',
    name: 'Emerald',
    icon: 'Leaf',
    emoji: '🌿',
    swatch: '#059669',
    swatchSecondary: '#34D399',
    vars: {
      '--color-primary':             'oklch(0.560 0.160 155)',
      '--color-primary-dark':        'oklch(0.460 0.170 155)',
      '--color-primary-light':       'oklch(0.670 0.150 155)',
      '--color-primary-ultra-light': 'oklch(0.970 0.015 155)',
      '--gradient-primary':          'linear-gradient(135deg, oklch(0.560 0.160 155) 0%, oklch(0.460 0.170 155) 100%)',
      '--shadow-glow-primary':       '0 0 0 3px oklch(0.560 0.160 155 / 0.18)',
      '--sidebar-bg':                'oklch(0.165 0.030 155)',
    },
  },
  {
    id: 'rose',
    name: 'Rose Gold',
    icon: 'Flower2',
    emoji: '🌹',
    swatch: '#E11D48',
    swatchSecondary: '#FB7185',
    vars: {
      '--color-primary':             'oklch(0.560 0.210 10)',
      '--color-primary-dark':        'oklch(0.460 0.220 10)',
      '--color-primary-light':       'oklch(0.670 0.190 10)',
      '--color-primary-ultra-light': 'oklch(0.975 0.012 10)',
      '--gradient-primary':          'linear-gradient(135deg, oklch(0.560 0.210 10) 0%, oklch(0.460 0.220 10) 100%)',
      '--shadow-glow-primary':       '0 0 0 3px oklch(0.560 0.210 10 / 0.18)',
      '--sidebar-bg':                'oklch(0.165 0.030 10)',
    },
  },
  {
    id: 'sunset',
    name: 'Sunset',
    icon: 'Sun',
    emoji: '🌅',
    swatch: '#EA580C',
    swatchSecondary: '#FB923C',
    vars: {
      '--color-primary':             'oklch(0.620 0.195 40)',
      '--color-primary-dark':        'oklch(0.520 0.205 40)',
      '--color-primary-light':       'oklch(0.720 0.175 40)',
      '--color-primary-ultra-light': 'oklch(0.975 0.012 40)',
      '--gradient-primary':          'linear-gradient(135deg, oklch(0.620 0.195 40) 0%, oklch(0.520 0.205 40) 100%)',
      '--shadow-glow-primary':       '0 0 0 3px oklch(0.620 0.195 40 / 0.18)',
      '--sidebar-bg':                'oklch(0.165 0.030 40)',
    },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    icon: 'Moon',
    emoji: '🌙',
    swatch: '#475569',
    swatchSecondary: '#94A3B8',
    vars: {
      '--color-primary':             'oklch(0.480 0.050 230)',
      '--color-primary-dark':        'oklch(0.380 0.040 230)',
      '--color-primary-light':       'oklch(0.600 0.045 230)',
      '--color-primary-ultra-light': 'oklch(0.970 0.008 230)',
      '--gradient-primary':          'linear-gradient(135deg, oklch(0.480 0.050 230) 0%, oklch(0.380 0.040 230) 100%)',
      '--shadow-glow-primary':       '0 0 0 3px oklch(0.480 0.050 230 / 0.15)',
      '--sidebar-bg':                'oklch(0.130 0.008 230)',
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
    return localStorage.getItem(THEME_KEY) ?? 'default';
  });

  const [mode, setModeState] = useState<ThemeMode>(() => {
    return (localStorage.getItem(MODE_KEY) as ThemeMode) ?? 'light';
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
