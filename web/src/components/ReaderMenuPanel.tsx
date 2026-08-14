import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useUserData } from '../context/UserDataContext';
import { useAuth } from '../context/AuthContext';
import { useReaderPrefs } from '../context/ReaderPrefsContext';
import { NoteEditor } from './NoteEditor';
import { ListMembershipPicker } from './ListMembershipPicker';
import type { SegmentFile } from '../lib/corpus';
import { highlightGroupText, type HighlightGroup } from '../lib/highlights';
import { highlightPaint } from '../lib/theme';
import type { ReaderFace, ReaderTheme, ThemeColors } from '../lib/types';

interface ReaderMenuPanelProps {
  suttaId: string;
  mobile: boolean;
  theme: ThemeColors;
  initialTab: 'highlights' | 'lists' | 'text';
  segments: SegmentFile[] | null;
  // ReaderPage/useSuttaReading already group this sutta's highlights once via groupHighlights —
  // passed down rather than re-derived here so the same computation isn't done twice per render.
  highlightGroups: HighlightGroup[];
  onClose: () => void;
  onJumpToHighlight: (segIndex: number, highlightId?: string) => void;
  // See NoteEditor's `focusSignal` — bumped by ReaderPage's "n" shortcut to focus the note box
  // even if this panel (and its highlights tab) is already open.
  noteFocusSignal?: number;
  // Lets ReaderPage react when the user switches tab from inside the already-open panel (e.g. to
  // dismiss an open DictionaryDock when landing on the Theme tab's mobile sheet — see ReaderPage).
  onTabChange?: (tab: 'highlights' | 'lists' | 'text') => void;
}

// Order matches the app-shell Theme picker (Settings > Theme): Light, Dark, System — with
// Sepia, which has no app-shell equivalent, appended after. Every swatch's label is rendered
// with mix-blend-mode: difference over white (see below) rather than a hand-picked `fg` per
// swatch, so the System tile's half-light/half-dark preview gets automatic contrast on both
// halves for free, using the same mechanism as the solid-color tiles.
const THEME_SWATCHES: Array<{ id: ReaderTheme; label: string; bg: string }> = [
  { id: 'light', label: 'Light', bg: '#FBFAF7' },
  { id: 'dark', label: 'Dark', bg: '#2A241E' },
  { id: 'system', label: 'System', bg: 'linear-gradient(90deg,#FBFAF7 50%,#2A241E 50%)' },
  { id: 'sepia', label: 'Sepia', bg: '#F3E7D3' },
];
const FACE_OPTIONS: Array<{ id: ReaderFace; label: string }> = [
  { id: 'serif', label: 'Newsreader' },
  { id: 'georgia', label: 'Georgia' },
  { id: 'sans', label: 'Sans' },
  { id: 'times', label: 'Times' },
  { id: 'system', label: 'System' },
];

export function ReaderMenuPanel({
  suttaId,
  mobile,
  theme,
  initialTab,
  segments,
  highlightGroups,
  onClose,
  onJumpToHighlight,
  noteFocusSignal,
  onTabChange,
}: ReaderMenuPanelProps) {
  const [tab, setTab] = useState(initialTab);
  const { user, promptGoogleSignIn } = useAuth();
  const { notes, submitNote } = useUserData();
  const { theme: currentTheme, setTheme, fs, setFs, lh, setLh, face, setFace, allPali, toggleAllPali, showNotes, toggleShowNotes } =
    useReaderPrefs();

  // The Theme tab has no text inputs, so on mobile it renders as a short bottom sheet instead of
  // going full-screen — leaving the reader visible above it so font/line-height/theme changes can
  // be seen live while adjusting them (see below). Highlights and Lists stay full-screen and
  // top-anchored (not a bottom sheet): their inputs (Lists' auto-focused search/create field;
  // Highlights' note textarea) need to stay above the on-screen keyboard, and this container is
  // `position: absolute` inside ReaderPage's `fixed inset-0` root, which stays pinned to the full
  // layout-viewport height and doesn't shrink for the keyboard, so anything anchored to its
  // *bottom* (the old `bottom: 0; maxHeight: 74%` sheet this used to be) ends up hidden beneath
  // the keyboard rather than pushed up above it.
  const isThemeSheet = mobile && tab === 'text';
  // Only the initial mount should play an entrance animation — once mounted, switching tabs
  // changes `panelStyle`/shape live (see below) and should snap instantly, not replay a
  // slide-up/fade-in on every tab tap.
  const hasEnteredRef = useRef(false);
  useEffect(() => {
    hasEnteredRef.current = true;
  }, []);

  const panelStyle = isThemeSheet
    ? {
        position: 'absolute' as const,
        left: 0,
        right: 0,
        bottom: 0,
        maxHeight: '62vh',
        display: 'flex',
        flexDirection: 'column' as const,
        background: theme.panel,
        color: theme.fg,
        padding: '14px 20px 18px',
        paddingBottom: 'calc(18px + env(safe-area-inset-bottom, 0px))',
      }
    : mobile
    ? {
        position: 'absolute' as const,
        inset: 0,
        display: 'flex',
        flexDirection: 'column' as const,
        background: theme.panel,
        color: theme.fg,
        padding: '18px 20px 22px',
        paddingTop: 'calc(18px + env(safe-area-inset-top, 0px))',
      }
    : {
        position: 'absolute' as const,
        top: 0,
        right: 0,
        bottom: 0,
        width: 340,
        display: 'flex',
        flexDirection: 'column' as const,
        background: theme.panel,
        color: theme.fg,
        borderLeft: `2px solid ${theme.fg}`,
        padding: '18px 20px 22px',
      };

  const entranceClass = hasEnteredRef.current ? '' : isThemeSheet ? 'animate-sheetUp' : 'animate-fadeIn';
  const panelClassName = `${isThemeSheet ? 'rounded-t-sheet shadow-sheet' : ''} ${entranceClass}`.trim();

  const tabBtn = (id: 'highlights' | 'lists' | 'text', label: string) => (
    <button
      key={id}
      className="flex-1 text-center pb-2.5 font-sans text-[11px] font-bold tracking-[.1em] uppercase"
      style={{
        color: theme.fg,
        opacity: tab === id ? 1 : 0.5,
        borderBottom: `2px solid ${tab === id ? theme.fg : 'transparent'}`,
        marginBottom: -1,
      }}
      onClick={() => {
        setTab(id);
        onTabChange?.(id);
      }}
    >
      {label}
    </button>
  );

  const ctlRowStyle = { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0', borderTop: `1px solid ${theme.rule}` };
  const pill = (on: boolean) => ({
    borderRadius: 14,
    padding: '5px 13px',
    fontSize: 12.5,
    border: `1px solid ${theme.rule}`,
    background: on ? theme.fg : 'transparent',
    color: on ? theme.bg : theme.fg,
  });

  return (
    <>
      {/* Full-screen (Highlights/Lists on mobile) leaves no backdrop to tap-to-close — mobile gets
          an explicit close button in the header row instead (below). The Theme sheet is partial-
          height, so it gets a backdrop too: tapping the dimmed reader text above it closes it. */}
      {(!mobile || isThemeSheet) && <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,.12)' }} onClick={onClose} />}
      <div data-component="ReaderMenuPanel" style={panelStyle} className={panelClassName}>
        <div className="flex items-end gap-2 mb-4">
          {mobile && (
            <button
              className="flex-none flex items-center justify-center pb-2.5"
              style={{ borderBottom: '2px solid transparent', marginBottom: -1 }}
              title="Close"
              onClick={onClose}
            >
              <X size={17} strokeWidth={1.75} />
            </button>
          )}
          <div className="flex flex-1 gap-1" style={{ borderBottom: `1px solid ${theme.rule}` }}>
            {tabBtn('highlights', 'Highlights')}
            {tabBtn('lists', 'Lists')}
            {tabBtn('text', 'Theme')}
          </div>
        </div>

        {tab === 'highlights' && !user && (
          <div className="sc flex-1 min-h-0 flex flex-col items-center gap-3 py-6 text-center">
            <p className="font-sans text-[13.5px]" style={{ color: theme.fg, opacity: 0.6 }}>
              Sign in to save notes and highlights.
            </p>
            <button
              className="font-sans text-[13px] font-semibold px-4 py-[9px] rounded-full"
              style={{ background: theme.fg, color: theme.bg }}
              onClick={promptGoogleSignIn}
            >
              Sign in
            </button>
          </div>
        )}

        {tab === 'highlights' && user && (
          <div className="sc flex-1 min-h-0">
            <div className="rounded-field mb-3.5 p-[11px_13px]" style={{ border: `1px solid ${theme.rule}`, padding: '11px 13px' }}>
              <div className="font-sans text-[10.5px] font-bold tracking-[.12em] uppercase opacity-60 mb-[5px]">Sutta note</div>
              <NoteEditor
                value={notes[suttaId] || ''}
                onSubmit={(text) => submitNote(suttaId, text)}
                focusSignal={noteFocusSignal}
                placeholder="Add a note — return to save"
                textareaClassName="w-full bg-transparent text-[16px] resize-none outline-none font-serif"
                textareaStyle={{ border: 0, color: theme.fg }}
                saveButtonClassName="mt-1.5 font-sans text-[11.5px] font-semibold px-2 py-[3px] rounded"
                saveButtonStyle={{ border: `1px solid ${theme.rule}`, color: theme.fg }}
              />
            </div>
            {highlightGroups.map((g) => (
              <button
                key={g.key}
                className="flex w-full gap-2.5 items-start py-2.5 text-left"
                style={{ borderBottom: `1px solid ${theme.rule}` }}
                onClick={() => onJumpToHighlight(g.i, g.key)}
              >
                <span className="w-[5px] self-stretch rounded-[3px] flex-none" style={{ background: highlightPaint(g.c, theme) }} />
                <span className="flex-1 text-sm leading-[1.45]">{highlightGroupText(g, segments).slice(0, 92) || `Segment ${g.i + 1}`}</span>
              </button>
            ))}
            {highlightGroups.length === 0 && (
              <div className="font-sans text-[12.5px] opacity-40 py-1.5">Select text in the reading, then pick a colour.</div>
            )}
          </div>
        )}

        {tab === 'lists' && (
          <div className="sc flex-1 min-h-0">
            <ListMembershipPicker suttaId={suttaId} theme={theme} autoFocus onRequestClose={onClose} />
          </div>
        )}

        {tab === 'text' && (
          <div className="sc flex-1 min-h-0">
            <div className="flex gap-[9px] mb-1.5">
              {THEME_SWATCHES.map((t) => (
                <button
                  key={t.id}
                  className="relative flex-1 h-[52px] rounded-[10px] text-[14.5px] overflow-hidden"
                  style={{ border: `1px solid ${currentTheme === t.id ? theme.fg : theme.rule}` }}
                  onClick={() => setTheme(t.id)}
                >
                  <span className="absolute inset-0" style={{ background: t.bg }} />
                  <span className="relative" style={{ color: '#fff', mixBlendMode: 'difference' }}>
                    {t.label}
                  </span>
                </button>
              ))}
            </div>
            <div style={ctlRowStyle}>
              <span className="font-sans text-[12.5px] opacity-55" style={{ width: 86 }}>
                Size
              </span>
              <input type="range" min={15} max={24} step={1} value={fs} onChange={(e) => setFs(+e.target.value)} className="flex-1" style={{ accentColor: '#8A6A3B' }} />
            </div>
            <div style={ctlRowStyle}>
              <span className="font-sans text-[12.5px] opacity-55" style={{ width: 86 }}>
                Line height
              </span>
              <input type="range" min={140} max={200} step={5} value={lh} onChange={(e) => setLh(+e.target.value)} className="flex-1" style={{ accentColor: '#8A6A3B' }} />
            </div>
            <div style={{ padding: '12px 0', borderTop: `1px solid ${theme.rule}` }}>
              <span className="font-sans text-[12.5px] opacity-55 block mb-2">Face</span>
              <div className="grid grid-cols-3 gap-2">
                {FACE_OPTIONS.map((f) => (
                  <button
                    key={f.id}
                    style={{ ...pill(face === f.id), fontSize: 12, padding: '5px 10px', textAlign: 'center' }}
                    onClick={() => setFace(f.id)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={ctlRowStyle}>
              <span className="font-sans text-[12.5px] opacity-55" style={{ width: 86 }}>
                Pali
              </span>
              <button style={pill(allPali)} onClick={toggleAllPali}>
                {allPali ? 'Always shown' : 'On tap'}
              </button>
            </div>
            <div style={ctlRowStyle}>
              <label className="flex items-center gap-2 font-sans text-[12.5px]" style={{ width: 86 }}>
                <input
                  type="checkbox"
                  checked={showNotes}
                  onChange={toggleShowNotes}
                  style={{ accentColor: '#8A6A3B', width: 15, height: 15 }}
                />
                Notes
              </label>
              <span className="flex-1 text-[12.5px] opacity-55">Translator's notes (also "c")</span>
            </div>
            <div style={ctlRowStyle}>
              <span className="font-sans text-[12.5px] opacity-55" style={{ width: 86 }}>
                Source
              </span>
              <span className="flex-1 text-[14.5px]">Sujato (2018), edited</span>
              <span className="font-sans text-[12.5px] opacity-45" style={{ display: 'none' }}>change</span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
