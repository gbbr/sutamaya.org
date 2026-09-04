import { useLayoutEffect, useRef } from 'react';
import { SCROLL_POSITIONS_KEY } from '../lib/storageKeys';

// Remembers where each scrolling container was left, by key.
//
// The map is module-level, so a position survives an unmount within the session, and persisted to
// localStorage, so it survives a full app close — which is what lets "/" restore the last screen's
// exact offset. Writes are debounced and flushed on `pagehide`. Like every other localStorage key
// here it is shared across tabs, so two tabs on different suttas clobber each other on close.
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

// Debounces the write, so a fling doesn't put a synchronous storage write on every scroll tick.
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

// Forgets the offset remembered for `key`, so a container keyed on it opens at the top. For a key
// whose content is replaced rather than revisited — a search's results, once the query changes.
export function forgetScrollPosition(key: string) {
  positions.delete(key);
  schedulePersist();
}

// Empties the remembered positions, in memory as well as in storage — clearing localStorage alone
// would let the pending debounce, or the `pagehide` flush, write the map straight back.
export function clearScrollMemory() {
  if (persistTimer != null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  positions.clear();
  window.removeEventListener('pagehide', persist);
}

// Where a mount opens. None of the options affect recording: a container always remembers where it
// is left.
export type ScrollRestore = 'stored' | 'top';

export interface ScrollMemoryOptions {
  /**
   * Where this mount opens: 'stored' at the remembered offset for `key`, 'top' at 0. Both write,
   * so a container reused across documents can't keep the previous one's offset. Read once per
   * key-mount, so it must change only together with `key`.
   */
  restore?: ScrollRestore;
  /** Don't write at all — the caller has its own target to scroll to. Read once, like `restore`. */
  skipRestore?: boolean;
  /** Hold the restore until the caller's async content has all landed. */
  readyToRestore?: boolean;
}

// Returns a ref for a scrolling container that records its offset under `key` and restores it on
// the next mount. `active` is false for a mounted-but-hidden container — a `display:none` element
// has no layout box, so a restore there would clamp to 0 — and the restore runs when it flips true.
export function useScrollMemory<T extends HTMLElement>(
  key: string | null | undefined,
  active = true,
  { restore = 'stored', skipRestore = false, readyToRestore = true }: ScrollMemoryOptions = {}
) {
  const ref = useRef<T>(null);
  const readyRef = useRef(readyToRestore);
  const doRestoreRef = useRef<(() => void) | null>(null);
  // Whether the current streak of readiness has been restored. Reset on every key/active mount and
  // on every dip to not-ready, so a restore against stale content can't block the real one.
  const restoreStateRef = useRef<{ restored: boolean }>({ restored: false });
  // The last scrollTop known to be correct, set by this hook's own restore writes and by real
  // `scroll` events. Never by an ad hoc `el.scrollTop` read, which forces a synchronous layout and
  // mid-transition would bake in the browser's scroll-anchoring nudge.
  const lastKnownScrollTopRef = useRef(0);

  useLayoutEffect(() => {
    readyRef.current = readyToRestore;
    if (!readyToRestore) restoreStateRef.current.restored = false;
  }, [readyToRestore]);

  // Owns the container's mount lifecycle: the `scroll` listener, the persist on unmount, and the
  // one-time restore, which it exposes as `doRestoreRef.current` for the effect below to trigger
  // when readiness lands later. Keyed on [key, active] and never on `readyToRestore`, which dips
  // within one mount as content reloads and would persist the collapsed scrollTop.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || key == null || !active) return;
    restoreStateRef.current = { restored: false };
    const onScroll = () => {
      // scrollTop isn't trustworthy while the content is still settling: a 'scroll' event fires
      // for a collapse-driven clamp as readily as for a real scroll.
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
      // The restored offset is recorded, not merely scrolled to: a departure running no unmount
      // cleanup — a reload, where `pagehide` flushes the map as it stands — would otherwise
      // persist the previous visit's offset.
      positions.set(key, desired);
      schedulePersist();
    };
    if (readyRef.current) doRestoreRef.current();

    return () => {
      // The same guard as onScroll's, and the same last-known offset rather than a fresh
      // `el.scrollTop` read.
      if (readyRef.current) {
        positions.set(key, lastKnownScrollTopRef.current);
        schedulePersist();
      }
      el.removeEventListener('scroll', onScroll);
      doRestoreRef.current = null;
    };
  }, [key, active]);

  // Triggers the restore when readiness lands after mount, which is the common case. `key` is a
  // dependency too, so a key change while readiness stays true still restores.
  useLayoutEffect(() => {
    if (readyToRestore) doRestoreRef.current?.();
  }, [key, readyToRestore]);

  return ref;
}
