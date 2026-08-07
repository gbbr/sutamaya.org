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

// Total number of merged highlights on a sutta (see groupHighlights), across every colour — for
// ListPane's and ReaderPage's single icon+count highlight indicator.
export function highlightCount(highlights: Highlight[]): number {
  return groupHighlights(highlights).length;
}

export function highlightGroupText(group: HighlightGroup, segments: SegmentFile[] | null): string {
  return group.items
    .map((h) => (segments?.[h.i]?.en || '').slice(h.s, h.e))
    .join(' ')
    .trim();
}
