import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Minus, Plus, Trash2, X } from 'lucide-react';
import { useUserData } from '../context/UserDataContext';
import { FS_MAX, FS_MIN, FS_STEP, LH_MAX, LH_MIN, LH_STEP, useReaderPrefs } from '../context/ReaderPrefsContext';
import { NoteEditor } from './NoteEditor';
import { ListMembershipPicker } from './ListMembershipPicker';
import type { SegmentFile } from '../lib/corpus';
import { highlightGroupText, type HighlightGroup } from '../lib/highlights';
import { KeyCap } from './ShortcutsModal';
import { SHORTCUTS, SHOWS_KEY_HINTS } from '../lib/shortcuts';
import { highlightPaint, READER_FACES } from '../lib/theme';
import type { ReaderFace, ResolvedReaderTheme, ThemeColors } from '../lib/types';

type Tab = 'highlights' | 'lists' | 'text';

interface ReaderMenuPanelProps {
  suttaId: string;
  mobile: boolean;
  theme: ThemeColors;
  initialTab: Tab;
  segments: SegmentFile[] | null;
  // useSuttaReading already groups this sutta's highlights via groupHighlights, so they're passed
  // down rather than derived a second time per render.
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

// Each theme is previewed as a miniature of the reading surface — lines of body text on that
// theme's paper, one of them in its Pali accent — rather than named on a flat colour chip. The same
// device as the shell's picker (SettingsPage's THEME_OPTIONS), which draws a miniature of the shell
// instead; here there is no tree pane to draw, so the tile is the page. The name sits under the
// tile in the panel's own ink, legible at the same contrast on all three.
//
// The colours are literals rather than READER_THEMES lookups, because all three tiles render in
// their own palette at once while the panel around them is in only one. 'system' is what both
// pickers resolve through rather than a tile of its own (see types.ts's ReaderTheme), so selection
// is matched against the resolved theme.
const THEME_TILES: Array<{ id: ResolvedReaderTheme; label: string; bg: string; fg: string; pali: string }> = [
  { id: 'light', label: 'Light', bg: '#FAF8F3', fg: '#1B1917', pali: '#7A5B2E' },
  { id: 'dark', label: 'Dark', bg: '#2A241E', fg: '#EDE6D9', pali: '#C9A86F' },
  { id: 'sepia', label: 'Sepia', bg: '#F3E7D3', fg: '#3A2E1E', pali: '#8C6222' },
];

// Six faces in reading order down the 3×2 grid below. Four are serifs of genuinely different
// character, so a reader who dislikes one can see from the specimens which others are unlike it.
// Newsreader and Literata are vendored webfonts, so every device has at least three real choices;
// Charter is Apple-only and Palatino is a different cut on each platform, and both fall back to
// Georgia where missing (see READER_FACES).
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
  { id: 'text', label: 'Display' },
];

// A segmented control: one recessed track with a raised thumb under the active option. Used for
// this panel's tab bar and for the Display tab's Pali and translator-note rows — the same shape at
// two sizes, so a two-state setting shows both states rather than one button whose label has to
// double as the current value and the action.
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
            // shares of the track and their horizontal padding does nothing. Sizing from content
            // plus padding lets that padding set the air around each label, with the leftover width
            // still shared evenly.
            className={`${grow ? 'flex-auto' : ''} rounded-full font-sans whitespace-nowrap text-ui-sm ${
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

// One connected group: the two buttons and the value they change share a single outline, divided by
// hairlines, matching Settings' UI-scale stepper. A stepper rather than a slider because both
// ranges are short and discrete, and landing on one stop of nine with a thumb is far harder than
// tapping "+"; it also shows the value.
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
    showNotes,
    toggleShowNotes,
    showHighlights,
    toggleShowHighlights,
  } = useReaderPrefs();

  // The Display tab has no text inputs, so on mobile it is a short bottom sheet rather than
  // full-screen, leaving the reader visible above it while font, line-height and theme changes are
  // judged live. Highlights and Lists stay full-screen and top-anchored, because their inputs —
  // Lists' auto-focused search field, Highlights' note textarea — have to stay above the on-screen
  // keyboard: this container is `position: absolute` inside ReaderPage's `fixed inset-0` root,
  // which stays pinned to the full layout viewport and doesn't shrink for the keyboard, so anything
  // anchored to its bottom ends up beneath the keyboard rather than above it.
  const isThemeSheet = mobile && tab === 'text';
  // Only the initial mount plays an entrance animation. Once mounted, switching tabs reshapes the
  // panel live and snaps rather than replaying a slide-up on every tab tap.
  const hasEnteredRef = useRef(false);
  useEffect(() => {
    hasEnteredRef.current = true;
  }, []);

  // Where the panel sits and how it is dressed — one of three shapes. All three are
  // `position: absolute` inside ReaderPage's `fixed inset-0` root and share the panel's surface
  // colours; what differs is which edges they are pinned to. Rebuilt every render, so it tracks
  // `theme`.
  function panelStyle(): CSSProperties {
    // The Display tab on mobile: a short bottom sheet, capped well under the viewport so the
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
    // Highlights and Lists on mobile: full-screen and top-anchored, so their inputs stay above the
    // on-screen keyboard (see isThemeSheet's comment for why bottom-anchoring fails here).
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
    // Desktop, every tab: a fixed-width drawer down the right edge. A hairline plus a cast shadow
    // rather than a heavy rule — the shadow separates it from the reading behind, so the edge
    // itself needn't be dark enough to read as page furniture.
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
    // The mobile Display sheet rises from the bottom edge it's pinned to.
    if (isThemeSheet) return 'animate-sheetUp';
    // Everything else appears in place, so it fades.
    return 'animate-fadeIn';
  }
  const entranceClass = entranceAnimationClass();
  const panelClassName = `${isThemeSheet ? 'rounded-t-sheet shadow-sheet' : ''} ${entranceClass}`.trim();

  // Every setting is one of these: label on the left, control on the right, split from the row
  // above by a hairline. It wraps to two lines when the two halves stop fitting, which the face
  // pills always do and the steppers can at the top of the UI-scale range on a narrow phone.
  const settingRow = 'flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 py-3';
  const hairline = { borderTop: `1px solid ${theme.tint}` };
  const rowLabel = 'font-sans text-ui-sm';

  // A setting that also has a keyboard shortcut names it beside the label, so someone who found the
  // control here learns the key without opening "?". Read from SHORTCUTS so the two can't drift.
  const rowKey = (keyName: string) => (SHOWS_KEY_HINTS ? <KeyCap keyName={keyName} theme={theme} small /> : null);

  // Erasing here takes the same path as HighlightPopup's "Remove": a group is immutable and atomic,
  // so rewriting its ranges with a null colour retires the whole thing (lib/mirror.ts's
  // writeHighlightRecord). No confirmation, matching that popup — the trash sits in its own target,
  // clear of the row's jump-to action.
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
              <div className={`${rowLabel} flex items-center gap-1.5 mb-1`} style={{ color: theme.dim }}>
                Sutta note
                {rowKey(SHORTCUTS.readerNote.keys[0])}
              </div>
              <NoteEditor
                value={notes[suttaId] || ''}
                onSubmit={(text) => submitNote(suttaId, text)}
                focusSignal={noteFocusSignal}
                placeholder="Add a note — return to save"
                rows={3}
                textareaClassName="w-full bg-transparent text-ui-base resize-none outline-none font-serif"
                textareaStyle={{ border: 0, color: theme.fg }}
                saveButtonClassName="font-sans text-ui-sm font-medium px-5 py-[7px] rounded-full"
                saveButtonStyle={{ border: `1px solid ${theme.rule}`, color: theme.fg }}
              />
            </div>

            {/* The count belongs beside the heading, not on the rows: it answers "how much have I
                marked in this sutta" at a glance, which is most of why this tab gets opened. */}
            <div className={`${rowLabel} flex items-baseline gap-1.5 mb-2`} style={{ color: theme.dim }}>
              Highlights
              {highlightGroups.length > 0 && <span className="tabular-nums">{highlightGroups.length}</span>}
            </div>

            {highlightGroups.map((g, gi) => {
              const text = highlightGroupText(g, segments);
              const preview = text.length > 120 ? `${text.slice(0, 120)}…` : text;
              return (
                // The last row draws no rule of its own: the setting below closes the list with
                // its own, and the two together read as a double line.
                <div
                  key={g.key}
                  className="flex items-stretch gap-1"
                  style={gi === highlightGroups.length - 1 ? undefined : { borderBottom: `1px solid ${theme.tint}` }}
                >
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

            {/* The Display tab's own row for this setting, repeated below the list it governs —
                the same full-size row rather than a second kind of affordance, so the two places
                read as one setting. Last, not beside the heading: it acts on the reading behind
                the panel, not on the list, and putting it first would offer to hide the highlights
                before showing them. Absent with nothing to hide, since its effect couldn't be
                seen. */}
            {highlightGroups.length > 0 && (
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

            {/* The one row whose control keeps its own line. Each face is a specimen tile rather
                than a name on a pill — "Aa" set in the face itself, named underneath — because the
                names mean nothing to most readers and the whole decision is about how the letters
                look. Three across, two down, the way Apple Books does it. */}
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
                        // The accent at low alpha, the same fill Settings' UI-font pills use —
                        // an 8-digit hex because these are theme literals, not CSS vars.
                        border: `1px solid ${on ? theme.pali : theme.rule}`,
                        background: on ? `${theme.pali}1F` : 'transparent',
                      }}
                      onClick={() => setFace(f.id)}
                    >
                      {/* Full ink even when unselected: this is the sample, and dimming it would
                          misrepresent the face. Trimmed to cap height and baseline so all six
                          specimens sit on one optical line — without it each "Aa" is centred in a
                          box sized by its own ascent and descent, which rides Newsreader's
                          visibly high and leaves the row looking unaligned. */}
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
          </div>
        )}
      </div>
    </>
  );
}
