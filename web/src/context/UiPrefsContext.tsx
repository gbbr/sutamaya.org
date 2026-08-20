import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { usePersistedState } from '../hooks/usePersistedState';
import { UI_PREFS_KEY, UI_PREFS_DEFAULTS, applyUiScale, applyUiFace, applyTheme, type UiPrefs } from '../lib/uiPrefs';
import type { AppTheme, ReaderFace } from '../lib/types';

interface UiPrefsState extends UiPrefs {
  setUiScale: (n: number) => void;
  setUiFace: (f: ReaderFace) => void;
  setTheme: (t: AppTheme) => void;
}

const UiPrefsContext = createContext<UiPrefsState | null>(null);

export function UiPrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = usePersistedState<UiPrefs>(UI_PREFS_KEY, UI_PREFS_DEFAULTS);

  // main.tsx already applies the persisted values once, synchronously, before React mounts (so
  // there's no flash of the default scale/font on load) — these effects just keep the DOM in
  // sync whenever the user actually changes a setting from here on.
  useEffect(() => {
    applyUiScale(prefs.uiScale);
  }, [prefs.uiScale]);
  useEffect(() => {
    applyUiFace(prefs.uiFace);
  }, [prefs.uiFace]);
  // A 'system' selection needs to keep tracking the OS preference live, not just resolve it once
  // at selection time.
  useEffect(() => {
    applyTheme(prefs.theme);
    if (prefs.theme !== 'system') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme(prefs.theme);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [prefs.theme]);

  const value = useMemo<UiPrefsState>(
    () => ({
      ...prefs,
      setUiScale: (uiScale) => setPrefs((p) => ({ ...p, uiScale })),
      setUiFace: (uiFace) => setPrefs((p) => ({ ...p, uiFace })),
      setTheme: (theme) => setPrefs((p) => ({ ...p, theme })),
    }),
    [prefs, setPrefs]
  );

  return <UiPrefsContext.Provider value={value}>{children}</UiPrefsContext.Provider>;
}

export function useUiPrefs() {
  const ctx = useContext(UiPrefsContext);
  if (!ctx) throw new Error('useUiPrefs must be used within UiPrefsProvider');
  return ctx;
}
