import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';
import { autoScrollEdge } from '../lib/dragAutoScroll';

interface UsePointerDragSessionParams {
  scrollRef: RefObject<HTMLElement | null>;
  // Called once per animation frame while a drag is engaged, with the latest pointer Y — this is
  // where a caller recomputes its own drop target/live order; auto-scrolling the scrollRef
  // container is handled here so both callers don't each re-implement the same rAF+edge-scroll
  // loop.
  onFrame: (pointerY: number) => void;
}

interface StartDragOptions {
  // Minimum pointer movement (px) before the drag "engages". Omit (0) to engage immediately —
  // for a dedicated drag handle, where there's no ambiguity with a plain tap/click underneath it.
  // A positive threshold lets a plain tap on the row itself still reach its own click handlers
  // (select/rename/delete/menu), since nothing here calls preventDefault or pointer-capture until
  // a real drag is underway.
  threshold?: number;
  // Fires once, the moment the drag actually engages (immediately for threshold 0, or once the
  // pointer clears `threshold`) — this is where a caller sets its own "currently dragging id"
  // state before the per-frame loop starts calling onFrame.
  onEngage: () => void;
  // Fires on pointerup/pointercancel, but only if the drag actually engaged — a tap that never
  // crossed the threshold ends silently, matching each caller's original behavior.
  onEnd: () => void;
}

// Shared Pointer Events plumbing behind both TreePane's list-tree drag (useListTreeDrag) and
// ListPane's sutta-reorder drag: window-level pointermove/pointerup/pointercancel listeners (not
// this row's own onPointerMove/HTML5 drag-and-drop, neither of which touch browsers fire
// reliably), a rAF loop that auto-scrolls `scrollRef`'s container and calls back into the
// caller's own per-frame drop-target logic, and unmount-safe cleanup of both. What differs
// between the two callers — hit-testing rows for a drop zone vs. reshuffling a live order array,
// and how each commits its result — stays in their own code; this hook owns only the mechanics
// they have in common.
export function usePointerDragSession({ scrollRef, onFrame }: UsePointerDragSessionParams) {
  const activeRef = useRef(false);
  const pointerYRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  // Set for the duration of a candidate/active drag so an unmount mid-drag can tear down the
  // window-level listeners it registered.
  const teardownRef = useRef<(() => void) | null>(null);
  // Mirrors the latest `onFrame` into a ref, read by the rAF loop below, instead of the loop
  // closing over the prop directly — this is what lets `start`/`cancel` (and the object this hook
  // returns) be useCallback/useMemo'd with a stable identity regardless of `onFrame` being a
  // fresh closure every caller render. Both this hook's callers (useListTreeDrag, ListPane) hand
  // `start` down to a memoized row component as a prop, where a fresh reference every render
  // would defeat that row's own memoization entirely (see ListRow/TreeRow's memo comments).
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  function stopLoop() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    activeRef.current = false;
  }

  function runLoop() {
    activeRef.current = true;
    function tick() {
      if (!activeRef.current) {
        rafRef.current = null;
        return;
      }
      autoScrollEdge(scrollRef.current, pointerYRef.current);
      onFrameRef.current(pointerYRef.current);
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  // useCallback'd with no deps — only ever reads/writes refs (including onFrameRef above) or
  // calls other functions in this closure that do the same, so its behavior doesn't depend on
  // which render's closure is actually invoked.
  const start = useCallback((e: React.PointerEvent, { threshold = 0, onEngage, onEnd }: StartDragOptions) => {
    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    let engaged = false;

    function engage(y: number) {
      engaged = true;
      pointerYRef.current = y;
      onEngage();
      runLoop();
    }

    function onMove(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return;
      if (!engaged) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < threshold) return;
        engage(ev.clientY);
        return;
      }
      pointerYRef.current = ev.clientY;
    }
    function onUp(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return;
      teardown();
      stopLoop();
      if (engaged) onEnd();
    }
    function teardown() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      teardownRef.current = null;
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    teardownRef.current = teardown;

    if (threshold <= 0) engage(startY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tears down a still-active drag's window listeners (and any live rAF loop) if the owning
  // component unmounts mid-drag (e.g. navigating away while dragging) — without this the
  // listeners registered in `start` above would never be removed. useCallback'd for the same
  // reason `start` is — only touches refs, so identity can stay stable across renders.
  const cancel = useCallback(() => {
    teardownRef.current?.();
    stopLoop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => cancel, [cancel]);

  // Memoized so the object itself (not just start/cancel individually) is referentially stable —
  // a caller destructuring `{ start }` from a fresh object every render would still see a stable
  // function, but a caller passing the whole `dragSession` object through as a hook dependency
  // (see useListTreeDrag) needs the object itself to be stable too.
  return useMemo(() => ({ start, cancel }), [start, cancel]);
}
