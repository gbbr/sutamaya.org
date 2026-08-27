import { useEffect, useRef, useState } from 'react';

// Which result row is highlighted, over a capped search-hit list — shared by TreePane's search
// results and ReaderSearchOverlay, both of which move with up/down, open with Enter and scroll the
// active row into view. `resetKey` returns the index to 0 whenever it changes; both callers pass
// the query rather than the hit list's length, so an in-place update to the hits (a note changing)
// doesn't reset the selection.
export function useActiveHitIndex(resetKey: unknown) {
  const [activeIndex, setActiveIndex] = useState(0);
  // Mirrors `activeIndex` for TreePane, whose keydown listener is a window-level effect with a
  // narrow dependency array so it isn't re-registered on every arrow press. That listener's closure
  // would otherwise see only the `activeIndex` it was last registered with.
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
