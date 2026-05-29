import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Appearance, useColorScheme } from 'react-native';

import { darkTheme, lightTheme } from '@/constants/theme';
import { fetchCloudSettings, pushSettingsToCloud } from '@/lib/sync';

export type ThemeMode = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'app_theme_mode';
const HUE_KEY = 'app_accent_hue';
const DEFAULT_HUE = 258;

const syncAppearanceColorScheme = (mode: ThemeMode) => {
  if (typeof Appearance.setColorScheme !== 'function') return;
  Appearance.setColorScheme(mode === 'system' ? 'unspecified' : mode);
};

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function hslToRgbString(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)));
  };
  return `${f(0)},${f(8)},${f(4)}`;
}

type ThemeContextValue = {
  theme: typeof lightTheme;
  themeMode: ThemeMode;
  isDark: boolean;
  setThemeMode: (mode: ThemeMode) => void;
  accentHue: number;
  setAccentHue: (hue: number) => void;
  applyCloudTheme: (mode: ThemeMode, hue: number) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const colorScheme = useColorScheme();
  const [themeMode, setThemeModeState] = useState<ThemeMode>('system');
  const [accentHue, setAccentHueState] = useState<number>(DEFAULT_HUE);
  const accentHuePushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((value) => {
        const nextMode: ThemeMode =
          value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
        setThemeModeState(nextMode);
        syncAppearanceColorScheme(nextMode);
      })
      .catch(() => {
        syncAppearanceColorScheme('system');
      });
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(HUE_KEY)
      .then((value) => {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 360) {
          setAccentHueState(parsed);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchCloudSettings().then((cloud) => {
      if (!cloud) return;
      setThemeModeState(cloud.themeMode);
      syncAppearanceColorScheme(cloud.themeMode);
      AsyncStorage.setItem(STORAGE_KEY, cloud.themeMode).catch(() => {});
      setAccentHueState(cloud.accentHue);
      AsyncStorage.setItem(HUE_KEY, String(cloud.accentHue)).catch(() => {});
      AsyncStorage.setItem('app_language', cloud.language).catch(() => {});
    }).catch(() => {});
  }, []);

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
    syncAppearanceColorScheme(mode);
    AsyncStorage.setItem(STORAGE_KEY, mode).catch(() => {});
    void AsyncStorage.multiGet([HUE_KEY, 'app_language']).then(([[, hue], [, lang]]) => {
      const h = Number(hue);
      void pushSettingsToCloud({ themeMode: mode, accentHue: Number.isFinite(h) ? h : DEFAULT_HUE, language: lang === 'ru' ? 'ru' : 'en' });
    });
  }, []);

  const setAccentHue = useCallback((hue: number) => {
    const clamped = Math.round(Math.max(0, Math.min(360, hue)));
    setAccentHueState(clamped);
    AsyncStorage.setItem(HUE_KEY, String(clamped)).catch(() => {});
    if (accentHuePushTimer.current) clearTimeout(accentHuePushTimer.current);
    accentHuePushTimer.current = setTimeout(() => {
      accentHuePushTimer.current = null;
      void AsyncStorage.multiGet([STORAGE_KEY, 'app_language']).then(([[, mode], [, lang]]) => {
        const tm = mode === 'light' || mode === 'dark' ? mode : 'system';
        void pushSettingsToCloud({ themeMode: tm, accentHue: clamped, language: lang === 'ru' ? 'ru' : 'en' });
      });
    }, 800);
  }, []);

  const applyCloudTheme = useCallback((mode: ThemeMode, hue: number) => {
    setThemeModeState(mode);
    syncAppearanceColorScheme(mode);
    AsyncStorage.setItem(STORAGE_KEY, mode).catch(() => {});
    const clamped = Math.round(Math.max(0, Math.min(360, hue)));
    setAccentHueState(clamped);
    AsyncStorage.setItem(HUE_KEY, String(clamped)).catch(() => {});
  }, []);

  const value = useMemo<ThemeContextValue>(() => {
    const systemScheme = colorScheme === 'dark' ? 'dark' : 'light';
    const effectiveScheme = themeMode === 'system' ? systemScheme : themeMode;
    const isDark = effectiveScheme === 'dark';
    const base = isDark ? darkTheme : lightTheme;

    const accentS = isDark ? 80 : 78.5;
    const accentL = isDark ? 54 : 58.2;
    const accentH = isDark ? (accentHue - 8 + 360) % 360 : accentHue;
    const accent = hslToHex(accentH, accentS, accentL);
    const accentRgb = hslToRgbString(accentH, accentS, accentL);
    const accentRefresh = hslToHex(accentHue, isDark ? 74 : 72, isDark ? 60 : 64);
    const accentSoft = accent;

    const theme = {
      ...base,
      colors: {
        ...base.colors,
        accent,
        accentSoft,
        indicator: accent,
        accentRefresh,
        accentSurface: `rgba(${accentRgb},0.12)`,
      },
    };

    return { theme, themeMode, isDark, setThemeMode, accentHue, setAccentHue, applyCloudTheme };
  }, [colorScheme, setThemeMode, themeMode, accentHue, setAccentHue, applyCloudTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeController() {
  const context = use(ThemeContext);
  if (!context) {
    throw new Error('useThemeController must be used within AppThemeProvider');
  }
  return context;
}

export function useTheme() {
  return useThemeController().theme;
}
