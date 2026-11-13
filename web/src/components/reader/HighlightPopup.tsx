import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { PencilLine, StickyNote, Trash2, X } from 'lucide-react';
import { HIGHLIGHT_COLORS, highlightPaint } from '../../lib/ui/theme';
import { getUiScale } from '../../lib/ui/uiPrefs';
import { setHighlightNote, useHighlightNote } from '../../lib/highlightNotesPrototype';
import type { ThemeColors } from '../../lib/types';
import type { PopState } from '../../hooks/useHighlightPopup';

interface HighlightPopupProps {
  pop: PopState;
  // The key the note on the popup's span is held under.
  noteKey: string;
  // Whether the popup's span is exactly an existing highlight, which a note goes on as it is.
  painted: boolean;
  // The highlighted text, quoted above the note on a phone.
  quote: string;
  theme: ThemeColors;
  mobile: boolean;
  onPick: (color: string | null) => void;
  // Paints the span in a colour and keeps the popup open.
  onPaint: (color: string) => void;
  onRemove: () => void;
  onClose: () => void;
  onStop: (e: React.SyntheticEvent) => void;
}

// swatchBorder returns a swatch's hairline colour: `dim` on the applied colour, `rule` otherwise.
const swatchBorder = (theme: ThemeColors, selected: boolean) => (selected ? theme.dim : theme.rule);

// The gap the popup keeps from the selection.
const GAP = 10;
// The margin it keeps from the viewport's edges.
const EDGE = 10;

export function HighlightPopup({ pop, noteKey, painted, quote, theme, mobile, onPick, onPaint, onRemove, onClose, onStop }: HighlightPopupProps) {
  const ref = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  // Where the popup goes, or null before the first measurement.
  const [place, setPlace] = useState<{ above: boolean; dx: number } | null>(null);
  const note = useHighlightNote(noteKey);
  // The span whose note is open for writing: in the popup on desktop, in a sheet on a phone.
  const [notingKey, setNotingKey] = useState<string | null>(null);
  // The span whose removal waits on a confirmation, since it would take the note with it.
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null);
  const noting = notingKey === noteKey;
  const showNote = note !== '' || noting;
  const confirming = confirmingKey === noteKey;

  // Places the popup from its own measured size and the anchor.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || mobile) return;
    // Screen-space throughout, as `pop` is; the division back into CSS pixels happens in the style.
    const { width, height } = el.getBoundingClientRect();
    const half = width / 2;
    let dx = 0;
    if (pop.x + half > window.innerWidth - EDGE) dx = window.innerWidth - EDGE - (pop.x + half);
    if (pop.x - half + dx < EDGE) dx = EDGE - (pop.x - half);
    setPlace({ above: pop.top - height - GAP >= EDGE, dx });
  }, [pop, mobile, showNote, confirming]);

  // Keeps the phone's note sheet over the region actually on screen, through `visualViewport`, as
  // ListMembershipPopover does: with the keyboard up, the phone can scroll the page it sits on.
  useLayoutEffect(() => {
    const el = ref.current;
    const vv = window.visualViewport;
    if (!el || !mobile || !noting || !vv) return;
    const apply = () => {
      el.style.top = `${vv.offsetTop / getUiScale()}px`;
      el.style.height = `${vv.height / getUiScale()}px`;
    };
    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
    };
  }, [mobile, noting]);

  // Above the selection unless it sits too near the top of the viewport to fit.
  const above = place?.above ?? true;

  // startNote opens the note for writing with the cursor at its end, highlighting the selection
  // first if it isn't one yet. It renders synchronously so the focus lands inside the tap, which a
  // phone needs to raise its keyboard.
  function startNote() {
    if (!painted) onPaint(pop.on ?? HIGHLIGHT_COLORS[0]);
    flushSync(() => setNotingKey(noteKey));
    const box = boxRef.current;
    if (!box) return;
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  }

  // choose applies a colour: in place while the note shows, otherwise closing the popup.
  function choose(color: string) {
    if (!showNote) onPick(color);
    else if (color !== pop.on) onPaint(color);
  }

  // remove erases the highlight, asking first when a note would go with it.
  function remove() {
    if (note && !confirming) {
      setConfirmingKey(noteKey);
      return;
    }
    setHighlightNote(noteKey, '');
    onRemove();
  }

  function onBoxKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onClose();
    }
  }

  // act returns a click handler that keeps the click from reaching the reader.
  const act = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  const confirmRow: ReactNode = (
    <>
      {/* On a phone, the buttons drop to their own line where the question leaves them no room. */}
      <span className={`flex-1 min-w-0 font-sans text-ui-sm ${mobile ? 'basis-[150px]' : ''}`} style={{ color: theme.dim }}>
        Remove with its note?
      </span>
      <span className="flex-none ml-auto flex items-center gap-2.5">
        <button
          className={`flex-none font-sans text-ui-sm font-semibold rounded border border-danger-text/40 text-danger-text hover:bg-danger-text/10 ${mobile ? 'px-3.5 py-2' : 'px-2 py-[3px]'}`}
          onClick={act(remove)}
        >
          Remove
        </button>
        <button
          className={`flex-none font-sans text-ui-sm rounded border ${mobile ? 'px-3.5 py-2' : 'px-2 py-[3px]'}`}
          style={{ borderColor: theme.rule, color: theme.dim }}
          onClick={act(() => setConfirmingKey(null))}
        >
          Cancel
        </button>
      </span>
    </>
  );

  // noteBox renders the note's text box, recessed like the Keywords box.
  const noteBox = (rows: number) => (
    <div className="rounded-field px-3 py-2" style={{ border: `1px solid ${theme.rule}`, background: theme.bg }}>
      <textarea
        key={noteKey}
        ref={boxRef}
        defaultValue={note}
        onChange={(e) => setHighlightNote(noteKey, e.target.value)}
        onFocus={() => setNotingKey(noteKey)}
        onKeyDown={onBoxKeyDown}
        rows={rows}
        placeholder="Add a note"
        aria-label="Note"
        className="block w-full bg-transparent text-ui-base resize-none outline-none font-serif"
        // Scrolls its own text, without handing the drag on to the page at either end.
        style={{ border: 0, color: theme.fg, touchAction: 'pan-y', overscrollBehavior: 'contain' }}
      />
    </div>
  );

  // mobileSwatches renders the colour buttons at a size a finger can hit.
  const mobileSwatches = (
    <div className="flex-1 flex items-center gap-[10px]">
      {HIGHLIGHT_COLORS.map((c) => (
        <button key={c} className="w-[45px] h-[45px] flex items-center justify-center" onClick={act(() => choose(c))}>
          <span
            className="w-[33px] h-[33px] rounded-full border"
            style={{ background: highlightPaint(c, theme), borderColor: swatchBorder(theme, pop.on === c) }}
          />
        </button>
      ))}
    </div>
  );

  // On a phone, the note is written in a full-height sheet with its box near the top, where the
  // keyboard rising beneath it never covers it and the page has no need to move.
  if (mobile && noting) {
    return (
      <div
        // Its own key, so it mounts afresh rather than taking over the bar's element. It fades in so
        // the box is already in place when it takes focus.
        key="sheet"
        ref={ref}
        data-component="HighlightPopup"
        className="fixed inset-0 z-[60] flex flex-col px-5 animate-fadeIn"
        // `touchAction` keeps a drag on the sheet from moving the page, which the keyboard leaves
        // room to do.
        style={{ background: theme.panel, color: theme.fg, paddingTop: 'calc(12px + var(--safe-top))', touchAction: 'none' }}
        onPointerDown={onStop}
        onPointerUp={onStop}
        onMouseUp={onStop}
      >
        <div className="flex flex-wrap items-center gap-[10px]">
          {mobileSwatches}
          <button className="ml-auto h-[45px] px-2 font-sans text-ui-base font-semibold" onClick={act(onClose)}>
            Done
          </button>
        </div>
        {quote && (
          <div className="flex gap-2.5 pt-[6px] pb-4">
            <span className="w-[5px] self-stretch rounded-[3px] flex-none" style={{ background: highlightPaint(pop.on ?? HIGHLIGHT_COLORS[0], theme) }} />
            <span className="flex-1 min-w-0 text-ui-base leading-[1.45] line-clamp-4" style={{ color: theme.dim }}>
              {quote}
            </span>
          </div>
        )}
        {noteBox(6)}
      </div>
    );
  }

  // On touch otherwise, a full-width bar pinned along the bottom edge, with its own close button
  // and the note, if there is one, beneath the buttons.
  if (mobile) {
    return (
      <div
        ref={ref}
        data-component="HighlightPopup"
        className="fixed left-0 right-0 bottom-0 z-[60] px-5 pt-[13px] animate-sheetUp"
        style={{
          background: theme.panel,
          color: theme.fg,
          borderTop: `1px solid ${theme.rule}`,
          paddingBottom: 'calc(13px + var(--safe-bottom))',
        }}
        onPointerDown={onStop}
        onPointerUp={onStop}
        onMouseUp={onStop}
      >
        {/* The buttons drop to their own line, at the right, where a large UI size leaves no room
            beside the colours. */}
        <div className="flex flex-wrap items-center gap-[10px] min-h-[45px]">
          {confirming ? (
            confirmRow
          ) : (
            <>
              {mobileSwatches}
              <div className="flex-none ml-auto flex items-center gap-[10px]">
                <button aria-label="Note" className="w-[45px] h-[45px] flex items-center justify-center opacity-65" onClick={act(startNote)}>
                  <PencilLine size={21} strokeWidth={1.75} />
                </button>
                {pop.on && (
                  <button aria-label="Remove" className="w-[45px] h-[45px] flex items-center justify-center opacity-65" onClick={act(remove)}>
                    <Trash2 size={21} strokeWidth={1.75} />
                  </button>
                )}
                <button aria-label="Close" className="w-[45px] h-[45px] flex items-center justify-center opacity-55" onClick={act(onClose)}>
                  <X size={26} strokeWidth={1.75} />
                </button>
              </div>
            </>
          )}
        </div>
        {note && (
          // In the note box's own type, and inset 6px to line up with the first colour's circle.
          <button
            className="flex w-full gap-2 pl-[6px] pt-2 pb-1 text-left font-serif text-ui-base leading-[1.45]"
            style={{ color: theme.fg }}
            onClick={act(startNote)}
          >
            <StickyNote className="flex-none size-[1em] mt-[0.22em]" style={{ color: theme.dim }} strokeWidth={2} />
            <span className="min-w-0 line-clamp-3 whitespace-pre-wrap">{note}</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      data-component="HighlightPopup"
      className={`fixed z-[60] px-[14px] py-[9px] rounded-chip shadow-popup animate-popIn ${showNote ? 'w-[320px]' : ''}`}
      style={{
        left: (pop.x + (place?.dx ?? 0)) / getUiScale(),
        top: (above ? pop.top : pop.bottom) / getUiScale(),
        transform: above ? 'translate(-50%,-100%)' : 'translate(-50%,0)',
        marginTop: above ? -GAP : GAP,
        background: theme.panel,
        border: `1px solid ${theme.rule}`,
      }}
      onPointerDown={onStop}
      onPointerUp={onStop}
      onMouseUp={onStop}
    >
      <div className="flex items-center gap-[11px] min-h-[26px]">
        {confirming ? (
          confirmRow
        ) : (
          <>
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c}
                className="w-[25px] h-[25px] rounded-full border"
                style={{ background: highlightPaint(c, theme), borderColor: swatchBorder(theme, pop.on === c) }}
                onClick={act(() => choose(c))}
              />
            ))}
            {!showNote && (
              <button className="flex items-center gap-[5px] font-sans text-ui-sm opacity-65 px-1" onClick={act(startNote)}>
                <PencilLine size={19} strokeWidth={1.75} />
                Note
              </button>
            )}
            {pop.on && (
              <button
                className={`flex items-center gap-[5px] font-sans text-ui-sm opacity-65 px-1 ${showNote ? 'ml-auto' : ''}`}
                onClick={act(remove)}
              >
                <Trash2 size={20} strokeWidth={1.75} />
                Remove
              </button>
            )}
          </>
        )}
      </div>
      {showNote && <div className="pt-[9px]">{noteBox(3)}</div>}
    </div>
  );
}
