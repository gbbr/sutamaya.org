import { useLayoutEffect, useRef } from 'react';
import { SCROLL_POSITIONS_KEY } from '../lib/storageKeys';

// Module-level so positions survive component unmount/remount within the same SPA session
// (e.g. LibraryPage remounting when the route pattern changes) without needing extra state —
// and persisted to localStorage so they also survive a full app close (tab close, or a PWA
// force-quit and relaunch), which is what lets "/" restore not just the last screen but its
// exact scroll offset too (see lib/lastLocation.ts). Shared across tabs/windows like every
// other plain-localStorage key in this app (sutamaya.treeView, sutamaya.libraryView, the prefs
// contexts) — two tabs open on different suttas at once will clobber each other's entries on
// close, which is accepted here the same way it already is for those.
const STORAGE_KEY = SCROLL_POSITIONS_KEY;

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

// Lets a caller that performs its own deliberate scroll on a scroll-memory container (e.g.
// useSuttaReading's scrollToSegment, jumping to one specific verse inside a batched document —
// see its own call to this) cancel this hook's MutationObserver-based restore below for that same
// element, so a stale remembered position can't silently overwrite the deliberate scroll later.
// Keyed by element rather than by the hook's own `key` string since the caller only has the DOM
// node (a scrollRef) to hand, not whatever string this mount happened to use.
const pendingRestoreCancel = new WeakMap<HTMLElement, () => void>();

export function cancelPendingRestore(el: HTMLElement | null | undefined) {
  if (!el) return;
  pendingRestoreCancel.get(el)?.();
  pendingRestoreCancel.delete(el);
}

// `active` lets a caller that's mounted-but-hidden (e.g. LibraryPage keeps both TreePane and
// ListPane mounted on mobile, toggling `display:none` on the inactive one instead of
// unmounting it, so its React/scroll state survives the toggle) skip restoring scroll while
// hidden. A `display:none` element has no layout box (scrollHeight 0), so setting `scrollTop`
// on it just clamps to 0 and silently loses the saved position — restoring only needs to
// happen once the pane is actually visible again, which is exactly when `active` flips true.
//
// `skipRestore` lets a caller that already knows, before this even mounts, that it has its own
// deliberate scroll target for this mount (useSuttaReading passes this whenever ReaderPage has a
// `requestedSubUid` — a deep link/search hit for one specific verse inside a batched document)
// skip the synchronous `scrollTop =` set and the MutationObserver-based re-apply below entirely,
// rather than performing them and then having the caller's own jump try to override the result
// (see scrollToSegment, and cancelPendingRestore's own comment on why overriding after the fact
// isn't reliable on iOS: two scroll writes on the same container milliseconds apart can *stack*
// instead of the second one superseding the first, landing well past the intended target). The
// scroll-memory *recording* (the `onScroll` listener/`positions` map below) still runs as normal
// — this only skips the restore-on-mount half, so leaving/re-entering a plain, non-deep-linked
// view of the same sutta still remembers and restores its own scroll position correctly.
export function useScrollMemory<T extends HTMLElement>(key: string | null | undefined, active = true, skipRestore = false) {
  const ref = useRef<T>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || key == null || !active) return;
    const desired = skipRestore ? 0 : positions.get(key) ?? 0;
    if (!skipRestore) el.scrollTop = desired;
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
    // replaying stale state — though that guard alone isn't enough on its own: it stays armed,
    // watching for further mutations, until its threshold is actually met, which can be well after
    // this mount's *first* content mutation (e.g. `desired` was recorded further into the document
    // than this session's content happens to reach). A deliberate scroll elsewhere in the app (see
    // cancelPendingRestore above) can land back at exactly 0 in the meantime — e.g. jumping to a
    // batched document's very first verse — indistinguishable, from this guard alone, from the
    // pre-load 0 it's meant to catch, so without an explicit cancel it would still fire later and
    // clobber that deliberate scroll once enough content has finally arrived.
    let mo: MutationObserver | null = null;
    if (desired > 0 && !skipRestore) {
      mo = new MutationObserver(() => {
        if (el.scrollTop !== 0) {
          mo?.disconnect();
          pendingRestoreCancel.delete(el);
          return;
        }
        if (el.scrollHeight - el.clientHeight >= desired) {
          el.scrollTop = desired;
          mo?.disconnect();
          pendingRestoreCancel.delete(el);
        }
      });
      mo.observe(el, { childList: true, subtree: true });
      pendingRestoreCancel.set(el, () => mo?.disconnect());
    }

    return () => {
      positions.set(key, el.scrollTop);
      schedulePersist();
      el.removeEventListener('scroll', onScroll);
      mo?.disconnect();
      pendingRestoreCancel.delete(el);
    };
  }, [key, active]);

  return ref;
}
