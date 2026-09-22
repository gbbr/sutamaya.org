import { useEffect, useRef, useState } from 'react';

// useActiveHitIndex tracks the arrow-key cursor over a search list, results or recent searches,
// scrolling each row the arrows reach into view.
export function useActiveHitIndex(
  // Returns the cursor to `initial` when it changes: the query, so rows updating in place keep it.
  resetKey: unknown,
  // Where the cursor starts: 0, the first row, or -1, no row until an arrow places it.
  initial: 0 | -1 = 0
) {
  const [activeIndex, setActiveIndex] = useState<number>(initial);
  // Mirrors `activeIndex` for a window-level keydown listener, whose closure would otherwise hold
  // the index it was registered with.
  const activeIndexRef = useRef<number>(initial);
  activeIndexRef.current = activeIndex;
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // Whether an index change scrolls its row into view. Only a cursor the reader has moved does: one
  // placed — on arrival, or under the pointer — leaves the scroll where it is.
  const revealRef = useRef(false);

  useEffect(() => {
    setActiveIndex(initial);
  }, [resetKey, initial]);

  useEffect(() => {
    if (revealRef.current) rowRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  function moveBy(delta: number, length: number) {
    revealRef.current = true;
    setActiveIndex((i) => Math.min(length - 1, Math.max(initial, i + delta)));
  }

  function setRowRef(i: number) {
    return (el: HTMLButtonElement | null) => {
      rowRefs.current[i] = el;
    };
  }

  return { activeIndex, activeIndexRef, setActiveIndex, moveBy, setRowRef };
}
