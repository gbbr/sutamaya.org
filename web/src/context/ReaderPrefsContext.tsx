import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { usePersistedState } from '../hooks/usePersistedState';
import type { ReaderFace, ReaderTheme } from '../lib/types';

interface ReaderPrefs {
  theme: ReaderTheme;
  fs: number;
  lh: number;
  face: ReaderFace;
  allPali: boolean;
}

interface ReaderPrefsState extends ReaderPrefs {
  setTheme: (t: ReaderTheme) => void;
  setFs: (n: number) => void;
  setLh: (n: number) => void;
  setFace: (f: ReaderFace) => void;
  toggleAllPali: () => void;
}

const DEFAULTS: ReaderPrefs = { theme: 'light', fs: 18, lh: 165, face: 'serif', allPali: false };

const ReaderPrefsContext = createContext<ReaderPrefsState | null>(null);

export function ReaderPrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = usePersistedState<ReaderPrefs>('sutamaya.readerPrefs', DEFAULTS);

  const value = useMemo<ReaderPrefsState>(
    () => ({
      ...prefs,
      setTheme: (theme) => setPrefs((p) => ({ ...p, theme })),
      setFs: (fs) => setPrefs((p) => ({ ...p, fs })),
      setLh: (lh) => setPrefs((p) => ({ ...p, lh })),
      setFace: (face) => setPrefs((p) => ({ ...p, face })),
      toggleAllPali: () => setPrefs((p) => ({ ...p, allPali: !p.allPali })),
    }),
    [prefs, setPrefs]
  );

  return <ReaderPrefsContext.Provider value={value}>{children}</ReaderPrefsContext.Provider>;
}

export function useReaderPrefs() {
  const ctx = useContext(ReaderPrefsContext);
  if (!ctx) throw new Error('useReaderPrefs must be used within ReaderPrefsProvider');
  return ctx;
}
