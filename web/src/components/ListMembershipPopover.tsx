import { useEffect, useLayoutEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { ListMembershipPicker } from './ListMembershipPicker';
import { useCorpus } from '../context/CorpusContext';
import { SHELL_THEME } from '../lib/theme';
import { getUiScale } from '../lib/uiPrefs';

const POPOVER_WIDTH = 288;
// How far the popover keeps off the viewport edges.
const VIEWPORT_MARGIN = 10;
// Between the popover and the control it hangs off.
const ANCHOR_GAP = 6;
// Tall enough to show a good number of lists, short enough that it still reads as a popover
// rather than a panel. Trimmed further when the viewport itself is shorter than this.
const MAX_POPOVER_HEIGHT = 420;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

const SAFE_AREA_BOTTOM = 'env(safe-area-inset-bottom, 0px)';

// Whether opening the popover should also raise a software keyboard. A wide touch device — an
// iPad in landscape — is past MOBILE_BREAKPOINT and so gets the anchored popover below, which is
// positioned against the layout viewport that the keyboard does not shrink; focusing the input on
// open therefore buries the rows the popover exists to show. Tapping the field still works.
const wantsAutoFocus = () => !window.matchMedia?.('(pointer: coarse)').matches;

// Names the mobile sheet for assistive tech via its own visible heading, rather than repeating
// the string in an aria-label. Only ever one of these is mounted at a time, so a constant is fine.
const TITLE_ID = 'list-membership-popover-title';

interface ListMembershipPopoverProps {
  suttaId: string;
  // Screen-space rect of the control that opened this — the row's own "add to list" button. Taken
  // once, at open: the row it belongs to can disappear while the popover is up (unchecking the
  // list you are currently viewing removes it), and re-measuring a detached element would move
  // the popover somewhere arbitrary.
  anchor: DOMRect;
  mobile: boolean;
  onClose: () => void;
}

// The Library's wrapper around ListMembershipPicker, which is otherwise just a bare input + rows
// with no chrome of its own (the reader supplies its own, in a side-panel tab). Two presentations:
// a full-screen modal on touch, where an anchored popover would end up under the keyboard, and a
// popover anchored to the row's control on desktop.
//
// Rendered by ListPane as a sibling of the list rather than inside the row, so it survives that
// row unmounting — see `anchor` above.
export function ListMembershipPopover({ suttaId, anchor, mobile, onClose }: ListMembershipPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { corpus } = useCorpus();
  // Only the mobile screen shows this; the desktop popover hangs off the row itself, which is
  // still visible behind it.
  const sutta = corpus?.suttas[suttaId];

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || mobile) return;
    // Same coordinate handling as HighlightPopup: `anchor` and getBoundingClientRect() below are
    // already multiplied by the `zoom` on <html> (see applyUiScale), but a CSS length assigned
    // here gets multiplied by it again at paint time, so it has to be pre-divided.
    const scale = getUiScale();
    // Cap the height against the viewport before measuring, so a short window (or a long list of
    // lists) can't produce a popover taller than there is room for on either side of the anchor.
    el.style.maxHeight = `${Math.min(MAX_POPOVER_HEIGHT, window.innerHeight - VIEWPORT_MARGIN * 2) / scale}px`;
    // Measure at a known origin rather than assuming the CSS width and an unbounded height: the
    // height depends on how many lists exist, and clamping either axis against a guess is what
    // lets a popover hang off the edge.
    el.style.left = '0px';
    el.style.top = '0px';
    const { width, height } = el.getBoundingClientRect();
    // Right edges aligned to the control, growing leftwards — the control sits at the row's right
    // edge, so any other alignment pushes the popover off a narrow pane.
    const left = clamp(anchor.right - width, VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN);
    // Below the control by default; above it when that would overflow the bottom. The clamp is
    // what catches the case where neither side has room, rather than letting the flip put it
    // off the top instead.
    const below = anchor.bottom + ANCHOR_GAP;
    const wanted = below + height > window.innerHeight - VIEWPORT_MARGIN ? anchor.top - height - ANCHOR_GAP : below;
    const top = clamp(wanted, VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN);
    el.style.left = `${left / scale}px`;
    el.style.top = `${top / scale}px`;
  }, [anchor, mobile]);

  // A `position: fixed` element is laid out against the layout viewport, which the software
  // keyboard does not shrink, so on touch the modal's content would run underneath the keyboard.
  // `visualViewport` is the only thing that reports the region actually on screen — no CSS unit
  // exposes it (`dvh` tracks browser chrome, not the keyboard, and Safari ignores
  // `interactive-widget=resizes-content`).
  //
  // What is adjusted is the modal's bottom padding, not its height, so the background keeps
  // covering the whole display: iOS animates the keyboard in over ~250ms but reports the new
  // viewport height on the first frame, so anything resizing to match would sit a keyboard's height
  // short of the screen for a quarter second with the page showing through.
  useLayoutEffect(() => {
    const el = ref.current;
    const vv = window.visualViewport;
    if (!el || !mobile || !vv) return;
    const apply = () => {
      const keyboard = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      // With the keyboard up it covers the home indicator, so the safe-area inset it replaces is
      // only wanted back once the keyboard is gone.
      el.style.paddingBottom = keyboard ? `${keyboard / getUiScale()}px` : SAFE_AREA_BOTTOM;
    };
    apply();
    vv.addEventListener('resize', apply);
    return () => vv.removeEventListener('resize', apply);
  }, [mobile]);

  // The picker handles Escape itself, but only while its input has focus (and there the first
  // press clears the draft rather than closing) — this covers every other case.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Full-screen on touch rather than a partial-height sheet: the keyboard would eat most of a
  // sheet, leaving a few rows visible between the two. Filling the screen puts the input at the top,
  // as far from the keyboard as the display allows, and gives the rows every pixel the keyboard
  // isn't using — which is also what makes autofocusing the input reasonable here. There is no
  // backdrop to tap, so the header's close button is the only way out.
  if (mobile) {
    return (
      <div
        ref={ref}
        data-component="ListMembershipPopover"
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        // `touch-none` stops a drag on the modal's chrome — the header, the gap beside the input —
        // from panning the page underneath. Those parts aren't scrollable, so iOS hands the gesture
        // to the document, which scrolls the page behind the modal and, since a fixed element is
        // anchored to the layout viewport, makes the modal's top edge lag. The rows opt back in to
        // vertical panning below.
        className="fixed left-0 right-0 top-0 z-50 flex flex-col bg-field animate-sheetUp touch-none"
        // Always the full layout viewport. `paddingBottom` is the resting value the effect above
        // swaps out while the keyboard is up, and the only value a browser without
        // `visualViewport` ever sees.
        style={{ height: '100%', paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: SAFE_AREA_BOTTOM }}
      >
        <div className="flex-none flex items-center gap-2 px-4 pt-3.5 pb-2.5 border-b border-ink/10">
          {/* Sized and weighted like ListPane's own header rather than like a popover label: this
              is a whole screen, and a 15px title on one reads as a stray caption. The second line
              names the sutta because the row that opened this is no longer on screen to say. */}
          <div className="flex-1 min-w-0">
            <div id={TITLE_ID} className="font-sans text-ui-2xl font-semibold tracking-[-.01em]">
              Add to list
            </div>
            {sutta && (
              <div className="font-sans text-ui-xs text-ink-4 mt-[2px] truncate">
                <span className="text-ink-4">{sutta.ref} · </span>
                {sutta.en}
              </div>
            )}
          </div>
          <button
            className="flex-none w-9 h-9 -mr-2 flex items-center justify-center rounded-full text-ink-4 active:bg-ink/[.08]"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={22} strokeWidth={1.75} />
          </button>
        </div>
        <div className="flex flex-col flex-1 min-h-0 px-4 pt-2.5 pb-4">
          {/* No autoFocus on touch. Focusing the input while the modal is still sliding up leaves
              it off-screen at that instant, and iOS answers by scrolling the whole layout viewport
              to reveal it — dragging this modal and the page behind it ~270px up the screen. The
              keyboard now only appears because someone tapped the field, by which time the modal
              is at rest. It also keeps the rows, which are the point of this screen, unobscured
              until the user actually asks to filter them. */}
          <ListMembershipPicker suttaId={suttaId} theme={SHELL_THEME} onRequestClose={onClose} />
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Invisible, but it is what makes a click anywhere else dismiss the popover — and, being
          fixed and full-screen, it also stops the pane scrolling out from under the anchor. */}
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        ref={ref}
        data-component="ListMembershipPopover"
        // Modal on desktop too: the click-catcher above blocks everything behind it, so telling
        // assistive tech the background is out of reach matches what a pointer already finds.
        role="dialog"
        aria-modal="true"
        aria-label="Add to list"
        className="fixed z-50 flex flex-col rounded-field border border-ink/[.14] bg-field shadow-popup p-2 animate-popIn"
        style={{ width: POPOVER_WIDTH }}
      >
        <ListMembershipPicker suttaId={suttaId} theme={SHELL_THEME} autoFocus={wantsAutoFocus()} onRequestClose={onClose} />
      </div>
    </>
  );
}
