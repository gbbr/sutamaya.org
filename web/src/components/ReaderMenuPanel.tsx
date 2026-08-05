import { useMemo, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { useUserData } from '../context/UserDataContext';
import { useReaderPrefs } from '../context/ReaderPrefsContext';
import { NoteEditor } from './NoteEditor';
import { ListMembershipPicker } from './ListMembershipPicker';
import type { SegmentFile } from '../lib/corpus';
import { groupHighlights, highlightGroupText } from '../lib/highlights';
import type { ReaderFace, ReaderTheme, ThemeColors } from '../lib/types';

interface ReaderMenuPanelProps {
  suttaId: string;
  mobile: boolean;
  theme: ThemeColors;
  initialTab: 'highlights' | 'lists' | 'text';
  segments: SegmentFile[] | null;
  onClose: () => void;
  onJumpToHighlight: (segIndex: number) => void;
  // See NoteEditor's `focusSignal` — bumped by ReaderPage's "n" shortcut to focus the note box
  // even if this panel (and its highlights tab) is already open.
  noteFocusSignal?: number;
}

const THEME_SWATCHES: Array<{ id: ReaderTheme; label: string; bg: string; fg: string }> = [
  { id: 'light', label: 'Light', bg: '#FBFAF7', fg: '#1B1917' },
  { id: 'sepia', label: 'Sepia', bg: '#F3E7D3', fg: '#3A2E1E' },
  { id: 'dark', label: 'Dark', bg: '#2A241E', fg: '#EDE6D9' },
];
const FACE_OPTIONS: Array<{ id: ReaderFace; label: string }> = [
  { id: 'serif', label: 'Newsreader' },
  { id: 'georgia', label: 'Georgia' },
  { id: 'sans', label: 'Sans' },
];

export function ReaderMenuPanel({ suttaId, mobile, theme, initialTab, segments, onClose, onJumpToHighlight, noteFocusSignal }: ReaderMenuPanelProps) {
  const [tab, setTab] = useState(initialTab);
  const { notes, submitNote, highlights, removeHighlights } = useUserData();
  const { theme: currentTheme, setTheme, fs, setFs, lh, setLh, face, setFace, allPali, toggleAllPali, showNotes, toggleShowNotes } =
    useReaderPrefs();

  const suttaHighlights = highlights[suttaId] || [];
  const highlightGroups = useMemo(() => groupHighlights(suttaHighlights, segments), [suttaHighlights, segments]);

  // Full-screen and top-anchored on mobile (not a bottom sheet) so that when the on-screen
  // keyboard opens (typing a note, or the Lists tab's auto-focused search/create input), the
  // input stays above where the keyboard eats into the viewport instead of being covered by it —
  // this container is `position: absolute` inside ReaderPage's `fixed inset-0` root, which stays
  // pinned to the full layout-viewport height and doesn't shrink for the keyboard, so anything
  // anchored to its *bottom* (the old `bottom: 0; maxHeight: 74%` sheet) ends up hidden beneath
  // the keyboard rather than pushed up above it.
  const panelStyle = mobile
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

  const tabBtn = (id: 'highlights' | 'lists' | 'text', label: string) => (
    <button
      key={id}
      className="flex-1 text-center py-[9px] rounded-field font-sans text-[13.5px] border"
      style={{
        borderColor: theme.rule,
        background: tab === id ? theme.fg : 'transparent',
        color: tab === id ? theme.bg : theme.fg,
      }}
      onClick={() => setTab(id)}
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
      {/* Full-screen on mobile leaves no backdrop to tap-to-close, so it's desktop-only there —
          mobile gets an explicit close button in the header row instead (below). */}
      {!mobile && <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,.12)' }} onClick={onClose} />}
      <div data-component="ReaderMenuPanel" style={panelStyle} className="animate-fadeIn">
        <div className="flex items-center gap-2 mb-4">
          {mobile && (
            <button className="flex-none flex items-center -ml-1 mr-1" title="Close" onClick={onClose}>
              <X size={17} strokeWidth={1.75} />
            </button>
          )}
          <div className="flex flex-1 gap-2">
            {tabBtn('highlights', 'Highlights')}
            {tabBtn('lists', 'Lists')}
            {tabBtn('text', 'Theme')}
          </div>
        </div>

        {tab === 'highlights' && (
          <div className="sc flex-1 min-h-0">
            <div className="rounded-field mb-3.5 p-[11px_13px]" style={{ border: `1px solid ${theme.rule}`, padding: '11px 13px' }}>
              <div className="font-sans text-[10.5px] font-bold tracking-[.12em] uppercase opacity-60 mb-[5px]">Sutta note</div>
              <NoteEditor
                value={notes[suttaId] || ''}
                onSubmit={(text) => submitNote(suttaId, text)}
                focusSignal={noteFocusSignal}
                placeholder="Add a note — return to save, shift+return for a new line"
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
                onClick={() => onJumpToHighlight(g.i)}
              >
                <span className="w-[5px] self-stretch rounded-[3px] flex-none" style={{ background: g.c }} />
                <span className="flex-1 text-sm leading-[1.45]">{highlightGroupText(g, segments).slice(0, 92) || `Segment ${g.i + 1}`}</span>
                <span
                  className="flex items-center gap-1 font-sans text-[11.5px] opacity-45"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeHighlights(
                      suttaId,
                      g.items.map((h) => h.id)
                    );
                  }}
                >
                  <Trash2 size={12} strokeWidth={1.75} />
                  Remove
                </span>
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
                  className="flex-1 h-[52px] rounded-[10px] text-[14.5px]"
                  style={{ background: t.bg, color: t.fg, border: `1px solid ${currentTheme === t.id ? theme.fg : theme.rule}` }}
                  onClick={() => setTheme(t.id)}
                >
                  {t.label}
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
            <div style={ctlRowStyle}>
              <span className="font-sans text-[12.5px] opacity-55" style={{ width: 86 }}>
                Face
              </span>
              <div className="flex gap-2">
                {FACE_OPTIONS.map((f) => (
                  <button key={f.id} style={{ ...pill(face === f.id), fontSize: 12, padding: '5px 10px' }} onClick={() => setFace(f.id)}>
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
              <span className="flex-1 text-[14.5px]">Sujato (2018)</span>
              <span className="font-sans text-[12.5px] opacity-45">change</span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
