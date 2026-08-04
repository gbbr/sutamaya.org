import { useLayoutEffect, useRef } from 'react';

// Module-level so positions survive component unmount/remount within the same SPA session
// (e.g. LibraryPage remounting when the route pattern changes) without needing extra state —
// and now seeded from/persisted to sessionStorage, so they also survive a full page reload.
// sessionStorage (not localStorage) on purpose: it's cleared when the tab actually closes,
// which matches "where was I, this session" rather than becoming an ever-growing permanent
// record of every node the user has ever scrolled.
const STORAGE_KEY = 'sutamaya.scrollPositions';

function loadPositions(): Map<string, number> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return new Map(Object.entries(JSON.parse(raw)));
  } catch {
    // storage unavailable/corrupt — fall through to an empty map, in-memory-only for this load
  }
  return new Map();
}

const positions = loadPositions();

function persist() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(positions)));
  } catch {
    // storage unavailable or quota exceeded — the in-memory map still works for this session
  }
}

// Writing to sessionStorage on every scroll tick would be a lot of synchronous main-thread
// work during a fling — debounce it, and flush immediately on pagehide (fires for reloads too,
// not just navigating away) so the very last position isn't lost to an unfired debounce.
let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist() {
  if (persistTimer != null) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persist();
  }, 250);
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', persist);
}

// `active` lets a caller that's mounted-but-hidden (e.g. LibraryPage keeps both TreePane and
// ListPane mounted on mobile, toggling `display:none` on the inactive one instead of
// unmounting it, so its React/scroll state survives the toggle) skip restoring scroll while
// hidden. A `display:none` element has no layout box (scrollHeight 0), so setting `scrollTop`
// on it just clamps to 0 and silently loses the saved position — restoring only needs to
// happen once the pane is actually visible again, which is exactly when `active` flips true.
export function useScrollMemory<T extends HTMLElement>(key: string | null | undefined, active = true) {
  const ref = useRef<T>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || key == null || !active) return;
    el.scrollTop = positions.get(key) ?? 0;
    const onScroll = () => {
      positions.set(key, el.scrollTop);
      schedulePersist();
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      positions.set(key, el.scrollTop);
      schedulePersist();
      el.removeEventListener('scroll', onScroll);
    };
  }, [key, active]);

  return ref;
}
