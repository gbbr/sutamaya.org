import type { SegmentFile } from './corpus';
import type { Highlight } from './types';

export interface HighlightGroup {
  key: string;
  c: string;
  i: number;
  items: Highlight[];
}

// A cross-segment highlight is stored as one Highlight document per segment (see
// useHighlightPopup's `pick`), all sharing the same `g` (groupId, assigned server-side by the
// PUT /highlights/ranges call that wrote them) — recombine by that field rather than inferring
// adjacency from segment/offset position.
export function groupHighlights(highlights: Highlight[]): HighlightGroup[] {
  const sorted = [...highlights].sort((a, b) => a.i - b.i || a.s - b.s);
  const groups: Highlight[][] = [];
  for (const h of sorted) {
    const prevGroup = groups[groups.length - 1];
    const prev = prevGroup?.[prevGroup.length - 1];
    if (prev && h.g === prev.g) prevGroup.push(h);
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
  const groups = groupHighlights(highlights);
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
