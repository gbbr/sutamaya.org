import { useCallback, useMemo } from 'react';
import { useUserData } from '../context/UserDataContext';
import { useSuttaText } from './useSuttaText';
import { useHighlightPopup } from './useHighlightPopup';
import { useScrollMemory } from './useScrollMemory';
import { groupHighlights, highlightCount } from '../lib/highlights';

// The "load a sutta's reading state" boilerplate for ReaderPage (full-screen) — renders segments/
// highlights through SegmentedText and needs the selection-popup, scroll-restoration, and
// highlight-grouping plumbing around it. `scrollKeyPrefix` keeps the remembered scroll position
// namespaced (`reader:{id}`) per sutta.
export function useSuttaReading<T extends HTMLElement = HTMLDivElement>(suttaId: string | undefined, scrollKeyPrefix: string) {
  const { highlights } = useUserData();
  const { segments, error, retry } = useSuttaText(suttaId);
  const hlForSutta = (suttaId && highlights[suttaId]) || [];
  const popup = useHighlightPopup(suttaId, hlForSutta, segments);
  const scrollRef = useScrollMemory<T>(suttaId ? `${scrollKeyPrefix}:${suttaId}` : null);
  const highlightGroups = useMemo(() => groupHighlights(hlForSutta), [hlForSutta]);
  const hlCount = useMemo(() => highlightCount(hlForSutta), [hlForSutta]);

  // useCallback (not a plain function, unlike this hook's other return values) since ReaderPage's
  // goToAdjacentWord wraps this in its own useCallback, which useReaderKeyboard's effect depends
  // on — without a stable reference here, that effect would tear down and re-attach its `window`
  // listener on every render. scrollRef is a plain useRef, so it never changes identity, which
  // means this callback itself now stays stable for the component's whole lifetime.
  const scrollToSegment = useCallback((segIndex: number, block: ScrollLogicalPosition = 'start') => {
    // 'start' rather than 'center' — a jump (TOC heading, highlight) reads as "go to this point
    // and read on from there", so the target belongs near the top of the reading pane with the
    // following text visible below it, not centered with half the context above it wasted.
    const container = scrollRef.current;
    const el = container?.querySelector(`[data-seg="${segIndex}"]`);
    if (!container || !el) return;
    if (block === 'start') {
      // Plain scrollIntoView({block:'start'}) lands the target flush against the pane's edge —
      // nudge it down by a small margin so it isn't butted right up against the top. Computed as
      // a one-off pixel delta (not CSS scroll-margin-top on the segment) so it only affects this
      // 'start' case and doesn't skew the 'center' case below (jumpToHighlight's word/segment
      // centering), which needs the element's true geometric center, not one padded on one side.
      const START_MARGIN = 24;
      const offset = el.getBoundingClientRect().top - container.getBoundingClientRect().top - START_MARGIN;
      container.scrollBy({ top: offset, behavior: 'smooth' });
    } else {
      el.scrollIntoView({ behavior: 'smooth', block });
    }
  }, [scrollRef]);

  return { segments, error, retry, hlForSutta, highlightGroups, hlCount, scrollRef, scrollToSegment, ...popup };
}
