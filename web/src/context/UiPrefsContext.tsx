import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePersistedState } from '../hooks/usePersistedState';
import {
  UI_PREFS_KEY,
  UI_PREFS_DEFAULTS,
  applyUiScale,
  applyTheme,
  systemPrefersDark,
  type UiPrefs,
} from '../lib/ui/uiPrefs';
import type { Theme, ResolvedTheme } from '../lib/types';

interface UiPrefsState extends UiPrefs {
  // The theme on screen, with 'system' resolved live against the OS preference. Settings' picker
  // shows the stored `theme` instead, since System is one of its tiles.
  resolvedTheme: ResolvedTheme;
  setUiScale: (n: number) => void;
  setTheme: (t: Theme) => void;
  // Pins the theme to light or dark, the opposite of what is on screen, so it also works from
  // 'system'. Sepia counts as light.
  toggleTheme: () => void;
  // Steps the theme light -> sepia -> dark -> light, from whichever is on screen.
  cycleTheme: () => void;
}

// The order cycleTheme walks.
const THEME_CYCLE: Record<ResolvedTheme, ResolvedTheme> = { light: 'sepia', sepia: 'dark', dark: 'light' };

// resolveTheme returns the theme on screen for a stored one.
function resolveTheme(theme: Theme, systemDark: boolean): ResolvedTheme {
  return theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
}

const UiPrefsContext = createContext<UiPrefsState | null>(null);

export function UiPrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = usePersistedState<UiPrefs>(UI_PREFS_KEY, UI_PREFS_DEFAULTS);

  // Keeps the DOM's scale in step from mount onwards; main.tsx applies the persisted value once
  // before React mounts, so the page never flashes at the default.
  useEffect(() => {
    applyUiScale(prefs.uiScale);
  }, [prefs.uiScale]);
  // The OS dark-mode preference, tracked live while the theme is 'system'.
  const [systemDark, setSystemDark] = useState(() => systemPrefersDark());
  useEffect(() => {
    if (prefs.theme !== 'system') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemDark(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [prefs.theme]);

  const resolvedTheme = resolveTheme(prefs.theme, systemDark);

  useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  const value = useMemo<UiPrefsState>(
    () => ({
      ...prefs,
      resolvedTheme,
      setUiScale: (uiScale) => setPrefs((p) => ({ ...p, uiScale })),
      setTheme: (theme) => setPrefs((p) => ({ ...p, theme })),
      // Both resolve inside the updater rather than closing over `resolvedTheme`, since a keydown
      // listener can hold an older copy of these functions than the current theme.
      toggleTheme: () =>
        setPrefs((p) => ({ ...p, theme: resolveTheme(p.theme, systemPrefersDark()) === 'dark' ? 'light' : 'dark' })),
      cycleTheme: () => setPrefs((p) => ({ ...p, theme: THEME_CYCLE[resolveTheme(p.theme, systemPrefersDark())] })),
    }),
    [prefs, resolvedTheme, setPrefs]
  );

  return <UiPrefsContext.Provider value={value}>{children}</UiPrefsContext.Provider>;
}

export function useUiPrefs() {
  const ctx = useContext(UiPrefsContext);
  if (!ctx) throw new Error('useUiPrefs must be used within UiPrefsProvider');
  return ctx;
}
