import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';
import { autoScrollEdge } from '../lib/dragAutoScroll';

interface UsePointerDragSessionParams {
  scrollRef: RefObject<HTMLElement | null>;
  // Called once per animation frame while a drag is engaged, with the latest pointer Y, for the
  // caller to recompute its own drop target or live order.
  onFrame: (pointerY: number) => void;
}

interface StartDragOptions {
  // Pointer movement, in px, before the drag engages. 0 engages immediately, for a dedicated drag
  // handle; a positive threshold leaves a plain tap to the row's own click handlers.
  threshold?: number;
  // Fires once, when the drag engages, before the per-frame loop starts.
  onEngage: () => void;
  // Fires on pointerup or pointercancel, but only for a drag that engaged.
  onEnd: () => void;
}

// The Pointer Events plumbing shared by TreePane's list-tree drag and ListPane's sutta reorder:
// window-level pointermove/pointerup/pointercancel listeners rather than the row's own or HTML5
// drag-and-drop, neither of which touch browsers fire reliably; a rAF loop that auto-scrolls
// `scrollRef`'s container and calls `onFrame`; and unmount-safe cleanup of both.
export function usePointerDragSession({ scrollRef, onFrame }: UsePointerDragSessionParams) {
  const activeRef = useRef(false);
  const pointerYRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  // Removes the window listeners a candidate or active drag registered, so an unmount mid-drag
  // can tear them down.
  const teardownRef = useRef<(() => void) | null>(null);
  // Mirrors the latest `onFrame` for the rAF loop, so `start`, `cancel` and the returned object
  // stay referentially stable for the memoized rows they are handed to.
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

  // Begins a drag from a pointerdown, engaging at `threshold` and running until the pointer lifts.
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

  // Tears down a still-active drag's window listeners and rAF loop, on unmount mid-drag.
  const cancel = useCallback(() => {
    teardownRef.current?.();
    stopLoop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => cancel, [cancel]);

  // Memoized so the object itself is stable, not only its two members: useListTreeDrag passes the
  // whole session through as a hook dependency.
  return useMemo(() => ({ start, cancel }), [start, cancel]);
}
