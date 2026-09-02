import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Minus, Plus, Trash2, X } from 'lucide-react';
import { useUserData } from '../context/UserDataContext';
import { FS_MAX, FS_MIN, FS_STEP, LH_MAX, LH_MIN, LH_STEP, useReaderPrefs } from '../context/ReaderPrefsContext';
import { NoteEditor } from './NoteEditor';
import { ListMembershipPicker } from './ListMembershipPicker';
import type { SegmentFile } from '../lib/corpus';
import { highlightText } from '../lib/highlights';
import { KeyCap } from './ShortcutsModal';
import { SHORTCUTS, SHOWS_KEY_HINTS } from '../lib/shortcuts';
import { highlightPaint, READER_FACES } from '../lib/theme';
import type { Highlight, ReaderFace, ResolvedReaderTheme, ThemeColors } from '../lib/types';

type Tab = 'highlights' | 'lists' | 'text';

interface ReaderMenuPanelProps {
  suttaId: string;
  mobile: boolean;
  theme: ThemeColors;
  initialTab: Tab;
  segments: SegmentFile[] | null;
  // This sutta's highlights, in document order, which is the order this panel lists them in.
  highlights: Highlight[];
  onClose: () => void;
  onJumpToHighlight: (segIndex: number, highlightId?: string) => void;
  // Bumped to focus the note box, even with this panel already open. See NoteEditor.
  noteFocusSignal?: number;
  // Called when the tab changes from inside the open panel, which ReaderPage acts on.
  onTabChange?: (tab: Tab) => void;
}

// The reading themes, each previewed as a miniature of the page. Literals rather than
// READER_THEMES lookups, since all three tiles render in their own palette while the panel is in
// one. There is no 'system' tile: the picker matches against the resolved theme.
const THEME_TILES: Array<{ id: ResolvedReaderTheme; label: string; bg: string; fg: string; pali: string }> = [
  { id: 'light', label: 'Light', bg: '#FAF8F3', fg: '#1B1917', pali: '#7A5B2E' },
  { id: 'dark', label: 'Dark', bg: '#2A241E', fg: '#EDE6D9', pali: '#C9A86F' },
  { id: 'sepia', label: 'Sepia', bg: '#F3E7D3', fg: '#3A2E1E', pali: '#8C6222' },
];

// The reading faces, in reading order down the 3×2 grid of specimens below.
const FACE_OPTIONS: Array<{ id: ReaderFace; label: string }> = [
  { id: 'georgia', label: 'Georgia' },
  { id: 'serif', label: 'Newsreader' },
  { id: 'literata', label: 'Literata' },
  { id: 'charter', label: 'Charter' },
  { id: 'palatino', label: 'Palatino' },
  { id: 'sans', label: 'Sans' },
];

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'highlights', label: 'Highlights' },
  { id: 'lists', label: 'Lists' },
  { id: 'text', label: 'Appearance' },
];

// A segmented control: a recessed track with a raised thumb under the active option. Drawn at two
// sizes, for the panel's tab bar and for the Appearance tab's two-state settings.
function Segmented<T extends string>({
  value,
  options,
  onChange,
  theme,
  grow,
}: {
  value: T;
  options: Array<{ id: T; label: string }>;
  onChange: (id: T) => void;
  theme: ThemeColors;
  // Tab bar: fill the panel's width, each tab sized by its own label. Setting rows: hug the labels.
  grow?: boolean;
}) {
  return (
    <div
      className={`${grow ? 'flex' : 'inline-flex'} items-stretch rounded-full p-[4px]`}
      style={{ background: theme.tint }}
    >
      {options.map((o) => {
        const on = value === o.id;
        return (
          <button
            key={o.id}
            aria-pressed={on}
            // `flex-auto` rather than `flex-1`, which would zero the basis and leave the tabs'
            // horizontal padding doing nothing. A setting row's halves instead take a minimum wide
            // enough for the longest label any of them uses, so the column's toggles all match.
            className={`${grow ? 'flex-auto' : 'min-w-[84px] text-center'} rounded-full font-sans whitespace-nowrap text-ui-sm ${
              grow ? 'px-5 py-[8px]' : 'px-3.5 py-[6px]'
            }`}
            style={{
              // The thumb is the panel's own surface, lifted out of the recessed track.
              background: on ? theme.panel : 'transparent',
              color: on ? theme.fg : theme.dim,
              fontWeight: on ? 500 : 400,
              // On light, where thumb and track are near the same colour, the shadow is the only
              // thing separating them, so it has to read as a lift rather than a hairline.
              boxShadow: on ? '0 1px 2px rgba(0,0,0,.18)' : 'none',
            }}
            onClick={() => onChange(o.id)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// A stepper: two buttons and the value they change, sharing one outline, as Settings' UI scale
// does. A stepper rather than a slider, both ranges being short and discrete.
function Stepper({
  value,
  min,
  max,
  step,
  onChange,
  format,
  label,
  theme,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (n: number) => void;
  format: (n: number) => string;
  label: string;
  theme: ThemeColors;
}) {
  const btn = 'flex items-center justify-center w-[53px] h-[41px] disabled:opacity-30';
  return (
    <div className="inline-flex items-stretch rounded-field overflow-hidden" style={{ border: `1px solid ${theme.rule}` }}>
      <button
        className={btn}
        style={{ color: theme.fg }}
        aria-label={`Decrease ${label}`}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - step))}
      >
        <Minus size={18} strokeWidth={2} />
      </button>
      <span
        className="flex items-center justify-center w-[58px] font-sans text-ui-base tabular-nums"
        style={{ borderLeft: `1px solid ${theme.rule}`, borderRight: `1px solid ${theme.rule}`, color: theme.fg }}
      >
        {format(value)}
      </span>
      <button
        className={btn}
        style={{ color: theme.fg }}
        aria-label={`Increase ${label}`}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + step))}
      >
        <Plus size={18} strokeWidth={2} />
      </button>
    </div>
  );
}

export function ReaderMenuPanel({
  suttaId,
  mobile,
  theme,
  initialTab,
  segments,
  highlights,
  onClose,
  onJumpToHighlight,
  noteFocusSignal,
  onTabChange,
}: ReaderMenuPanelProps) {
  const [tab, setTab] = useState(initialTab);
  const { notes, submitNote, setHighlightSpan } = useUserData();
  const {
    resolvedTheme,
    setTheme,
    fs,
    setFs,
    lh,
    setLh,
    face,
    setFace,
    allPali,
    toggleAllPali,
    paliAbove,
    togglePaliAbove,
    showNotes,
    toggleShowNotes,
    showHighlights,
    toggleShowHighlights,
  } = useReaderPrefs();

  // True where the panel is a short bottom sheet: the Appearance tab on mobile, which has no text
  // inputs and leaves the reader visible above it while a change is judged. The other two stay
  // full-screen and top-anchored, their inputs having to clear the on-screen keyboard, which this
  // container's own bottom edge does not.
  const isThemeSheet = mobile && tab === 'text';
  // Whether the entrance animation has played, so switching tabs reshapes the panel live rather
  // than replaying a slide-up on every tap.
  const hasEnteredRef = useRef(false);
  useEffect(() => {
    hasEnteredRef.current = true;
  }, []);

  // Where the panel sits and how it is dressed — one of three shapes. All three are
  // `position: absolute` inside ReaderPage's `fixed inset-0` root and share the panel's surface
  // colours; what differs is which edges they are pinned to. Rebuilt every render, so it tracks
  // `theme`.
  function panelStyle(): CSSProperties {
    // The Appearance tab on mobile: a short bottom sheet, capped well under the viewport so the
    // reader stays visible above it and type changes can be judged live.
    if (isThemeSheet) {
      return {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        maxHeight: '62dvh',
        display: 'flex',
        flexDirection: 'column',
        background: theme.panel,
        color: theme.fg,
        padding: '14px 20px 18px',
        paddingBottom: 'calc(18px + env(safe-area-inset-bottom, 0px))',
      };
    }
    // Highlights and Lists on mobile: full-screen and top-anchored, so their inputs clear the
    // keyboard.
    if (mobile) {
      return {
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        background: theme.panel,
        color: theme.fg,
        padding: '18px 20px 22px',
        paddingTop: 'calc(18px + env(safe-area-inset-top, 0px))',
      };
    }
    // Desktop, every tab: a fixed-width drawer down the right edge, separated from the reading
    // behind by a cast shadow rather than a heavy rule.
    return {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      width: 410,
      display: 'flex',
      flexDirection: 'column',
      background: theme.panel,
      color: theme.fg,
      borderLeft: `1px solid ${theme.rule}`,
      boxShadow: '-10px 0 30px rgba(0,0,0,.12)',
      padding: '18px 20px 22px',
    };
  }

  // Which entrance the panel plays, if any.
  function entranceAnimationClass(): string {
    // Already mounted: switching tabs reshapes the panel live and should snap, not replay.
    if (hasEnteredRef.current) return '';
    // The mobile Appearance sheet rises from the bottom edge it's pinned to.
    if (isThemeSheet) return 'animate-sheetUp';
    // Everything else appears in place, so it fades.
    return 'animate-fadeIn';
  }
  const entranceClass = entranceAnimationClass();
  const panelClassName = `${isThemeSheet ? 'rounded-t-sheet shadow-sheet' : ''} ${entranceClass}`.trim();

  // One setting row: label left, control right, split from the row above by a hairline, wrapping
  // to two lines when the halves stop fitting.
  const settingRow = 'flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 py-3';
  const hairline = { borderTop: `1px solid ${theme.tint}` };
  const rowLabel = 'font-sans text-ui-sm';

  // The key cap beside a setting that also has a shortcut, read from SHORTCUTS so the two can't
  // drift.
  const rowKey = (keyName: string) => (SHOWS_KEY_HINTS ? <KeyCap keyName={keyName} theme={theme} small /> : null);

  // Erases a highlight, the same path HighlightPopup's "Remove" takes. No confirmation, matching
  // that popup; the trash sits in its own target, clear of the row's jump-to.
  const removeHighlight = ({ i0, o0, i1, o1 }: Highlight) => setHighlightSpan(suttaId, { i0, o0, i1, o1 }, null);

  return (
    <>
      {/* The backdrop, which closes on a tap. A full-screen panel has no room for one and gets
          the explicit close button below instead. */}
      {(!mobile || isThemeSheet) && <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,.12)' }} onClick={onClose} />}
      <div data-component="ReaderMenuPanel" style={panelStyle()} className={panelClassName}>
        <div className="flex items-center gap-1.5 mb-5">
          <div className="flex-1 min-w-0">
            <Segmented
              grow
              value={tab}
              options={TABS}
              theme={theme}
              onChange={(id) => {
                setTab(id);
                onTabChange?.(id);
              }}
            />
          </div>
          {/* Close, outside the tab track — it isn't one of the things being chosen between.
              Desktop closes on the backdrop or Escape. */}
          {mobile && (
            <button
              className="flex-none flex items-center justify-center w-9 h-9 rounded-full"
              style={{ color: theme.dim }}
              aria-label="Close"
              onClick={onClose}
            >
              <X size={22} strokeWidth={1.75} />
            </button>
          )}
        </div>

        {tab === 'highlights' && (
          <div className="sc flex-1 min-h-0">
            {/* The note box, recessed against the panel so it reads as somewhere to write. */}
            <div className="rounded-field mb-5 px-3.5 py-3" style={{ border: `1px solid ${theme.rule}`, background: theme.bg }}>
              <div className={`${rowLabel} flex items-center gap-1.5 mb-1`} style={{ color: theme.dim }}>
                Sutta note
                {rowKey(SHORTCUTS.readerNote.keys[0])}
              </div>
              <NoteEditor
                value={notes[suttaId] || ''}
                onSubmit={(text) => submitNote(suttaId, text)}
                focusSignal={noteFocusSignal}
                placeholder="Something to remember this by"
                rows={3}
                textareaClassName="w-full bg-transparent text-ui-base resize-none outline-none font-serif"
                textareaStyle={{ border: 0, color: theme.fg }}
              />
            </div>

            {/* The heading, with the count beside it rather than on the rows. */}
            <div className={`${rowLabel} flex items-baseline gap-1.5 mb-2`} style={{ color: theme.dim }}>
              Highlights
              {highlights.length > 0 && <span className="tabular-nums">{highlights.length}</span>}
            </div>

            {highlights.map((h, gi) => {
              const text = highlightText(h, segments);
              const preview = text.length > 120 ? `${text.slice(0, 120)}…` : text;
              return (
                // The last row draws no rule, the setting below closing the list with its own.
                <div
                  key={h.id}
                  className="flex items-stretch gap-1"
                  style={gi === highlights.length - 1 ? undefined : { borderBottom: `1px solid ${theme.tint}` }}
                >
                  <button className="flex flex-1 min-w-0 gap-2.5 items-start py-2.5 text-left" onClick={() => onJumpToHighlight(h.i0, h.id)}>
                    <span className="w-[5px] self-stretch rounded-[3px] flex-none" style={{ background: highlightPaint(h.c, theme) }} />
                    <span className="flex-1 text-ui-sm leading-[1.45]">{preview || `Segment ${h.i0 + 1}`}</span>
                  </button>
                  {/* Always visible, this panel being used on touch, and faded so it reads as
                      secondary to the row's jump-to. */}
                  <button
                    className="flex-none flex items-start justify-center w-9 pt-[11px] opacity-45 hover:opacity-100"
                    style={{ color: theme.fg }}
                    aria-label="Remove highlight"
                    onClick={() => removeHighlight(h)}
                  >
                    <Trash2 size={17} strokeWidth={1.75} />
                  </button>
                </div>
              );
            })}
            {highlights.length === 0 && (
              <div className="font-sans text-ui-sm py-1.5" style={{ color: theme.dim, opacity: 0.8 }}>
                Select text in the reading, then pick a colour.
              </div>
            )}

            {/* The Appearance tab's own show-highlights row, repeated below the list it governs.
                Last rather than beside the heading, since it acts on the reading behind the panel,
                and absent with nothing to hide. */}
            {highlights.length > 0 && (
              <div className={settingRow} style={hairline}>
                <span className="flex items-center gap-1.5">
                  <span className={rowLabel} style={{ color: theme.dim }}>
                    Show in text
                  </span>
                  {rowKey(SHORTCUTS.readerHighlightsToggle.keys[0])}
                </span>
                <Segmented
                  value={showHighlights ? 'shown' : 'hidden'}
                  options={[
                    { id: 'hidden', label: 'Hide' },
                    { id: 'shown', label: 'Show' },
                  ]}
                  theme={theme}
                  onChange={(id) => {
                    if ((id === 'shown') !== showHighlights) toggleShowHighlights();
                  }}
                />
              </div>
            )}
          </div>
        )}

        {tab === 'lists' && (
          <div className="flex flex-col flex-1 min-h-0">
            <ListMembershipPicker suttaId={suttaId} theme={theme} autoFocus onRequestClose={onClose} />
          </div>
        )}

        {tab === 'text' && (
          <div className="sc flex-1 min-h-0">
            <div className="pb-3.5">
              <div className={`${rowLabel} flex items-center gap-1.5 mb-2.5`} style={{ color: theme.dim }}>
                Theme
                {rowKey(SHORTCUTS.readerThemeCycle.keys[0])}
              </div>
              <div className="flex gap-2.5">
                {THEME_TILES.map((t) => {
                  const selected = resolvedTheme === t.id;
                  return (
                    <button key={t.id} className="flex-1 min-w-0" aria-pressed={selected} onClick={() => setTheme(t.id)}>
                      {/* 2px in both states, so selecting a tile doesn't nudge its miniature. */}
                      <span
                        className="flex flex-col justify-center gap-[5px] h-[58px] px-2.5 rounded-field overflow-hidden"
                        style={{ background: t.bg, border: `2px solid ${selected ? theme.pali : theme.rule}` }}
                      >
                        <span className="h-[4px] w-[62%] rounded-full" style={{ background: t.fg, opacity: 0.75 }} />
                        <span className="h-[3px] w-full rounded-full" style={{ background: t.fg, opacity: 0.24 }} />
                        <span className="h-[3px] w-[88%] rounded-full" style={{ background: t.fg, opacity: 0.24 }} />
                        <span className="h-[3px] w-[46%] rounded-full" style={{ background: t.pali }} />
                      </span>
                      <span
                        className="block mt-1.5 font-sans text-ui-sm truncate"
                        style={{ color: selected ? theme.pali : theme.dim, fontWeight: selected ? 500 : 400 }}
                      >
                        {t.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className={settingRow} style={hairline}>
              <span className={rowLabel} style={{ color: theme.dim }}>
                Text size
              </span>
              <Stepper
                value={fs}
                min={FS_MIN}
                max={FS_MAX}
                step={FS_STEP}
                onChange={setFs}
                format={(n) => `${n}px`}
                label="text size"
                theme={theme}
              />
            </div>

            <div className={settingRow} style={hairline}>
              <span className={rowLabel} style={{ color: theme.dim }}>
                Line height
              </span>
              <Stepper
                value={lh}
                min={LH_MIN}
                max={LH_MAX}
                step={LH_STEP}
                onChange={setLh}
                format={(n) => (n / 100).toFixed(2)}
                label="line height"
                theme={theme}
              />
            </div>

            {/* The typeface row, the one whose control keeps its own line: a 3×2 grid of
                specimens, "Aa" set in each face and named underneath. */}
            <div className="py-3.5" style={hairline}>
              <div className={`${rowLabel} mb-2.5`} style={{ color: theme.dim }}>
                Typeface
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {FACE_OPTIONS.map((f) => {
                  const on = face === f.id;
                  return (
                    <button
                      key={f.id}
                      aria-pressed={on}
                      className="h-[66px] rounded-xl flex flex-col items-center justify-center gap-1.5"
                      style={{
                        // The accent at low alpha, as Settings' pills use; an 8-digit hex, these
                        // being theme literals rather than CSS vars.
                        border: `1px solid ${on ? theme.pali : theme.rule}`,
                        background: on ? `${theme.pali}1F` : 'transparent',
                      }}
                      onClick={() => setFace(f.id)}
                    >
                      {/* Full ink even unselected, this being the sample, and trimmed to cap
                          height and baseline so all six sit on one optical line. */}
                      <span
                        aria-hidden
                        style={{
                          fontFamily: READER_FACES[f.id],
                          fontSize: 25,
                          lineHeight: 1,
                          color: theme.fg,
                          textBoxTrim: 'trim-both',
                          textBoxEdge: 'cap alphabetic',
                        }}
                      >
                        Aa
                      </span>
                      <span
                        className="font-sans text-ui-xs leading-none"
                        style={{ color: on ? theme.pali : theme.dim, fontWeight: on ? 500 : 400 }}
                      >
                        {f.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className={settingRow} style={hairline}>
              <span className="flex items-center gap-1.5">
                <span className={rowLabel} style={{ color: theme.dim }}>
                  Highlights
                </span>
                {rowKey(SHORTCUTS.readerHighlightsToggle.keys[0])}
              </span>
              <Segmented
                value={showHighlights ? 'shown' : 'hidden'}
                options={[
                  { id: 'hidden', label: 'Hidden' },
                  { id: 'shown', label: 'Shown' },
                ]}
                theme={theme}
                onChange={(id) => {
                  if ((id === 'shown') !== showHighlights) toggleShowHighlights();
                }}
              />
            </div>

            <div className={settingRow} style={hairline}>
              <span className="flex items-center gap-1.5">
                <span className={rowLabel} style={{ color: theme.dim }}>
                  Translator's notes
                </span>
                {rowKey(SHORTCUTS.readerNotesToggle.keys[0])}
              </span>
              <Segmented
                value={showNotes ? 'shown' : 'hidden'}
                options={[
                  { id: 'hidden', label: 'Hidden' },
                  { id: 'shown', label: 'Shown' },
                ]}
                theme={theme}
                onChange={(id) => {
                  if ((id === 'shown') !== showNotes) toggleShowNotes();
                }}
              />
            </div>

            <div className={settingRow} style={hairline}>
              <span className={rowLabel} style={{ color: theme.dim }}>
                Pali
              </span>
              <Segmented
                value={allPali ? 'always' : 'tap'}
                options={[
                  { id: 'tap', label: 'On tap' },
                  { id: 'always', label: 'Always' },
                ]}
                theme={theme}
                onChange={(id) => {
                  if ((id === 'always') !== allPali) toggleAllPali();
                }}
              />
            </div>

            {/* Shown only with the Pali always on, a tap reveal belonging under the line it
                explains. The setting is remembered while hidden. */}
            {allPali && (
              // No hairline: this is the Pali row's own sub-setting, so the two read as one group.
              <div className={settingRow} style={{ paddingTop: 0 }}>
                <span className={rowLabel} style={{ color: theme.dim }}>
                  Pali position
                </span>
                <Segmented
                  value={paliAbove ? 'above' : 'below'}
                  options={[
                    { id: 'below', label: 'Below' },
                    { id: 'above', label: 'Above' },
                  ]}
                  theme={theme}
                  onChange={(id) => {
                    if ((id === 'above') !== paliAbove) togglePaliAbove();
                  }}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
