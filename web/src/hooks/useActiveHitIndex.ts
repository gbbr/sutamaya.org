import { useEffect, useRef, useState } from 'react';

// Tracks which search-hit row is highlighted, for TreePane's results and ReaderSearchOverlay —
// both of which move with up/down, open with Enter, and scroll the active row into view. The index
// returns to 0 whenever `resetKey` changes; callers pass the query, so an in-place update to the
// hits doesn't disturb the selection.
export function useActiveHitIndex(resetKey: unknown) {
  const [activeIndex, setActiveIndex] = useState(0);
  // Mirrors `activeIndex` for a window-level keydown listener, whose closure would otherwise hold
  // the index it was registered with.
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
