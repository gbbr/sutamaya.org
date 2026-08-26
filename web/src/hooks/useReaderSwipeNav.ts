import { useEffect } from 'react';
import { useLatest } from './useLatest';

interface UseReaderSwipeNavOptions {
  // The element itself, not a ref to it: ReaderPage renders a bare "Loading…" screen until the
  // corpus arrives, so on a cold load this hook first runs with nothing to attach to. Taking the
  // node as a dependency is what re-subscribes once it exists — a ref's `.current` filling in
  // later changes nothing this effect would notice, leaving swipe navigation dead for the session.
  root: HTMLElement | null;
  panel: boolean;
  step: (dir: 1 | -1) => void;
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
      // The side panel (including its own font-size/line-height range inputs) is a full-height
      // overlay rendered inside this same root, so without this guard a touch drag started over
      // it — including a horizontal one on a slider thumb — would still bubble up here and get
      // read as a swipe once released.
      // A live text selection takes precedence over the swipe: dragging either of its handles is
      // a horizontal drag over the reading pane like any other, and the reader wants the handle
      // to move, not the sutta to change. One tap clears the selection and swiping works again.
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
      // The touchstart guard can't catch the long-press-drag that *creates* a selection — there is
      // nothing selected yet when the touch lands — so the gesture is re-checked on release.
      if (!panel && start && lock === 'h' && !String(window.getSelection())) {
        const t = e.changedTouches[0];
        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;
        // Deliberately narrow: the horizontal travel has to be both long enough on its own and
        // clearly dominant over the vertical. `touch-action: pan-y` means the browser scrolls the
        // text natively on any vertical component of a drag, so a diagonal swipe both moves the
        // sutta and leaves the reader's place shifted — and a diagonal drag is what an accidental
        // sutta change tends to be in the first place. Requiring near-horizontal motion is what
        // separates a swipe from a slightly-slanted scroll.
        if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2 && Math.abs(dy) < 60) stepRef.current(dx < 0 ? 1 : -1);
      }
      start = null;
      lock = null;
    }
    // A cancelled touch is the browser taking the gesture away — most often iOS's own
    // swipe-from-the-edge to go back, which is a long rightward drag over this element and would
    // otherwise be committed as a step to the previous sutta on top of the history navigation it
    // already performed. The gesture is abandoned, not completed: drop it without evaluating.
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
