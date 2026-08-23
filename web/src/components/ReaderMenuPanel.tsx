import { useEffect, useRef, useState } from 'react';
import { Minus, Plus, Trash2, X } from 'lucide-react';
import { useUserData } from '../context/UserDataContext';
import { FS_MAX, FS_MIN, FS_STEP, LH_MAX, LH_MIN, LH_STEP, useReaderPrefs } from '../context/ReaderPrefsContext';
import { NoteEditor } from './NoteEditor';
import { ListMembershipPicker } from './ListMembershipPicker';
import type { SegmentFile } from '../lib/corpus';
import { highlightGroupText, type HighlightGroup } from '../lib/highlights';
import { highlightPaint } from '../lib/theme';
import type { ReaderFace, ResolvedReaderTheme, ThemeColors } from '../lib/types';

type Tab = 'highlights' | 'lists' | 'text';

interface ReaderMenuPanelProps {
  suttaId: string;
  mobile: boolean;
  theme: ThemeColors;
  initialTab: Tab;
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
  // dismiss an open DictionaryDock when landing on the Display tab's mobile sheet — see ReaderPage).
  onTabChange?: (tab: Tab) => void;
}

// Each theme is previewed as a miniature of the reading surface itself — lines of body text on
// that theme's own paper, with one line in its Pali accent — rather than named on a flat colour
// chip. Same device as the app shell's own picker (SettingsPage's THEME_OPTIONS), which draws a
// miniature of the *shell* instead; here there is no tree pane to draw, so the tile is the page.
// It also replaces that flat chip's mix-blend-mode label trick: the name now sits under the tile
// in the panel's own ink, so it is legible at the same contrast on all three.
//
// The colours are literals rather than READER_THEMES lookups because all three tiles render in
// their own palette at once while the panel around them is in only one of them.
// 'system' is the default both this and the shell picker resolve *through* rather than a tile of
// its own (see types.ts's ReaderTheme note), so selection is matched against the resolved theme.
const THEME_TILES: Array<{ id: ResolvedReaderTheme; label: string; bg: string; fg: string; pali: string }> = [
  { id: 'light', label: 'Light', bg: '#FAF8F3', fg: '#1B1917', pali: '#7A5B2E' },
  { id: 'dark', label: 'Dark', bg: '#2A241E', fg: '#EDE6D9', pali: '#C9A86F' },
  { id: 'sepia', label: 'Sepia', bg: '#F3E7D3', fg: '#3A2E1E', pali: '#8C6222' },
];

const FACE_OPTIONS: Array<{ id: ReaderFace; label: string }> = [
  { id: 'serif', label: 'Newsreader' },
  { id: 'georgia', label: 'Georgia' },
  { id: 'sans', label: 'Sans' },
  { id: 'times', label: 'Times' },
  { id: 'system', label: 'System' },
];

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'highlights', label: 'Highlights' },
  { id: 'lists', label: 'Lists' },
  { id: 'text', label: 'Display' },
];

// A two-or-more-state segmented control: one recessed track with a raised thumb under the active
// option. Used for this panel's tab bar and for the Display tab's Pali and translator-note rows —
// the same shape at two sizes, so a setting with exactly two states shows *both* of them rather
// than a single button whose label has to double as the current value and the action.
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
            // `flex-auto`, not `flex-1`: `flex-1` zeroes the basis, so the tabs come out as equal
            // shares of the track and their own horizontal padding never affects anything. Sizing
            // from content plus padding instead lets that padding set how much air each label
            // carries, with the leftover width still shared out evenly.
            className={`${grow ? 'flex-auto' : ''} rounded-full font-sans text-ui-sm whitespace-nowrap ${
              grow ? 'px-5 py-[8px]' : 'px-3.5 py-[6px]'
            }`}
            style={{
              // The thumb is the panel's own surface lifted out of the recessed track, so it
              // needs no border of its own to separate from it.
              background: on ? theme.panel : 'transparent',
              color: on ? theme.fg : theme.dim,
              fontWeight: on ? 500 : 400,
              // The thumb is the panel's own colour, so on light — where the track is a faint
              // tint of a near-black over a near-white panel — the shadow is the only thing
              // separating the two. It has to be readable as a lift, not just a hairline.
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

// One connected group — the two buttons and the value they change share a single outline, divided
// by hairlines. Matches Settings' UI-scale stepper. A stepper rather than a slider because both of
// these ranges are short and discrete, and landing on one stop of nine with a thumb on a phone is
// far harder than tapping "+"; it also shows the value, which the bare range inputs never did.
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
  highlightGroups,
  onClose,
  onJumpToHighlight,
  noteFocusSignal,
  onTabChange,
}: ReaderMenuPanelProps) {
  const [tab, setTab] = useState(initialTab);
  const { notes, submitNote, setHighlightRanges } = useUserData();
  const { resolvedTheme, setTheme, fs, setFs, lh, setLh, face, setFace, allPali, toggleAllPali, showNotes, toggleShowNotes } =
    useReaderPrefs();

  // The Display tab has no text inputs, so on mobile it renders as a short bottom sheet instead of
  // going full-screen — leaving the reader visible above it so font/line-height/theme changes can
  // be seen live while adjusting them (see below). Highlights and Lists stay full-screen and
  // top-anchored (not a bottom sheet): their inputs (Lists' auto-focused search/create field;
  // Highlights' note textarea) need to stay above the on-screen keyboard, and this container is
  // `position: absolute` inside ReaderPage's `fixed inset-0` root, which stays pinned to the full
  // layout-viewport height and doesn't shrink for the keyboard, so anything anchored to its
  // *bottom* ends up hidden beneath the keyboard rather than pushed up above it.
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
        maxHeight: '62dvh',
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
        width: 410,
        display: 'flex',
        flexDirection: 'column' as const,
        background: theme.panel,
        color: theme.fg,
        // A hairline plus a cast shadow, rather than the heavy 2px `fg` rule this drawer used to
        // carry: the shadow is what separates it from the reading behind it, so the edge itself
        // doesn't have to be a line dark enough to read as part of the page's own furniture.
        borderLeft: `1px solid ${theme.rule}`,
        boxShadow: '-10px 0 30px rgba(0,0,0,.12)',
        padding: '18px 20px 22px',
      };

  const entranceClass = hasEnteredRef.current ? '' : isThemeSheet ? 'animate-sheetUp' : 'animate-fadeIn';
  const panelClassName = `${isThemeSheet ? 'rounded-t-sheet shadow-sheet' : ''} ${entranceClass}`.trim();

  // Every setting is one of these: label on the left, control on the right, split from the row
  // above by a hairline. It wraps to two lines when the two halves stop fitting, which the face
  // pills always do and the steppers can at the top of the UI-scale range on a narrow phone.
  const settingRow = 'flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 py-3';
  const hairline = { borderTop: `1px solid ${theme.tint}` };
  const rowLabel = 'font-sans text-ui-sm';

  // Erasing from here goes through the same path as HighlightPopup's "Remove": a group is
  // immutable and atomic, so re-writing its own ranges with a null colour retires the whole thing
  // (see lib/mirror.ts's writeHighlightRecord). No confirmation, matching that popup — the trash
  // sits in its own target, clear of the row's jump-to action.
  const removeGroup = (g: HighlightGroup) =>
    setHighlightRanges(
      suttaId,
      g.items.map(({ i, s, e }) => ({ i, s, e })),
      null
    );

  return (
    <>
      {/* Full-screen (Highlights/Lists on mobile) leaves no backdrop to tap-to-close — mobile gets
          an explicit close button in the header row instead (below). The Display sheet is partial-
          height, so it gets a backdrop too: tapping the dimmed reader text above it closes it. */}
      {(!mobile || isThemeSheet) && <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,.12)' }} onClick={onClose} />}
      <div data-component="ReaderMenuPanel" style={panelStyle} className={panelClassName}>
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
          {/* Outside the track rather than as a fourth segment — closing isn't one of the things
              this control is choosing between. Desktop closes on the backdrop or Escape. */}
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
            {/* Recessed against the panel — `bg` is the reading surface, a shade off the `panel`
                around it — so the note reads as somewhere to write rather than as another row. */}
            <div className="rounded-field mb-5 px-3.5 py-3" style={{ border: `1px solid ${theme.rule}`, background: theme.bg }}>
              <div className={`${rowLabel} mb-1`} style={{ color: theme.dim }}>
                Sutta note
              </div>
              <NoteEditor
                value={notes[suttaId] || ''}
                onSubmit={(text) => submitNote(suttaId, text)}
                focusSignal={noteFocusSignal}
                placeholder="Add a note — return to save"
                rows={3}
                textareaClassName="w-full bg-transparent text-ui-base resize-none outline-none font-serif"
                textareaStyle={{ border: 0, color: theme.fg }}
                saveButtonClassName="font-sans text-ui-sm font-medium px-3 py-[4px] rounded-full"
                saveButtonStyle={{ border: `1px solid ${theme.rule}`, color: theme.fg }}
              />
            </div>

            {/* The count belongs beside the heading, not on the rows: it answers "how much have I
                marked in this sutta" at a glance, which is most of why this tab gets opened. */}
            <div className={`${rowLabel} flex items-baseline gap-1.5 mb-0.5`} style={{ color: theme.dim }}>
              Highlights
              {highlightGroups.length > 0 && <span className="tabular-nums">{highlightGroups.length}</span>}
            </div>

            {highlightGroups.map((g) => {
              const text = highlightGroupText(g, segments);
              const preview = text.length > 120 ? `${text.slice(0, 120)}…` : text;
              return (
                <div key={g.key} className="flex items-stretch gap-1" style={{ borderBottom: `1px solid ${theme.tint}` }}>
                  <button className="flex flex-1 min-w-0 gap-2.5 items-start py-2.5 text-left" onClick={() => onJumpToHighlight(g.i, g.key)}>
                    <span className="w-[5px] self-stretch rounded-[3px] flex-none" style={{ background: highlightPaint(g.c, theme) }} />
                    <span className="flex-1 text-ui-sm leading-[1.45]">{preview || `Segment ${g.i + 1}`}</span>
                  </button>
                  {/* Always visible, never hover-revealed: this panel is used on touch, where
                      there is no hover state to reveal it with. Faded instead, so it reads as
                      secondary to the row's own jump-to action. */}
                  <button
                    className="flex-none flex items-start justify-center w-9 pt-[11px] opacity-45 hover:opacity-100"
                    style={{ color: theme.fg }}
                    aria-label="Remove highlight"
                    onClick={() => removeGroup(g)}
                  >
                    <Trash2 size={17} strokeWidth={1.75} />
                  </button>
                </div>
              );
            })}
            {highlightGroups.length === 0 && (
              <div className="font-sans text-ui-sm py-1.5" style={{ color: theme.dim, opacity: 0.8 }}>
                Select text in the reading, then pick a colour.
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
              <div className={`${rowLabel} mb-2.5`} style={{ color: theme.dim }}>
                Theme
              </div>
              <div className="flex gap-2.5">
                {THEME_TILES.map((t) => {
                  const selected = resolvedTheme === t.id;
                  return (
                    <button key={t.id} className="flex-1 min-w-0" aria-pressed={selected} onClick={() => setTheme(t.id)}>
                      {/* Held at 2px in both states so selecting a tile doesn't nudge the
                          miniature inside it. */}
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

            {/* The one row whose control keeps its own line: five names never fit beside a label,
                and wrapping them into the row's right-hand half would ladder them one per line. */}
            <div className="py-3.5" style={hairline}>
              <div className={`${rowLabel} mb-2.5`} style={{ color: theme.dim }}>
                Typeface
              </div>
              <div className="flex flex-wrap gap-1.5">
                {FACE_OPTIONS.map((f) => {
                  const on = face === f.id;
                  return (
                    <button
                      key={f.id}
                      aria-pressed={on}
                      className="h-[38px] px-3.5 rounded-full font-sans text-ui-sm"
                      style={{
                        // The accent at low alpha, the same fill Settings' UI-font pills use —
                        // an 8-digit hex because these are theme literals, not CSS vars.
                        border: `1px solid ${on ? theme.pali : theme.rule}`,
                        background: on ? `${theme.pali}1F` : 'transparent',
                        color: on ? theme.pali : theme.dim,
                        fontWeight: on ? 500 : 400,
                      }}
                      onClick={() => setFace(f.id)}
                    >
                      {f.label}
                    </button>
                  );
                })}
              </div>
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

            <div className={settingRow} style={hairline}>
              <span className={rowLabel} style={{ color: theme.dim }}>
                Translator's notes
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
          </div>
        )}
      </div>
    </>
  );
}
