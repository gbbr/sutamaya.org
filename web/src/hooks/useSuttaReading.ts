import { useMemo } from 'react';
import { useUserData } from '../context/UserDataContext';
import { useSuttaText } from './useSuttaText';
import { useHighlightPopup } from './useHighlightPopup';
import { useScrollMemory } from './useScrollMemory';
import { groupHighlights, highlightCountsByColor } from '../lib/highlights';

// The "load a sutta's reading state" boilerplate shared by ReaderPage (full-screen) and
// PreviewPane (desktop split view) — both render the same segments/highlights through
// SegmentedText and need the same selection-popup, scroll-restoration, and highlight-grouping
// plumbing around it. `scrollKeyPrefix` keeps each surface's remembered scroll position
// separate (`reader:{id}` vs `preview:{id}`) even for the same sutta.
export function useSuttaReading<T extends HTMLElement = HTMLDivElement>(suttaId: string | undefined, scrollKeyPrefix: string) {
  const { highlights } = useUserData();
  const segments = useSuttaText(suttaId);
  const hlForSutta = (suttaId && highlights[suttaId]) || [];
  const popup = useHighlightPopup(suttaId, hlForSutta, segments);
  const scrollRef = useScrollMemory<T>(suttaId ? `${scrollKeyPrefix}:${suttaId}` : null);
  const highlightGroups = useMemo(() => groupHighlights(hlForSutta, segments), [hlForSutta, segments]);
  const hlCounts = useMemo(() => highlightCountsByColor(hlForSutta), [hlForSutta]);

  function scrollToSegment(segIndex: number) {
    // 'start' rather than 'center' — a jump (TOC heading, highlight) reads as "go to this point
    // and read on from there", so the target belongs near the top of the reading pane with the
    // following text visible below it, not centered with half the context above it wasted.
    scrollRef.current?.querySelector(`[data-seg="${segIndex}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return { segments, hlForSutta, highlightGroups, hlCounts, scrollRef, scrollToSegment, ...popup };
}
