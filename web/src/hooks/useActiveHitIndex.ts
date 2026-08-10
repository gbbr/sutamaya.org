import { useEffect, useRef, useState } from 'react';

// Keyboard-navigable "which result row is highlighted" index over a capped search-hit list —
// shared by TreePane's own search results and ReaderSearchOverlay, both of which show a capped
// list of hits with up/down-to-move, Enter-to-open, and auto-scroll-into-view on move.
// `resetKey` resets the index back to 0 whenever it changes — both callers pass the search query
// itself, not the hit list's length, so an in-place hit-list update (e.g. notes changing) doesn't
// silently reset the user's current selection.
export function useActiveHitIndex(resetKey: unknown) {
  const [activeIndex, setActiveIndex] = useState(0);
  // Mirrors `activeIndex` for a caller (TreePane) whose own keydown listener is a window-level
  // effect with an intentionally narrow dependency array (so it isn't torn down and re-registered
  // on every arrow-key press) — that listener's closure would otherwise only ever see whatever
  // `activeIndex` was back when it was last (re-)registered, not later updates.
  const activeIndexRef = useRef(0);
  activeIndexRef.current = activeIndex;
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    setActiveIndex(0);
  }, [resetKey]);

  useEffect(() => {
    rowRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  function moveBy(delta: number, length: number) {
    setActiveIndex((i) => Math.min(length - 1, Math.max(0, i + delta)));
  }

  function setRowRef(i: number) {
    return (el: HTMLButtonElement | null) => {
      rowRefs.current[i] = el;
    };
  }

  return { activeIndex, activeIndexRef, setActiveIndex, moveBy, setRowRef };
}
