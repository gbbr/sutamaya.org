import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { usePersistedState } from '../hooks/usePersistedState';
import { UI_PREFS_KEY, UI_PREFS_DEFAULTS, applyUiScale, applyUiFace, type UiPrefs } from '../lib/uiPrefs';
import type { ReaderFace } from '../lib/types';

interface UiPrefsState extends UiPrefs {
  setUiScale: (n: number) => void;
  setUiFace: (f: ReaderFace) => void;
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

  const value = useMemo<UiPrefsState>(
    () => ({
      ...prefs,
      setUiScale: (uiScale) => setPrefs((p) => ({ ...p, uiScale })),
      setUiFace: (uiFace) => setPrefs((p) => ({ ...p, uiFace })),
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
