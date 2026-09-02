import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePersistedState } from '../hooks/usePersistedState';
import type { ReaderFace, ReaderTheme, ResolvedReaderTheme } from '../lib/types';
import { READER_PREFS_KEY } from '../lib/storageKeys';
import { READER_FACES } from '../lib/theme';
import { systemPrefersDark } from '../lib/uiPrefs';

export interface ReaderPrefs {
  theme: ReaderTheme;
  // Body text size, in px.
  fs: number;
  // Line height, as a percentage.
  lh: number;
  face: ReaderFace;
  // Show every segment's Pali, rather than only the ones the reader taps.
  allPali: boolean;
  // Put the Pali above the English. Applies only with `allPali` on.
  paliAbove: boolean;
  // Show the asterisk markers for the translator's notes.
  showNotes: boolean;
  // Paint the reader's highlights over the text.
  showHighlights: boolean;
}

interface ReaderPrefsState extends ReaderPrefs {
  // The theme on screen, with 'system' resolved against the OS preference.
  resolvedTheme: ResolvedReaderTheme;
  setTheme: (t: ReaderTheme) => void;
  // Steps the theme light -> sepia -> dark -> light, from whichever is on screen.
  cycleTheme: () => void;
  setFs: (n: number) => void;
  setLh: (n: number) => void;
  setFace: (f: ReaderFace) => void;
  toggleAllPali: () => void;
  togglePaliAbove: () => void;
  toggleShowNotes: () => void;
  toggleShowHighlights: () => void;
  // Turns highlights on, whatever the current setting.
  revealHighlights: () => void;
}

// Range of the reader's line-height control, as a percentage.
export const LH_MIN = 155;
export const LH_MAX = 205;
export const LH_STEP = 5;

// Range of the reader's text-size control, in px.
export const FS_MIN = 15;
export const FS_MAX = 28;
export const FS_STEP = 1;

const DEFAULTS: ReaderPrefs = {
  theme: 'system',
  fs: 18,
  lh: 175,
  face: 'georgia',
  allPali: false,
  paliAbove: false,
  showNotes: false,
  showHighlights: true,
};

// The order cycleTheme walks.
const THEME_CYCLE: Record<ResolvedReaderTheme, ResolvedReaderTheme> = { light: 'sepia', sepia: 'dark', dark: 'light' };

const ReaderPrefsContext = createContext<ReaderPrefsState | null>(null);

export function ReaderPrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = usePersistedState<ReaderPrefs>(READER_PREFS_KEY, DEFAULTS);

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

  const resolvedTheme: ResolvedReaderTheme = prefs.theme === 'system' ? (systemDark ? 'dark' : 'light') : prefs.theme;

  const value = useMemo<ReaderPrefsState>(
    () => ({
      ...prefs,
      // Stored size, leading and face, held to what the controls can currently reach.
      fs: Math.min(FS_MAX, Math.max(FS_MIN, prefs.fs)),
      lh: Math.min(LH_MAX, Math.max(LH_MIN, prefs.lh)),
      face: prefs.face in READER_FACES ? prefs.face : DEFAULTS.face,
      resolvedTheme,
      setTheme: (theme) => setPrefs((p) => ({ ...p, theme })),
      cycleTheme: () =>
        setPrefs((p) => ({
          ...p,
          theme: THEME_CYCLE[p.theme === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : p.theme],
        })),
      setFs: (fs) => setPrefs((p) => ({ ...p, fs })),
      setLh: (lh) => setPrefs((p) => ({ ...p, lh })),
      setFace: (face) => setPrefs((p) => ({ ...p, face })),
      toggleAllPali: () => setPrefs((p) => ({ ...p, allPali: !p.allPali })),
      togglePaliAbove: () => setPrefs((p) => ({ ...p, paliAbove: !p.paliAbove })),
      toggleShowNotes: () => setPrefs((p) => ({ ...p, showNotes: !p.showNotes })),
      toggleShowHighlights: () => setPrefs((p) => ({ ...p, showHighlights: !p.showHighlights })),
      revealHighlights: () => setPrefs((p) => (p.showHighlights ? p : { ...p, showHighlights: true })),
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
