import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePersistedState } from '../hooks/usePersistedState';
import type { ReaderFace, ReaderTheme, ResolvedReaderTheme } from '../lib/types';
import { READER_PREFS_KEY } from '../lib/storageKeys';
import { READER_FACES } from '../lib/theme';
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
  // Whether the user's own highlights are painted over the text. Off leaves the prose clean while
  // the gutter marks (HighlightGutter) still show where they are — that strip is what says the
  // highlights are only hidden, not gone, so nothing else indicates the state. The reader turns it
  // back on by itself whenever an action creates or targets a specific highlight (see ReaderPage).
  showHighlights: boolean;
}

interface ReaderPrefsState extends ReaderPrefs {
  // The theme actually rendered — 'system' resolved live against the OS preference (see the
  // provider's own matchMedia tracking below); 'light'/'sepia'/'dark' pass through unchanged.
  resolvedTheme: ResolvedReaderTheme;
  setTheme: (t: ReaderTheme) => void;
  // Steps light -> sepia -> dark -> light. Starts from what's actually on screen, so it also
  // works from 'system', and always lands on an explicit theme — 'system' is a setting you pick
  // in the panel, not a stop on a cycle.
  cycleTheme: () => void;
  setFs: (n: number) => void;
  setLh: (n: number) => void;
  setFace: (f: ReaderFace) => void;
  toggleAllPali: () => void;
  toggleShowNotes: () => void;
  toggleShowHighlights: () => void;
  // Turns highlights back on unconditionally, for the paths that auto-reveal them. Separate from
  // the toggle because those callers mean "make sure these are visible", not "flip whatever this
  // is" — several of them fire on actions the user may repeat.
  revealHighlights: () => void;
}

// Line height, as a percentage. The floor is generous because the reader's measure is 34em, about
// 70 characters, and at that width anything below ~1.55 loses the line return. `lh` also drives the
// paragraph gap and the gap above interleaved Pali (SegmentedText's paragraphGap), so the whole
// page breathes with it rather than just the leading.
export const LH_MIN = 155;
export const LH_MAX = 205;
export const LH_STEP = 5;

// Body text size, in px. The floor is where the reader's 34em measure still holds a comfortable
// line on a phone; the ceiling reaches far enough for a tablet at arm's length or a reader who
// needs large text, and stops before the docked dictionary and the interleaved Pali crowd.
export const FS_MIN = 15;
export const FS_MAX = 28;
export const FS_STEP = 1;

const DEFAULTS: ReaderPrefs = {
  theme: 'system',
  fs: 18,
  lh: 175,
  face: 'georgia',
  allPali: false,
  showNotes: false,
  showHighlights: true,
};

// The order cycleTheme walks — light to dark by way of sepia, so each press is a small step.
const THEME_CYCLE: Record<ResolvedReaderTheme, ResolvedReaderTheme> = { light: 'sepia', sepia: 'dark', dark: 'light' };

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
      // Clamped on read rather than on write, so a device holding a value from a wider earlier
      // range doesn't render at a size the stepper can't reach, with its "−"/"+" sitting disabled.
      fs: Math.min(FS_MAX, Math.max(FS_MIN, prefs.fs)),
      lh: Math.min(LH_MAX, Math.max(LH_MIN, prefs.lh)),
      // The same, for a face id the picker no longer offers: READER_FACES would answer `undefined`
      // and the reader would render with no font-family at all.
      face: prefs.face in READER_FACES ? prefs.face : DEFAULTS.face,
      resolvedTheme,
      setTheme: (theme) => setPrefs((p) => ({ ...p, theme })),
      // Resolves inside the updater rather than closing over `resolvedTheme`: useReaderKeyboard's
      // listener subscribes on a partial dependency list and can hold an older copy of this
      // function than the current theme.
      cycleTheme: () =>
        setPrefs((p) => ({
          ...p,
          theme: THEME_CYCLE[p.theme === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : p.theme],
        })),
      setFs: (fs) => setPrefs((p) => ({ ...p, fs })),
      setLh: (lh) => setPrefs((p) => ({ ...p, lh })),
      setFace: (face) => setPrefs((p) => ({ ...p, face })),
      toggleAllPali: () => setPrefs((p) => ({ ...p, allPali: !p.allPali })),
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
