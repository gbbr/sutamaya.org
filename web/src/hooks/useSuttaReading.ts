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
  // goToAdjacentWord wraps this in its own useCallback, which its keydown effect depends on —
  // without a stable reference here, that effect would tear down and re-attach its `window`
  // listener on every render. scrollRef is a plain useRef, so it never changes identity, which
  // means this callback itself now stays stable for the component's whole lifetime.
  const scrollToSegment = useCallback((segIndex: number, block: ScrollLogicalPosition = 'start') => {
    // 'start' rather than 'center' — a jump (TOC heading, highlight) reads as "go to this point
    // and read on from there", so the target belongs near the top of the reading pane with the
    // following text visible below it, not centered with half the context above it wasted.
    scrollRef.current?.querySelector(`[data-seg="${segIndex}"]`)?.scrollIntoView({ behavior: 'smooth', block });
  }, [scrollRef]);

  return { segments, error, retry, hlForSutta, highlightGroups, hlCount, scrollRef, scrollToSegment, ...popup };
}
