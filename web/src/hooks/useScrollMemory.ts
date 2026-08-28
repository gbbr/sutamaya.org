import { useLayoutEffect, useRef } from 'react';
import { animateScrollTop } from '../lib/segmentScroll';
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

// Cancels this hook's MutationObserver-based restore for one element, so a stale remembered
// position can't overwrite a deliberate scroll later. Keyed by element rather than by the hook's
// `key` string, since a caller has only the DOM node to hand.
const pendingRestoreCancel = new WeakMap<HTMLElement, () => void>();

export function cancelPendingRestore(el: HTMLElement | null | undefined) {
  if (!el) return;
  pendingRestoreCancel.get(el)?.();
  pendingRestoreCancel.delete(el);
}

// Every deliberate scroll of a scroll-memory container goes through these rather than calling
// animateScrollTop itself. Giving up the armed restore is part of what moving one of these panes
// means — the restore is driven by a MutationObserver that can still fire well after the jump has
// landed, putting the pane back where the reader last left it — and leaving that to each caller to
// remember is how a jump silently loses to a restore that arrives a moment later.
export function scrollPaneTo(el: HTMLElement, top: number) {
  cancelPendingRestore(el);
  animateScrollTop(el, top);
}

// `offset` is in scroll units rather than screen pixels: under Settings > UI scale the two differ,
// and computeSegmentScrollOffset (lib/segmentScroll.ts) is what converts between them.
export function scrollPaneBy(el: HTMLElement, offset: number) {
  scrollPaneTo(el, el.scrollTop + offset);
}

// Real user scroll input is the signal that gives up an in-progress restore for good (see
// doRestore below) — same set animateScrollTop (lib/segmentScroll.ts) treats as cancelling input.
const USER_INTENT_EVENTS = ['wheel', 'touchstart', 'pointerdown'] as const;

// Backstop so a restore that never quite reaches `desired` (no more content growth, no user
// input either) doesn't leave a MutationObserver running forever.
const RESTORE_GRACE_MS = 5000;

// `active` lets a mounted-but-hidden caller skip restoring while hidden — LibraryPage keeps both
// panes mounted on mobile and toggles `display:none` on the inactive one, so its scroll state
// survives. A `display:none` element has no layout box, so setting `scrollTop` on it clamps to 0
// and loses the saved position; restoring belongs at the moment the pane becomes visible, which is
// when `active` flips true.
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
// `readyToRestore` lets a caller with more than one async content source feeding this container —
// the reader's sutta text and its separately-fetched notes and chip data — defer the restore until
// both have landed, rather than restoring against the first and being shifted when the second
// arrives, including by CSS scroll anchoring compensating for content inserted above. Defaults to
// `true`, so TreePane and ListPane, which have no second source, restore immediately.
//
// Not a dependency of the lifecycle effect below, even though it fluctuates within one mount: the
// reader's segments go stale -> null -> new on every Prev/Next while the scroll-memory `key` stays
// the same, so `readyToRestore` dips true -> false -> true just as the container's content
// collapses to "Loading…". Tearing the effect down on that dip would persist whatever scrollTop the
// collapse clamped to, so `readyRef` below guards recording directly and the effect's mount
// lifecycle stays keyed on [key, active] alone.
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
