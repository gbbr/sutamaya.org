import { useCallback, useMemo } from 'react';
import { useUserData } from '../context/UserDataContext';
import { useSuttaText } from './useSuttaText';
import { useHighlightPopup } from './useHighlightPopup';
import { useScrollMemory, scrollPaneBy, type ScrollRestore } from './useScrollMemory';
import { groupHighlights, highlightColors, highlightCount } from '../lib/highlights';
import { getUiScale } from '../lib/uiPrefs';
import { computeSegmentScrollOffset } from '../lib/segmentScroll';

// A sutta's reading state for ReaderPage: the segments and highlights SegmentedText renders, plus
// the selection-popup, scroll-restoration and highlight-grouping plumbing around them.
// `scrollKeyPrefix` namespaces the remembered scroll position per sutta (`reader:{id}`).
// `restore` — where this sutta opens, passed straight through to useScrollMemory (see its own
// comment for the three values). ReaderPage decides: 'none' when the route alone already names a
// segment to jump to, 'top' for a sutta opened fresh, 'stored' for one returned to.
export function useSuttaReading<T extends HTMLElement = HTMLDivElement>(
  suttaId: string | undefined,
  scrollKeyPrefix: string,
  restore: ScrollRestore = 'stored'
) {
  const { highlights, ready: userDataReady } = useUserData();
  const { segments, error, retry } = useSuttaText(suttaId);
  const hlForSutta = (suttaId && highlights[suttaId]) || [];
  const popup = useHighlightPopup(suttaId, hlForSutta, segments);
  // The chips above the text come from UserDataContext's separately-timed fetch, so waiting for
  // both this and `segments` before touching scrollTop is what lets useScrollMemory restore once
  // and correctly, rather than correcting for whichever of the two lands second.
  const scrollRef = useScrollMemory<T>(suttaId ? `${scrollKeyPrefix}:${suttaId}` : null, true, {
    restore,
    readyToRestore: !!segments && userDataReady,
  });
  const highlightGroups = useMemo(() => groupHighlights(hlForSutta), [hlForSutta]);
  const hlCount = useMemo(() => highlightCount(hlForSutta), [hlForSutta]);
  const hlColors = useMemo(() => highlightColors(hlForSutta), [hlForSutta]);

  // useCallback, unlike this hook's other return values, because ReaderPage's goToAdjacentWord
  // wraps it in its own useCallback, which useReaderKeyboard's effect depends on: without a stable
  // reference that effect would re-attach its `window` listener on every render. scrollRef is a
  // plain useRef and never changes identity, so this stays stable for the component's lifetime.
  const scrollToSegment = useCallback((segIndex: number, block: ScrollLogicalPosition = 'start', highlightId?: string) => {
    // 'start' rather than 'center': a jump to a heading or highlight means "go to this point and
    // read on", so the target belongs near the top of the pane with the text that follows visible.
    const container = scrollRef.current;
    const segEl = container?.querySelector<HTMLElement>(`[data-seg="${segIndex}"]`);
    if (!container || !segEl) return;
    // A highlight can cover only the tail of a long segment, where centring the segment's whole box
    // leaves the highlighted text well below the pane's centre. jumpToHighlight passes the
    // highlight's id — the `data-hl-id` SegmentedText renders on its span — so this centres the
    // highlighted text itself; TOC and sub-uid jumps pass no id and get the segment.
    const hlEl = highlightId && Array.from(segEl.querySelectorAll<HTMLElement>('[data-hl-id]')).find((s) => s.dataset.hlId === highlightId);
    const el = hlEl || segEl;
    // Computed by hand rather than through native scrollIntoView, for both alignments: this app
    // applies Settings > UI scale via CSS `zoom` on <html> (lib/uiPrefs.ts, active even at the
    // default 1x on Chromium desktop), and scrollIntoView isn't zoom-aware. computeSegmentScrollOffset
    // (lib/segmentScroll.ts) does the unit conversion, as computeGutterLayout does for the gutter.
    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const offset = computeSegmentScrollOffset(containerRect, elRect, block, getUiScale());

    scrollPaneBy(container, offset);
  }, [scrollRef]);

  return { segments, error, retry, hlForSutta, highlightGroups, hlCount, hlColors, scrollRef, scrollToSegment, ...popup };
}
