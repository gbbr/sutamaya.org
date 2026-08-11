import { useCallback, useMemo } from 'react';
import { useUserData } from '../context/UserDataContext';
import { useSuttaText } from './useSuttaText';
import { useHighlightPopup } from './useHighlightPopup';
import { useScrollMemory, cancelPendingRestore } from './useScrollMemory';
import { groupHighlights, highlightCount } from '../lib/highlights';
import { getUiScale } from '../lib/uiPrefs';
import { computeSegmentScrollOffset } from '../lib/segmentScroll';

// The "load a sutta's reading state" boilerplate for ReaderPage (full-screen) — renders segments/
// highlights through SegmentedText and needs the selection-popup, scroll-restoration, and
// highlight-grouping plumbing around it. `scrollKeyPrefix` keeps the remembered scroll position
// namespaced (`reader:{id}`) per sutta.
// `hasDeepLinkTarget` — true when the caller (ReaderPage) already knows, from the route alone
// and before text has even loaded, that it's about to jump to one specific segment (a deep
// link/search hit for one inner sutta of a batched document — ReaderPage's `requestedSubUid`) —
// see useScrollMemory's `skipRestore` for why this needs to suppress its scroll-memory restore
// entirely up front rather than letting scrollToSegment try to override it after the fact.
export function useSuttaReading<T extends HTMLElement = HTMLDivElement>(
  suttaId: string | undefined,
  scrollKeyPrefix: string,
  hasDeepLinkTarget = false
) {
  const { highlights } = useUserData();
  const { segments, error, retry } = useSuttaText(suttaId);
  const hlForSutta = (suttaId && highlights[suttaId]) || [];
  const popup = useHighlightPopup(suttaId, hlForSutta, segments);
  const scrollRef = useScrollMemory<T>(suttaId ? `${scrollKeyPrefix}:${suttaId}` : null, true, hasDeepLinkTarget);
  const highlightGroups = useMemo(() => groupHighlights(hlForSutta), [hlForSutta]);
  const hlCount = useMemo(() => highlightCount(hlForSutta), [hlForSutta]);

  // useCallback (not a plain function, unlike this hook's other return values) since ReaderPage's
  // goToAdjacentWord wraps this in its own useCallback, which useReaderKeyboard's effect depends
  // on — without a stable reference here, that effect would tear down and re-attach its `window`
  // listener on every render. scrollRef is a plain useRef, so it never changes identity, which
  // means this callback itself now stays stable for the component's whole lifetime.
  const scrollToSegment = useCallback((segIndex: number, block: ScrollLogicalPosition = 'start', highlightId?: string) => {
    // 'start' rather than 'center' — a jump (TOC heading, highlight) reads as "go to this point
    // and read on from there", so the target belongs near the top of the reading pane with the
    // following text visible below it, not centered with half the context above it wasted.
    const container = scrollRef.current;
    const segEl = container?.querySelector<HTMLElement>(`[data-seg="${segIndex}"]`);
    if (!container || !segEl) return;
    // This is a deliberate jump to a specific segment — supersedes whatever scroll position
    // useScrollMemory's own restore was trying to reach for this container, including a
    // MutationObserver-based reapply that can otherwise still be armed and fire later (see
    // cancelPendingRestore's own comment), clobbering the jump below once it lands.
    cancelPendingRestore(container);
    // A highlight can cover only the tail of a long, multi-sentence segment (or start partway
    // through one) — centering the *segment's* whole box in that case leaves the actually-
    // highlighted text sitting well below the pane's true center, worse the further into the
    // segment the highlight starts. jumpToHighlight passes the highlight's own id (matches the
    // `data-hl-id` SegmentedText renders on its span — see that file) so this can center the
    // highlighted text itself instead; TOC/sub-uid jumps pass no id and just get the segment.
    const hlEl = highlightId && Array.from(segEl.querySelectorAll<HTMLElement>('[data-hl-id]')).find((s) => s.dataset.hlId === highlightId);
    const el = hlEl || segEl;
    // Computed by hand rather than via native scrollIntoView, for both alignments: this app
    // applies its Settings > UI scale via CSS `zoom` on <html> (lib/uiPrefs.ts, active even at
    // the default 1x on any Chromium desktop), and native scrollIntoView isn't zoom-aware. See
    // computeSegmentScrollOffset (lib/segmentScroll.ts) for the actual unit conversion, the same
    // fix already applied once in HighlightGutter/computeGutterLayout.
    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const offset = computeSegmentScrollOffset(containerRect, elRect, block, getUiScale());
    container.scrollBy({ top: offset, behavior: 'smooth' });
  }, [scrollRef]);

  return { segments, error, retry, hlForSutta, highlightGroups, hlCount, scrollRef, scrollToSegment, ...popup };
}
