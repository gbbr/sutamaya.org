import { describe, expect, it } from 'vitest';
import { groupHighlights } from './highlights';
import type { Highlight } from './types';
import type { SegmentFile } from './corpus';

function h(id: string, i: number, s: number, e: number, c = '#ffe08a'): Highlight {
  return { id, i, s, e, c };
}

// Segment lengths only matter for the boundary check groupHighlights does when `segments` is
// provided — text content itself is irrelevant here.
const segments: SegmentFile[] = [
  { key: '0', pali: '', en: 'x'.repeat(10) },
  { key: '1', pali: '', en: 'x'.repeat(8) },
  { key: '2', pali: '', en: 'x'.repeat(12) },
];

describe('groupHighlights', () => {
  it('keeps a single-segment highlight as its own group', () => {
    const groups = groupHighlights([h('a', 0, 2, 5)], segments);
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(1);
  });

  it('merges a true multi-segment selection (boundary-touching) into one group', () => {
    // Segment 0's highlight reaches its end (10), segment 1's starts at 0 — exactly what
    // useHighlightPopup's `pick` produces for one cross-segment selection.
    const groups = groupHighlights([h('a', 0, 4, 10), h('b', 1, 0, 8)], segments);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('keeps two independently-created, same-colour highlights in adjacent segments separate when segment text is known', () => {
    // Segment 0's highlight does NOT reach its end, so this is not one continuous selection.
    const groups = groupHighlights([h('a', 0, 2, 5), h('b', 1, 0, 3)], segments);
    expect(groups).toHaveLength(2);
  });

  it('merges any same-colour consecutive-segment run when segments are unknown (count-badge approximation)', () => {
    const groups = groupHighlights([h('a', 0, 2, 5), h('b', 1, 0, 3)], null);
    expect(groups).toHaveLength(1);
  });

  it('never merges different colours, even if adjacent and boundary-touching', () => {
    const groups = groupHighlights([h('a', 0, 4, 10, '#aabbcc'), h('b', 1, 0, 8, '#ffe08a')], segments);
    expect(groups).toHaveLength(2);
  });

  it('sorts out-of-order input before grouping', () => {
    const groups = groupHighlights([h('b', 1, 0, 8), h('a', 0, 4, 10)], segments);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((x) => x.id)).toEqual(['a', 'b']);
  });
});
