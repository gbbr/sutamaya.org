import { useCallback, useMemo } from 'react';
import { useUserData } from '../context/UserDataContext';
import { useSuttaText } from './useSuttaText';
import { useHighlightPopup } from './useHighlightPopup';
import { useScrollMemory, type ScrollRestore } from './useScrollMemory';
import { highlightColors } from '../lib/highlights';
import type { Highlight } from '../lib/types';
import { getUiScale } from '../lib/uiPrefs';
import { animateScrollBy, computeSegmentScrollOffset } from '../lib/segmentScroll';

const EMPTY_HIGHLIGHTS: Highlight[] = [];

/** Returns a sutta's reading state: its segments, highlights, selection popup and scroll handling. */
export function useSuttaReading<T extends HTMLElement = HTMLDivElement>(
  suttaId: string | undefined,
  // Namespaces the remembered scroll position, as `{prefix}:{suttaId}`.
  scrollKeyPrefix: string,
  { restore = 'stored', skipRestore = false }: { restore?: ScrollRestore; skipRestore?: boolean } = {}
) {
  const { highlights, ready: userDataReady } = useUserData();
  const { segments, error, retry } = useSuttaText(suttaId);
  // This sutta's highlights, stable across renders.
  const hlForSutta = useMemo(() => (suttaId && highlights[suttaId]) || EMPTY_HIGHLIGHTS, [suttaId, highlights]);
  const popup = useHighlightPopup(suttaId, hlForSutta);
  // The reading pane's scroll container, restored once the text and user data are both in.
  const scrollRef = useScrollMemory<T>(suttaId ? `${scrollKeyPrefix}:${suttaId}` : null, true, {
    restore,
    skipRestore,
    readyToRestore: !!segments && userDataReady,
  });
  const hlColors = useMemo(() => highlightColors(hlForSutta), [hlForSutta]);

  /** Scrolls one segment into view, or a named highlight within it. Stable across renders. */
  const scrollToSegment = useCallback((segIndex: number, block: ScrollLogicalPosition = 'start', highlightId?: string) => {
    const container = scrollRef.current;
    const segEl = container?.querySelector<HTMLElement>(`[data-seg="${segIndex}"]`);
    if (!container || !segEl) return;
    // The named highlight's span inside the segment, when the caller passed one.
    const hlEl = highlightId && Array.from(segEl.querySelectorAll<HTMLElement>('[data-hl-id]')).find((s) => s.dataset.hlId === highlightId);
    // What to scroll to: that span, else the segment's wrapper — the Pali and English lines together.
    const el = hlEl || segEl.parentElement || segEl;
    // Scroll offset, in the units scrollTop takes at the current UI scale.
    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const offset = computeSegmentScrollOffset(containerRect, elRect, block, getUiScale());

    animateScrollBy(container, offset);
  }, [scrollRef]);

  return { segments, error, retry, hlForSutta, hlCount: hlForSutta.length, hlColors, scrollRef, scrollToSegment, ...popup };
}
