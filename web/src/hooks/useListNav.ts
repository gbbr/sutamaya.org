import { useEffect, useRef, useState } from 'react';

export const SEARCH_INPUT_ID = 'library-search-input';

// Generic up/down/Enter navigation over a flat, ordered list, driving one shared activeIndex
// used by both ListPane's rows and TreePane's search hits. Listens globally so it works
// without focus being anywhere specific — ignored while typing in a text field, except the
// search input itself (SEARCH_INPUT_ID), so a typed query can be arrowed into directly.
export function useListNav(count: number, onActivate: (index: number) => void, resetKey?: string | number) {
  const [activeIndex, setActiveIndex] = useState(-1);

  const indexRef = useRef(activeIndex);
  indexRef.current = activeIndex;
  const onActivateRef = useRef(onActivate);
  onActivateRef.current = onActivate;

  useEffect(() => {
    setActiveIndex(-1);
  }, [resetKey]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (count === 0) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName?.toLowerCase();
      const isSearchInput = el?.id === SEARCH_INPUT_ID;
      if (tag === 'textarea' || (tag === 'input' && !isSearchInput)) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => Math.min(count - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter' && indexRef.current >= 0 && indexRef.current < count) {
        e.preventDefault();
        onActivateRef.current(indexRef.current);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [count]);

  return { activeIndex, setActiveIndex };
}
