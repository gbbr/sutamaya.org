import { useMemo } from 'react';
import { useUserData } from '../context/UserDataContext';
import { useSuttaText } from './useSuttaText';
import { useHighlightPopup } from './useHighlightPopup';
import { useScrollMemory } from './useScrollMemory';
import { groupHighlights, highlightCountsByColor } from '../lib/highlights';

// The "load a sutta's reading state" boilerplate for ReaderPage (full-screen) — renders segments/
// highlights through SegmentedText and needs the selection-popup, scroll-restoration, and
// highlight-grouping plumbing around it. `scrollKeyPrefix` keeps the remembered scroll position
// namespaced (`reader:{id}`) per sutta.
export function useSuttaReading<T extends HTMLElement = HTMLDivElement>(suttaId: string | undefined, scrollKeyPrefix: string) {
  const { highlights } = useUserData();
  const segments = useSuttaText(suttaId);
  const hlForSutta = (suttaId && highlights[suttaId]) || [];
  const popup = useHighlightPopup(suttaId, hlForSutta, segments);
  const scrollRef = useScrollMemory<T>(suttaId ? `${scrollKeyPrefix}:${suttaId}` : null);
  const highlightGroups = useMemo(() => groupHighlights(hlForSutta), [hlForSutta]);
  const hlCounts = useMemo(() => highlightCountsByColor(hlForSutta), [hlForSutta]);

  function scrollToSegment(segIndex: number, block?: string = 'start') {
    // 'start' rather than 'center' — a jump (TOC heading, highlight) reads as "go to this point
    // and read on from there", so the target belongs near the top of the reading pane with the
    // following text visible below it, not centered with half the context above it wasted.
    scrollRef.current?.querySelector(`[data-seg="${segIndex}"]`)?.scrollIntoView({ behavior: 'smooth', block });
  }

  return { segments, hlForSutta, highlightGroups, hlCounts, scrollRef, scrollToSegment, ...popup };
}
