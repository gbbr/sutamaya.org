import { useEffect } from 'react';
import { useLatest } from './useLatest';

interface UseReaderSwipeNavOptions {
  // The element itself, not a ref to it: ReaderPage renders a bare "Loading…" screen until the
  // corpus arrives, so on a cold load this hook first runs with nothing to attach to. Taking the
  // node as a dependency re-subscribes once it exists; a ref's `.current` filling in later is not
  // something this effect would notice.
  root: HTMLElement | null;
  panel: boolean;
  step: (dir: 1 | -1) => void;
}

// Swipe left or right to step to the next or previous sutta on mobile. It bypasses React's Pointer
// Events — which ReaderPage's tap-to-dismiss handlers use — because the reading pane is vertically
// scrollable, and a browser commits to a native vertical scroll as soon as a touch shows any
// vertical drift, at which point it stops delivering pointermove/pointerup for that touch and fires
// pointercancel instead. A pointerup-only check would therefore only ever see a perfectly
// horizontal drag.
//
// The root's `touch-action: pan-y`, set in ReaderPage's JSX, is what keeps this clear of normal
// vertical scrolling: it tells the browser from CSS alone that only vertical panning is handled
// natively, so compositor-thread scrolling can start on any vertical-ish touch without waiting on
// the `touchmove` listener below. That is what lets the listener stay passive — it only reads touch
// deltas and never calls preventDefault(). A non-passive listener forces the browser to run it
// before committing to any touch-driven scroll, which on a busy main thread reads as scrolling
// being frozen for seconds.
export function useReaderSwipeNav({ root, panel, step }: UseReaderSwipeNavOptions) {
  // Reached through a latest ref rather than named in the dependency array below, so the touch
  // listeners subscribe once and still call the current `step` — see useLatest.
  const stepRef = useLatest(step);

  useEffect(() => {
    const el = root;
    if (!el) return;
    let start: { x: number; y: number } | null = null;
    let lock: 'h' | 'v' | null = null;

    function onTouchStart(e: TouchEvent) {
      // The side panel, with its range inputs, is a full-height overlay inside this same root, so
      // without this guard a drag started over it — a horizontal one on a slider thumb included —
      // would bubble here and read as a swipe.
      //
      // A live text selection also takes precedence: dragging a selection handle is a horizontal
      // drag over the reading pane like any other, and the handle is what should move. One tap
      // clears the selection and swiping works again.
      if (panel || e.touches.length !== 1 || String(window.getSelection())) {
        start = null;
        lock = null;
        return;
      }
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      lock = null;
    }
    function onTouchMove(e: TouchEvent) {
      if (panel || !start || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - start.x;
      const dy = e.touches[0].clientY - start.y;
      if (!lock) {
        if (Math.hypot(dx, dy) < 10) return;
        lock = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
      }
    }
    function onTouchEnd(e: TouchEvent) {
      // The touchstart guard can't catch the long-press-drag that creates a selection, since
      // nothing is selected when the touch lands, so the gesture is re-checked on release.
      if (!panel && start && lock === 'h' && !String(window.getSelection())) {
        const t = e.changedTouches[0];
        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;
        // Narrow: the horizontal travel has to be long enough on its own and clearly dominant over
        // the vertical. `touch-action: pan-y` means the browser scrolls the text natively on any
        // vertical component, so a diagonal swipe would both change the sutta and leave the
        // reader's place shifted. Requiring near-horizontal motion separates a swipe from a
        // slightly-slanted scroll.
        if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2 && Math.abs(dy) < 60) stepRef.current(dx < 0 ? 1 : -1);
      }
      start = null;
      lock = null;
    }
    // A cancelled touch is the browser taking the gesture away — most often iOS's swipe-from-the-
    // edge back navigation, a long rightward drag over this element that would otherwise also
    // commit a step to the previous sutta. The gesture is abandoned, so drop it without evaluating.
    function onTouchCancel() {
      start = null;
      lock = null;
    }
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchCancel, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchCancel);
    };
  }, [root, panel, stepRef]);
}
