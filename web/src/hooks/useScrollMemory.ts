import { useLayoutEffect, useRef } from 'react';

// Module-level so positions survive component unmount/remount within the same SPA session
// (e.g. LibraryPage remounting when the route pattern changes) without needing extra state —
// and persisted to localStorage so they also survive a full app close (tab close, or a PWA
// force-quit and relaunch), which is what lets "/" restore not just the last screen but its
// exact scroll offset too (see lib/lastLocation.ts). Shared across tabs/windows like every
// other plain-localStorage key in this app (sutamaya.treeView, sutamaya.libraryView, the prefs
// contexts) — two tabs open on different suttas at once will clobber each other's entries on
// close, which is accepted here the same way it already is for those.
const STORAGE_KEY = 'sutamaya.scrollPositions';

function loadPositions(): Map<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return new Map(Object.entries(JSON.parse(raw)));
  } catch {
    // storage unavailable/corrupt — fall through to an empty map, in-memory-only for this load
  }
  return new Map();
}

const positions = loadPositions();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(positions)));
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
    const desired = positions.get(key) ?? 0;
    el.scrollTop = desired;
    const onScroll = () => {
      positions.set(key, el.scrollTop);
      schedulePersist();
    };
    el.addEventListener('scroll', onScroll, { passive: true });

    // Content that finishes loading only after mount (the reader's sutta text is fetched async —
    // see useSuttaText) can grow this element's *scrollable content* well past its initial
    // near-empty height, after the scrollTop set above already clamped to 0 for lack of room to
    // scroll to. `el` itself doesn't resize when that happens (it's a flex/viewport-bound scroll
    // container, so its own box stays fixed — only scrollHeight, the overflowing content inside
    // it, grows), which is why this needs a MutationObserver on the subtree rather than a
    // ResizeObserver on `el`. Re-apply once more the first time enough content has rendered to
    // actually hold the desired offset. Guarded on scrollTop still being exactly 0 so a real user
    // scroll that happens to land before the content finishes loading isn't clobbered by this
    // replaying stale state.
    let mo: MutationObserver | null = null;
    if (desired > 0) {
      mo = new MutationObserver(() => {
        if (el.scrollTop !== 0) {
          mo?.disconnect();
          return;
        }
        if (el.scrollHeight - el.clientHeight >= desired) {
          el.scrollTop = desired;
          mo?.disconnect();
        }
      });
      mo.observe(el, { childList: true, subtree: true });
    }

    return () => {
      positions.set(key, el.scrollTop);
      schedulePersist();
      el.removeEventListener('scroll', onScroll);
      mo?.disconnect();
    };
  }, [key, active]);

  return ref;
}
