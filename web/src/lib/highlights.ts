import type { SegmentFile } from './corpus';
import type { Highlight } from './types';

export interface HighlightGroup {
  key: string;
  c: string;
  i: number;
  items: Highlight[];
}

// A cross-segment highlight is stored as one Highlight document per segment (see
// useHighlightPopup's `pick`), so recombine runs of same-colour, consecutive-segment highlights
// where each non-last item reaches the end of its segment and each non-first item starts at 0 —
// the same shape useHighlightPopup produces for a single multi-segment selection, and visually
// indistinguishable from one in the reader either way. Without segment text (e.g. a list row
// counting highlights for a sutta whose full text isn't loaded), that boundary check is skipped
// and any same-colour, consecutive-segment run is treated as one highlight — a good enough
// approximation for a count badge.
export function groupHighlights(highlights: Highlight[], segments: SegmentFile[] | null): HighlightGroup[] {
  const sorted = [...highlights].sort((a, b) => a.i - b.i || a.s - b.s);
  const groups: Highlight[][] = [];
  for (const h of sorted) {
    const prevGroup = groups[groups.length - 1];
    const prev = prevGroup?.[prevGroup.length - 1];
    const adjacent = !!prev && h.i === prev.i + 1 && h.c === prev.c;
    const boundaryOk = prev && segments ? prev.e === (segments[prev.i]?.en.length ?? -1) && h.s === 0 : true;
    if (adjacent && boundaryOk) prevGroup.push(h);
    else groups.push([h]);
  }
  return groups.map((items) => ({ key: items[0].id, c: items[0].c, i: items[0].i, items }));
}

export interface HighlightColorCount {
  c: string;
  count: number;
}

// One badge per distinct colour used on a sutta, each counting that colour's merged highlights
// (see groupHighlights) — for ListPane's per-row highlight-count indicator.
export function highlightCountsByColor(highlights: Highlight[]): HighlightColorCount[] {
  const groups = groupHighlights(highlights, null);
  const byColor = new Map<string, number>();
  for (const g of groups) byColor.set(g.c, (byColor.get(g.c) ?? 0) + 1);
  return [...byColor.entries()].map(([c, count]) => ({ c, count }));
}

export function highlightGroupText(group: HighlightGroup, segments: SegmentFile[] | null): string {
  return group.items
    .map((h) => (segments?.[h.i]?.en || '').slice(h.s, h.e))
    .join(' ')
    .trim();
}
