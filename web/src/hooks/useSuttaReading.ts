import { useCallback, useLayoutEffect, useMemo } from 'react';
import { useUserData } from '../context/UserDataContext';
import { useSuttaText } from './useSuttaText';
import { useHighlightPopup } from './useHighlightPopup';
import { useScrollMemory, type ScrollRestore } from './useScrollMemory';
import { highlightColors, highlightStart } from '../lib/highlights';
import { segmentIndex } from '../lib/segmentKeys';
import type { Highlight } from '../lib/types';

/**
 * Options for scrolling to a segment.
 *
 * `animate: false` is for a scroll the reader is not travelling — landing in a sutta already part
 * way down it, where the journey from the top is not one they took.
 */
export interface ScrollToSegmentOptions {
  /** A highlight inside that segment to bring into view, rather than the segment itself. */
  highlightId?: string;
  /** Whether to ease there. Defaults to true. */
  animate?: boolean;
}
import { getUiScale } from '../lib/uiPrefs';
import { animateScrollBy, computeSegmentScrollOffset, jumpScrollBy } from '../lib/segmentScroll';

const EMPTY_HIGHLIGHTS: Highlight[] = [];

/** Returns a sutta's reading state: its segments, highlights, selection popup and scroll handling. */
export function useSuttaReading<T extends HTMLElement = HTMLDivElement>(
  suttaId: string | undefined,
  // Namespaces the remembered scroll position, as `{prefix}:{suttaId}`.
  scrollKeyPrefix: string,
  { restore = 'stored', skipRestore = false }: { restore?: ScrollRestore; skipRestore?: boolean } = {}
) {
  const { highlights, ready: userDataReady, anchorHighlights } = useUserData();
  const { segments, error, retry } = useSuttaText(suttaId);
  // Re-anchors any highlight addressed by segment position, this being the moment the device holds
  // both those positions and the text they name. A no-op for a sutta whose highlights are keyed,
  // which is every sutta once read. Before paint rather than after, so a converted highlight is
  // never briefly missing from a reading that has already drawn.
  useLayoutEffect(() => {
    if (suttaId && segments) anchorHighlights(suttaId, segments);
  }, [suttaId, segments, anchorHighlights]);
  // This sutta's highlights, stable across renders, and only those naming segments this copy of
  // the sutta has: one naming a segment it lacks is kept in the account but shown nowhere, rather
  // than drawn somewhere its reader never put it, and appears whole on a copy that has it.
  // One map per loaded text rather than one per highlight, this running again on every edit the
  // reader makes anywhere in their data.
  const segIndex = useMemo(() => (segments ? segmentIndex(segments) : null), [segments]);
  const hlForSutta = useMemo(() => {
    const all = (suttaId && highlights[suttaId]) || EMPTY_HIGHLIGHTS;
    if (!segments || !segIndex || !all.length) return all;
    const resolvable = all.filter((h) => highlightStart(h, segments, segIndex) !== null);
    return resolvable.length === all.length ? all : resolvable;
  }, [suttaId, highlights, segments, segIndex]);
  const popup = useHighlightPopup(suttaId, hlForSutta, segments);
  // The reading pane's scroll container, restored once the text and user data are both in.
  const scrollRef = useScrollMemory<T>(suttaId ? `${scrollKeyPrefix}:${suttaId}` : null, true, {
    restore,
    skipRestore,
    readyToRestore: !!segments && userDataReady,
  });
  const hlColors = useMemo(() => highlightColors(hlForSutta), [hlForSutta]);

  /** Scrolls one segment into view, or a named highlight within it. Stable across renders. */
  const scrollToSegment = useCallback((segIndex: number, block: ScrollLogicalPosition = 'start', opts: ScrollToSegmentOptions = {}) => {
    const { highlightId, animate = true } = opts;
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

    if (animate) animateScrollBy(container, offset);
    else jumpScrollBy(container, offset);
  }, [scrollRef]);

  return { segments, error, retry, hlForSutta, hlCount: hlForSutta.length, hlColors, scrollRef, scrollToSegment, ...popup };
}
