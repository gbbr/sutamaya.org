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
  // sync whenever the user actually changes a setting from here on. applyUiScale itself bakes in
  // a mobile-only boost read straight off window.innerWidth (see lib/uiPrefs.ts), so it also
  // needs re-running on resize — not just when the preference value changes — to pick up
  // crossing the mobile breakpoint (e.g. rotating a tablet, resizing a window).
  useEffect(() => {
    applyUiScale(prefs.uiScale);
    const onResize = () => applyUiScale(prefs.uiScale);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [prefs.uiScale]);
  useEffect(() => {
    applyUiFace(prefs.uiFace);
  }, [prefs.uiFace]);
  // A 'system' selection needs to keep tracking the OS preference live (not just resolve it once
  // at selection time) — the resize-style re-run pattern above doesn't apply here since there's
  // a dedicated change event for exactly this instead of a generic one to re-check on.
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
