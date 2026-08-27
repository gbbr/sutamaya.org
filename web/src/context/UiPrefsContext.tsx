import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePersistedState } from '../hooks/usePersistedState';
import {
  UI_PREFS_KEY,
  UI_PREFS_DEFAULTS,
  applyUiScale,
  applyTheme,
  systemPrefersDark,
  type UiPrefs,
} from '../lib/uiPrefs';
import type { AppTheme, ResolvedAppTheme } from '../lib/types';

interface UiPrefsState extends UiPrefs {
  // The theme actually rendered — 'system' resolved live against the OS preference, 'light'/'dark'
  // passed through. Settings' Theme picker shows the stored `theme` instead, since System is one of
  // the three tiles it offers; this is for anything that has to know which palette is on screen.
  resolvedTheme: ResolvedAppTheme;
  setUiScale: (n: number) => void;
  setTheme: (t: AppTheme) => void;
  // Flips to the opposite of what's on screen right now, so it also works from 'system' — and
  // leaves an explicit choice behind, which is what the user asked for by pressing the key.
  toggleTheme: () => void;
}

const UiPrefsContext = createContext<UiPrefsState | null>(null);

export function UiPrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = usePersistedState<UiPrefs>(UI_PREFS_KEY, UI_PREFS_DEFAULTS);

  // main.tsx applies the persisted values once, synchronously, before React mounts, so there is no
  // flash of the default scale on load. This effect keeps the DOM in sync from then on.
  useEffect(() => {
    applyUiScale(prefs.uiScale);
  }, [prefs.uiScale]);
  // The default 'system' needs to keep tracking the OS preference live, not just resolve it once
  // at load — mirrors ReaderPrefsContext's tracking for the reader's own theme.
  const [systemDark, setSystemDark] = useState(() => systemPrefersDark());
  useEffect(() => {
    if (prefs.theme !== 'system') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemDark(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [prefs.theme]);

  const resolvedTheme: ResolvedAppTheme = prefs.theme === 'system' ? (systemDark ? 'dark' : 'light') : prefs.theme;

  useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  const value = useMemo<UiPrefsState>(
    () => ({
      ...prefs,
      resolvedTheme,
      setUiScale: (uiScale) => setPrefs((p) => ({ ...p, uiScale })),
      setTheme: (theme) => setPrefs((p) => ({ ...p, theme })),
      // Resolves inside the updater rather than closing over `resolvedTheme`: LibraryPage's keydown
      // listener subscribes on a partial dependency list, so it can hold an older copy of this
      // function than the current theme.
      toggleTheme: () =>
        setPrefs((p) => ({ ...p, theme: p.theme === 'dark' || (p.theme === 'system' && systemPrefersDark()) ? 'light' : 'dark' })),
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
