import { useLayoutEffect, useRef } from 'react';
import { SCROLL_POSITIONS_KEY } from '../lib/storageKeys';

// Module-level, so positions survive a component unmounting and remounting within one SPA session,
// and persisted to localStorage so they survive a full app close too — which is what lets "/"
// restore not just the last screen but its exact scroll offset (see lib/lastLocation.ts). Shared
// across tabs like every other plain-localStorage key here, so two tabs open on different suttas
// clobber each other's entries on close, accepted the same way it is for those.
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

// Writing to localStorage on every scroll tick would be a lot of synchronous main-thread work
// during a fling — debounce it, and flush immediately on pagehide (fires for reloads too, not
// just navigating away) so the very last position isn't lost to an unfired debounce.
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

// Empties the in-memory map as well as its persisted copy. Clearing localStorage alone would not
// do it: `positions` is module-level and loaded once, so the pending debounce — or the `pagehide`
// flush that a reload itself fires — would write the whole map straight back. Called by
// lib/localWipe.ts, which is the only thing that ever wants this.
export function clearScrollMemory() {
  if (persistTimer != null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  positions.clear();
  window.removeEventListener('pagehide', persist);
}

// `active` lets a mounted-but-hidden caller skip restoring while hidden — LibraryPage keeps both
// panes mounted on mobile and toggles `display:none` on the inactive one, so its scroll state
// survives. A `display:none` element has no layout box, so setting `scrollTop` on it clamps to 0
// and loses the saved position; restoring belongs at the moment the pane becomes visible, which is
// when `active` flips true.
//
// None of the options below affect recording: the container always remembers where it is left.
export type ScrollRestore = 'stored' | 'top';

export interface ScrollMemoryOptions {
  /**
   * Where this mount opens: 'stored' at the remembered offset for `key`, 'top' at 0. Both write,
   * so a container reused across documents can't keep the previous one's offset. Read once per
   * key-mount, so it must only ever change together with `key`.
   */
  restore?: ScrollRestore;
  /** Don't write at all — the caller has its own target to scroll to. Read once, like `restore`. */
  skipRestore?: boolean;
  /** Hold the restore until the caller's async content has all landed. */
  readyToRestore?: boolean;
}

export function useScrollMemory<T extends HTMLElement>(
  key: string | null | undefined,
  active = true,
  { restore = 'stored', skipRestore = false, readyToRestore = true }: ScrollMemoryOptions = {}
) {
  const ref = useRef<T>(null);
  const readyRef = useRef(readyToRestore);
  const doRestoreRef = useRef<(() => void) | null>(null);
  // Whether the *current* streak of readiness has already been restored — a ref object rather
  // than a plain flag local to the lifecycle effect below, since a one-shot flag could succeed
  // once against stale content during a readyToRestore dip and then block the real restore once
  // fresh content actually loads. Reset on every key/active mount and on every dip to not-ready.
  const restoreStateRef = useRef<{ restored: boolean }>({ restored: false });
  // The last scrollTop this hook knows to be correct — set synchronously by its own restore writes
  // and by real `scroll` events, never by an ad hoc `el.scrollTop` read. Such a read forces a
  // synchronous layout, and on a Prev/Next the DOM is briefly a hybrid: the new sutta's header,
  // driven off the already-loaded corpus, swaps in a render before the body does, while the
  // previous sutta's segments are still rendered. If the two headers differ in height, that frame
  // is exactly the above-the-fold change the browser's CSS scroll anchoring compensates for, and
  // forcing layout during it would bake the anchoring nudge in as the settled position — corrupting
  // what gets persisted for the sutta being left.
  const lastKnownScrollTopRef = useRef(0);

  useLayoutEffect(() => {
    readyRef.current = readyToRestore;
    if (!readyToRestore) restoreStateRef.current.restored = false;
  }, [readyToRestore]);

  // Owns the container's whole mount lifecycle — attaching/detaching `onScroll` and persisting
  // the final position on unmount. Exposes the actual one-time restore as `doRestoreRef.current`
  // rather than performing it unconditionally here, so the effect below can trigger it once
  // `readyToRestore` actually arrives without needing to be part of this effect's own
  // teardown/re-run cycle.
  //
  // Keyed on [key, active] and deliberately not `readyToRestore`, even though that fluctuates
  // within one mount: the reader's segments go stale -> null -> new on every Prev/Next while the
  // scroll-memory `key` stays the same, so `readyToRestore` dips true -> false -> true just as the
  // container's content collapses to "Loading…". Tearing this effect down on that dip would
  // persist whatever scrollTop the collapse clamped to, so `readyRef` guards recording directly
  // instead.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || key == null || !active) return;
    restoreStateRef.current = { restored: false };
    const onScroll = () => {
      // Don't trust scrollTop while the caller says this container isn't in a real, final state
      // yet (see readyToRestore's own comment above) — a native 'scroll' event fires just as
      // readily for a collapse-driven clamp as for a real user scroll.
      if (!readyRef.current) return;
      lastKnownScrollTopRef.current = el.scrollTop;
      positions.set(key, el.scrollTop);
      schedulePersist();
    };
    el.addEventListener('scroll', onScroll, { passive: true });

    const restoreState = restoreStateRef.current;
    doRestoreRef.current = () => {
      if (restoreState.restored) return;
      restoreState.restored = true;
      if (skipRestore) return;
      const desired = restore === 'stored' ? positions.get(key) ?? 0 : 0;
      el.scrollTop = desired;
      lastKnownScrollTopRef.current = desired;
      // Record the restored offset, don't just scroll to it. A 'top' restore that only moved the
      // element would leave the previous visit's offset in the map, and a departure that runs no
      // unmount cleanup — a reload, or leaving for a non-SPA URL, where `pagehide` flushes the map
      // as it stands — would persist that stale offset and resume there next time.
      positions.set(key, desired);
      schedulePersist();
    };
    if (readyRef.current) doRestoreRef.current();

    return () => {
      // Same guard as onScroll's — a container mid-transition (readyToRestore false) that
      // unmounts or changes key shouldn't persist whatever transiently-collapsed scrollTop it
      // happens to have. Persists `lastKnownScrollTopRef` rather than reading `el.scrollTop` fresh
      // here — see that ref's own comment for why a fresh read at this exact moment isn't safe.
      if (readyRef.current) {
        positions.set(key, lastKnownScrollTopRef.current);
        schedulePersist();
      }
      el.removeEventListener('scroll', onScroll);
      doRestoreRef.current = null;
    };
  }, [key, active]);

  // Triggers the restore once `readyToRestore` actually arrives for the current key — the effect
  // above already calls it immediately if ready at mount time; this covers readiness landing
  // later (the common case: useSuttaText/UserDataContext still loading at mount). `key` is in
  // these deps too, not just `readyToRestore`, so a key change that lands while `readyToRestore`
  // stays continuously true (no intervening dip) still triggers a restore for the *new* mount,
  // rather than being skipped because the boolean itself never flipped.
  useLayoutEffect(() => {
    if (readyToRestore) doRestoreRef.current?.();
  }, [key, readyToRestore]);

  return ref;
}
