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

// Real user scroll input is the signal that gives up an in-progress restore for good (see
// doRestore below) — same set animateScrollTop (lib/segmentScroll.ts) treats as cancelling input.
const USER_INTENT_EVENTS = ['wheel', 'touchstart', 'pointerdown'] as const;

// Backstop so a restore that never quite reaches `desired` (no more content growth, no user
// input either) doesn't leave a MutationObserver running forever.
const RESTORE_GRACE_MS = 5000;

// `active` lets a caller that's mounted-but-hidden (e.g. LibraryPage keeps both TreePane and
// ListPane mounted on mobile, toggling `display:none` on the inactive one instead of
// unmounting it, so its React/scroll state survives the toggle) skip restoring scroll while
// hidden. A `display:none` element has no layout box (scrollHeight 0), so setting `scrollTop`
// on it just clamps to 0 and silently loses the saved position — restoring only needs to
// happen once the pane is actually visible again, which is exactly when `active` flips true.
//
// `restore` is where this mount starts. It only ever affects the restore-on-mount half: the
// *recording* (the `onScroll` listener/`positions` map below) runs the same under all three, so a
// container that starts somewhere unusual still remembers wherever the user leaves it.
//
//   'stored' — the remembered offset for `key` (the default, and what a library pane always wants).
//   'top'    — the top, ignoring what's remembered, for a document the user chose to open now
//              rather than returned to (see lib/entryKind.ts and ReaderPage). Still *writes* 0,
//              which the reader depends on: its scroll container isn't remounted between suttas,
//              so without that write a Prev/Next would leave the new sutta sitting at the previous
//              one's offset.
//   'none'   — no scroll write at all, for a caller that already knows, before this even mounts,
//              that it has its own deliberate target (useSuttaReading passes this whenever
//              ReaderPage has a `requestedSubUid` — a deep link/search hit for one specific verse
//              inside a batched document). Writing first and letting the caller's jump override
//              the result isn't reliable: see scrollToSegment, and cancelPendingRestore's own
//              comment on iOS stacking two scroll writes milliseconds apart instead of superseding.
//
// Read once per key-mount, so it must only ever change together with `key` — it does: the reader
// derives it per sutta id, which is what the key is built from.
//
// `readyToRestore` lets a caller with more than one async content source feeding this container
// (the reader's sutta text and its separately-fetched notes/highlight/chip data — see
// useSuttaReading) defer the restore until both have landed, instead of restoring against the
// first one and getting shifted once the second lands (including via the browser's own CSS
// scroll-anchoring compensating for content inserted above the current position). Defaults to
// `true` so TreePane/ListPane, which have no second source, restore immediately as before.
//
// Not a dependency of the lifecycle effect below, even though it fluctuates within one mount:
// the reader's segments go stale -> null -> new on every Prev/Next while the scroll-memory `key`
// stays the same, so `readyToRestore` dips true -> false -> true right as this container's
// content transiently collapses (SegmentedText -> "Loading…"). Tearing the effect down on that
// dip would persist whatever scrollTop the collapse clamped to; `readyRef` below guards recording
// directly instead, so the effect's own mount lifecycle can stay keyed on [key, active] alone.
export type ScrollRestore = 'stored' | 'top' | 'none';

export interface ScrollMemoryOptions {
  restore?: ScrollRestore;
  readyToRestore?: boolean;
}

export function useScrollMemory<T extends HTMLElement>(
  key: string | null | undefined,
  active = true,
  { restore = 'stored', readyToRestore = true }: ScrollMemoryOptions = {}
) {
  const ref = useRef<T>(null);
  const readyRef = useRef(readyToRestore);
  const doRestoreRef = useRef<(() => void) | null>(null);
  // Whether the *current* streak of readiness has already been restored — a ref object rather
  // than a plain flag local to the lifecycle effect below, since a one-shot flag could succeed
  // once against stale content during a readyToRestore dip and then block the real restore once
  // fresh content actually loads. Reset on every key/active mount and on every dip to not-ready.
  const restoreStateRef = useRef<{ restored: boolean }>({ restored: false });
  // The last scrollTop this hook itself actually knows to be correct — set synchronously by our
  // own restore writes and by real `scroll` events, never by an ad hoc `el.scrollTop` read. A read
  // forces a synchronous layout, and on a Prev/Next the DOM can briefly be a hybrid of the new
  // sutta's header (title/blurb — driven straight off the already-loaded corpus, so it swaps in a
  // render before the body does) over the *previous* sutta's still-rendered body (segments only
  // clear once useSuttaText's own effect runs). If the two headers differ in height, that hybrid
  // frame is exactly the kind of above-the-fold content change the browser's own CSS scroll
  // anchoring compensates for — and forcing layout via a raw `el.scrollTop` read during that
  // window (as unmount/teardown below used to) bakes the anchoring nudge in as if it were the
  // real, settled position, corrupting what gets persisted for the sutta being left.
  const lastKnownScrollTopRef = useRef(0);

  useLayoutEffect(() => {
    readyRef.current = readyToRestore;
    if (!readyToRestore) restoreStateRef.current.restored = false;
  }, [readyToRestore]);

  // Owns the container's whole mount lifecycle — attaching/detaching `onScroll` and persisting
  // the final position on unmount — keyed only on [key, active], deliberately not
  // `readyToRestore` (see its own comment above for why). Exposes the actual one-time restore as
  // `doRestoreRef.current` rather than performing it unconditionally here, so the effect below
  // can trigger it once `readyToRestore` actually arrives without needing to be part of this
  // effect's own teardown/re-run cycle.
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

    let stop: (() => void) | null = null;
    const restoreState = restoreStateRef.current;
    doRestoreRef.current = () => {
      if (restoreState.restored) return;
      restoreState.restored = true;
      const desired = restore === 'stored' ? positions.get(key) ?? 0 : 0;
      if (restore !== 'none') {
        el.scrollTop = desired;
        lastKnownScrollTopRef.current = desired;
      }

      // `el` itself doesn't resize when its content grows after this point (it's a
      // flex/viewport-bound scroll container, so its own box stays fixed — only scrollHeight,
      // the overflowing content inside it, grows), which is why this needs a MutationObserver on
      // the subtree rather than a ResizeObserver on `el`. Stays armed rather than disconnecting
      // after its first correction, so it can also catch the browser's own CSS scroll-anchoring
      // compensating for any further, unanticipated content shift as an ordinary scrollTop
      // change away from `desired`. Only real user scroll input (or an explicit
      // cancelPendingRestore — see its own comment) gives up this restore for good; a bare
      // timeout is just the last-resort backstop.
      if (desired > 0) {
        // A prior restore within this same key-mount (readyToRestore can dip and recover more
        // than once — see this hook's own comment above) may still have its own MutationObserver/
        // timer/listeners armed; without disconnecting it first, reassigning `stop` below orphans
        // it running for up to RESTORE_GRACE_MS, fighting this new one over the same `el`.
        stop?.();
        const mo = new MutationObserver(() => {
          if (el.scrollTop !== desired && el.scrollHeight - el.clientHeight >= desired) {
            el.scrollTop = desired;
            lastKnownScrollTopRef.current = desired;
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
      stop?.();
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
