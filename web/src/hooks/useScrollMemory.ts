import { useLayoutEffect, useRef } from 'react';

// Module-level so positions survive component unmount/remount within the same SPA
// session (e.g. LibraryPage remounting when the route pattern changes between
// /browse/:nodeId and /browse/:nodeId/:suttaId) without needing sessionStorage.
const positions = new Map<string, number>();

export function useScrollMemory<T extends HTMLElement>(key: string | null | undefined) {
  const ref = useRef<T>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || key == null) return;
    el.scrollTop = positions.get(key) ?? 0;
    const onScroll = () => positions.set(key, el.scrollTop);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      positions.set(key, el.scrollTop);
      el.removeEventListener('scroll', onScroll);
    };
  }, [key]);

  return ref;
}
