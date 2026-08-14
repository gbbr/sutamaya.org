import { useEffect, type RefObject } from 'react';

interface UseReaderSwipeNavOptions {
  rootRef: RefObject<HTMLElement | null>;
  panel: boolean;
  step: (dir: 1 | -1) => void;
  // Only used below to decide when the listener needs re-subscribing (see the effect's own
  // dependency array comment) — `step` itself closes over these but isn't memoized, so they stand
  // in for it the same way useReaderKeyboard's own options do.
  siblingIds: string[];
  suttaId: string | undefined;
}

// Swipe-left/right to go to the next/prev sutta on mobile. This has to bypass React's own
// Pointer Events (what the tap-to-dismiss-popup handlers in ReaderPage use) because the reading
// pane is vertically scrollable, and browsers commit to a native vertical-scroll gesture as soon
// as a touch shows *any* vertical drift — once that happens they stop delivering pointermove/
// pointerup for that touch (a pointercancel fires instead), so a pointerup-only swipe check
// silently never fires for anything but a perfectly horizontal drag.
//
// The root's own `touch-action: pan-y` (set in ReaderPage's JSX) is what actually keeps this from
// conflicting with normal vertical scrolling: it tells the browser upfront, from CSS alone, that
// only vertical panning is ever handled natively here, so it can start compositor-thread
// scrolling immediately on any vertical-ish touch without waiting on this effect's own
// `touchmove` listener at all. That's what lets the listener below stay fully passive — it only
// ever needs to *read* touch deltas for the horizontal-swipe threshold, never preventDefault()
// anything itself (the browser already won't hand horizontal motion to native scroll/
// pull-to-refresh). A non-passive listener, by contrast, forces the browser to wait for it to run
// before committing to *any* touch-driven scroll, on the chance it calls preventDefault() — on a
// slow device or first load (heavy initial `SegmentedText` rendering, corpus/text JSON parsing)
// with the main thread busy, that reads as "can't scroll for a few seconds."
export function useReaderSwipeNav({ rootRef, panel, step, siblingIds, suttaId }: UseReaderSwipeNavOptions) {
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let start: { x: number; y: number } | null = null;
    let lock: 'h' | 'v' | null = null;

    function onTouchStart(e: TouchEvent) {
      // The side panel (including its own font-size/line-height range inputs) is a full-height
      // overlay rendered inside this same root, so without this guard a touch drag started over
      // it — including a horizontal one on a slider thumb — would still bubble up here and get
      // read as a swipe once released.
      if (panel || e.touches.length !== 1) {
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
      if (!panel && start && lock === 'h') {
        const t = e.changedTouches[0];
        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;
        if (Math.abs(dx) > 70 && Math.abs(dy) < 60) step(dx < 0 ? 1 : -1);
      }
      start = null;
      lock = null;
    }
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siblingIds, suttaId, panel]);
}
