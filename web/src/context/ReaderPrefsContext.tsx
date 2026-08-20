import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePersistedState } from '../hooks/usePersistedState';
import type { ReaderFace, ReaderTheme, ResolvedReaderTheme } from '../lib/types';
import { READER_PREFS_KEY } from '../lib/storageKeys';
import { systemPrefersDark } from '../lib/uiPrefs';

export interface ReaderPrefs {
  theme: ReaderTheme;
  fs: number;
  lh: number;
  face: ReaderFace;
  allPali: boolean;
  // Whether the note-asterisk markers (Bhikkhu Sujato's translator notes — see SegmentedText.tsx) show
  // at all; "c" in the reader and the Theme tab's checkbox both flip this (see ReaderPage,
  // ReaderMenuPanel).
  showNotes: boolean;
}

interface ReaderPrefsState extends ReaderPrefs {
  // The theme actually rendered — 'system' resolved live against the OS preference (see the
  // provider's own matchMedia tracking below); 'light'/'sepia'/'dark' pass through unchanged.
  resolvedTheme: ResolvedReaderTheme;
  setTheme: (t: ReaderTheme) => void;
  setFs: (n: number) => void;
  setLh: (n: number) => void;
  setFace: (f: ReaderFace) => void;
  toggleAllPali: () => void;
  toggleShowNotes: () => void;
}

// Line height, as a percentage. The floor is deliberately generous: the reader's measure is 34em
// (~70 characters), and at that width anything below ~1.55 loses the line return — a setting nobody
// would keep. `lh` also drives the paragraph gap and the gap above interleaved Pali
// (see SegmentedText's paragraphGap), so the whole page breathes with it, not just the leading.
export const LH_MIN = 155;
export const LH_MAX = 205;
export const LH_STEP = 5;

const DEFAULTS: ReaderPrefs = { theme: 'system', fs: 18, lh: 175, face: 'georgia', allPali: false, showNotes: false };

const ReaderPrefsContext = createContext<ReaderPrefsState | null>(null);

export function ReaderPrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = usePersistedState<ReaderPrefs>(READER_PREFS_KEY, DEFAULTS);

  // Tracks the OS preference live (not just once at selection time) so a 'system' theme keeps
  // following it — mirrors UiPrefsContext's own system-theme tracking for the app shell, kept
  // separate since the reader applies explicit ThemeColors objects rather than a CSS class.
  const [systemDark, setSystemDark] = useState(() => systemPrefersDark());
  useEffect(() => {
    if (prefs.theme !== 'system') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemDark(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [prefs.theme]);

  const resolvedTheme: ResolvedReaderTheme = prefs.theme === 'system' ? (systemDark ? 'dark' : 'light') : prefs.theme;

  const value = useMemo<ReaderPrefsState>(
    () => ({
      ...prefs,
      // Clamped on read, not on write: a device that stored a value from an earlier, wider range
      // would otherwise keep rendering at a leading the slider can no longer reach or show.
      lh: Math.min(LH_MAX, Math.max(LH_MIN, prefs.lh)),
      resolvedTheme,
      setTheme: (theme) => setPrefs((p) => ({ ...p, theme })),
      setFs: (fs) => setPrefs((p) => ({ ...p, fs })),
      setLh: (lh) => setPrefs((p) => ({ ...p, lh })),
      setFace: (face) => setPrefs((p) => ({ ...p, face })),
      toggleAllPali: () => setPrefs((p) => ({ ...p, allPali: !p.allPali })),
      toggleShowNotes: () => setPrefs((p) => ({ ...p, showNotes: !p.showNotes })),
    }),
    [prefs, resolvedTheme, setPrefs]
  );

  return <ReaderPrefsContext.Provider value={value}>{children}</ReaderPrefsContext.Provider>;
}

export function useReaderPrefs() {
  const ctx = useContext(ReaderPrefsContext);
  if (!ctx) throw new Error('useReaderPrefs must be used within ReaderPrefsProvider');
  return ctx;
}
