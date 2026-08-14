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
//
// `readyToRestore` lets a caller that knows it has more than one async content source feeding
// this same container defer the restore until all of them have actually landed, rather than
// leaving this hook to discover that the hard way. Concretely: the reader's sutta text
// (useSuttaText) and its notes/highlight-count/list-membership chips (rendered above the text —
// see ReaderPage.tsx, and useSuttaReading's own use of this param) come from two independent
// fetches that don't resolve together — restoring as soon as the text alone satisfies `desired`
// used to mean the chips/notes fetch landing moments later, inserting its own block above the
// text, would grow the container *again* and shift what's on screen (including via the browser's
// own CSS scroll-anchoring compensating for content inserted above the current position — see
// git history for the on-device capture that pinned this down). Defaulting to `true` keeps every
// other caller (TreePane/ListPane, which have no such second source) restoring immediately on
// mount, same as before this param existed.
const USER_INTENT_EVENTS = ['wheel', 'touchstart', 'pointerdown'] as const;

// Even with `readyToRestore` covering the known content sources, this stays as a backstop for
// anything unanticipated — give up unconditionally after this long with no user input and no
// more growth, so a mount that never quite reaches `desired` doesn't leave a MutationObserver
// running forever.
const RESTORE_GRACE_MS = 5000;

export function useScrollMemory<T extends HTMLElement>(
  key: string | null | undefined,
  active = true,
  skipRestore = false,
  readyToRestore = true
) {
  const ref = useRef<T>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || key == null || !active || !readyToRestore) return;
    const desired = skipRestore ? 0 : positions.get(key) ?? 0;
    if (!skipRestore) el.scrollTop = desired;
    const onScroll = () => {
      positions.set(key, el.scrollTop);
      schedulePersist();
    };
    el.addEventListener('scroll', onScroll, { passive: true });

    // `readyToRestore` handles the *known* async content sources for a caller that tells this
    // hook about them; this covers everything else. `el` itself doesn't resize when its content
    // grows after this point (it's a flex/viewport-bound scroll container, so its own box stays
    // fixed — only scrollHeight, the overflowing content inside it, grows), which is why this
    // needs a MutationObserver on the subtree rather than a ResizeObserver on `el`. Stays armed
    // rather than disconnecting after its first correction, so it can also catch the browser's
    // own CSS scroll-anchoring compensating for any further, unanticipated content shift as an
    // ordinary scrollTop change away from `desired`. Only real user scroll input (or an explicit
    // cancelPendingRestore — see its own comment) gives up this restore for good; a bare timeout
    // is just the last-resort backstop.
    let stop: (() => void) | null = null;
    if (desired > 0 && !skipRestore) {
      const mo = new MutationObserver(() => {
        if (el.scrollTop !== desired && el.scrollHeight - el.clientHeight >= desired) {
          el.scrollTop = desired;
        }
      });
      mo.observe(el, { childList: true, subtree: true });
      const onUserIntent = () => stop?.();
      USER_INTENT_EVENTS.forEach((type) => el.addEventListener(type, onUserIntent, { passive: true, once: true }));
      const graceTimer = setTimeout(() => stop?.(), RESTORE_GRACE_MS);
      stop = () => {
        mo.disconnect();
        clearTimeout(graceTimer);
        USER_INTENT_EVENTS.forEach((type) => el.removeEventListener(type, onUserIntent));
        pendingRestoreCancel.delete(el);
        stop = null;
      };
      pendingRestoreCancel.set(el, stop);
    }

    return () => {
      positions.set(key, el.scrollTop);
      schedulePersist();
      el.removeEventListener('scroll', onScroll);
      stop?.();
    };
  }, [key, active, readyToRestore]);

  return ref;
}
