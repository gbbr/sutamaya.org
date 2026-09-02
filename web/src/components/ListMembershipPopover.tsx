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
// The popover's height, trimmed further on a shorter viewport.
const MAX_POPOVER_HEIGHT = 420;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

const SAFE_AREA_BOTTOM = 'env(safe-area-inset-bottom, 0px)';

// Whether opening the popover should focus its input. Not on a touch pointer: a wide touch device
// gets the anchored popover, positioned against a layout viewport the keyboard doesn't shrink, so
// raising one would bury the rows. Tapping the field still works.
const wantsAutoFocus = () => !window.matchMedia?.('(pointer: coarse)').matches;

// Points the mobile sheet at its own visible heading, rather than repeating it in an aria-label.
const TITLE_ID = 'list-membership-popover-title';

interface ListMembershipPopoverProps {
  suttaId: string;
  // The rect of the control that opened this, taken once: the row can disappear while the popover
  // is up, and re-measuring a detached element would move it somewhere arbitrary.
  anchor: DOMRect;
  mobile: boolean;
  onClose: () => void;
}

// The Library's chrome around ListMembershipPicker, which has none of its own: a full-screen modal
// on touch, where an anchored popover would sit under the keyboard, and a popover anchored to the
// row's control on desktop. Rendered as a sibling of the list rather than inside the row, so it
// survives that row unmounting.
export function ListMembershipPopover({ suttaId, anchor, mobile, onClose }: ListMembershipPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { corpus } = useCorpus();
  // Named in the mobile sheet's heading; the desktop popover hangs off the row itself.
  const sutta = corpus?.suttas[suttaId];

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || mobile) return;
    // Every measurement below is post-`zoom`, and a CSS length assigned here is scaled again at
    // paint, so it is pre-divided — the same handling HighlightPopup uses.
    const scale = getUiScale();
    // Capped against the viewport before measuring, so a long list of lists can't be taller than
    // either side of the anchor has room for.
    el.style.maxHeight = `${Math.min(MAX_POPOVER_HEIGHT, window.innerHeight - VIEWPORT_MARGIN * 2) / scale}px`;
    // Measured at a known origin rather than against a guess at the size, the height depending on
    // how many lists there are.
    el.style.left = '0px';
    el.style.top = '0px';
    const { width, height } = el.getBoundingClientRect();
    // Right edges aligned and growing leftwards, the control sitting at the row's right edge.
    const left = clamp(anchor.right - width, VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN);
    // Below the control, or above it where that would overflow; the clamp catches the case where
    // neither side has room, which the flip alone would put off the top.
    const below = anchor.bottom + ANCHOR_GAP;
    const wanted = below + height > window.innerHeight - VIEWPORT_MARGIN ? anchor.top - height - ANCHOR_GAP : below;
    const top = clamp(wanted, VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN);
    el.style.left = `${left / scale}px`;
    el.style.top = `${top / scale}px`;
  }, [anchor, mobile]);

  // Keeps the mobile modal's content clear of the software keyboard, which the layout viewport a
  // fixed element sits in doesn't shrink for; `visualViewport` is the only thing that reports the
  // region actually on screen. It pads rather than resizes, so the background keeps covering the
  // display: iOS reports the new height on the first frame but takes ~250ms to animate the
  // keyboard in, and a resized modal would show the page through the gap meanwhile.
  useLayoutEffect(() => {
    const el = ref.current;
    const vv = window.visualViewport;
    if (!el || !mobile || !vv) return;
    const apply = () => {
      const keyboard = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      // The safe-area inset comes back only once the keyboard is gone, the keyboard itself
      // covering the home indicator.
      el.style.paddingBottom = keyboard ? `${keyboard / getUiScale()}px` : SAFE_AREA_BOTTOM;
    };
    apply();
    vv.addEventListener('resize', apply);
    return () => vv.removeEventListener('resize', apply);
  }, [mobile]);

  // Escape closes. The picker handles it too, but only while its input has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // The touch presentation: full-screen rather than a sheet, which the keyboard would leave a few
  // rows of. The input sits at the top, as far from the keyboard as the display allows, and the
  // header's close button is the only way out, there being no backdrop to tap.
  if (mobile) {
    return (
      <div
        ref={ref}
        data-component="ListMembershipPopover"
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        // `touch-none` keeps a drag on the modal's chrome from panning the page underneath, which
        // iOS otherwise does with a gesture on an unscrollable part, making the modal's own top
        // edge lag. The rows opt back into vertical panning below.
        className="fixed left-0 right-0 top-0 z-50 flex flex-col bg-field animate-sheetUp touch-none"
        // The full layout viewport. `paddingBottom` is the resting value the effect above swaps
        // out while the keyboard is up, and all a browser without `visualViewport` ever sees.
        style={{ height: '100%', paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: SAFE_AREA_BOTTOM }}
      >
        <div className="flex-none flex items-center gap-2 px-4 pt-3.5 pb-2.5 border-b border-ink/10">
          {/* The heading, at ListPane's own header size — this is a whole screen — with the sutta
              named beneath it, the row that opened this no longer being on screen to say. */}
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
          {/* No autoFocus on touch: focusing while the modal is still sliding up has iOS scroll
              the layout viewport to reveal an input that is briefly off-screen, dragging modal and
              page with it. A tap on the field raises the keyboard instead, by which time the modal
              is at rest and the rows have been seen. */}
          <ListMembershipPicker suttaId={suttaId} theme={SHELL_THEME} onRequestClose={onClose} />
        </div>
      </div>
    );
  }

  return (
    <>
      {/* An invisible backdrop, which dismisses on a click and, being fixed and full-screen, also
          stops the pane scrolling out from under the anchor. */}
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
