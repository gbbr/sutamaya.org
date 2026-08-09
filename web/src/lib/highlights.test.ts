import { describe, expect, it } from 'vitest';
import { groupHighlights, buildCrossSegmentRanges } from './highlights';
import type { Highlight } from './types';

function h(id: string, i: number, s: number, e: number, g: string, c = '#ffe08a'): Highlight {
  return { id, i, s, e, c, g };
}

describe('groupHighlights', () => {
  it('keeps a single-segment highlight as its own group', () => {
    const groups = groupHighlights([h('a', 0, 2, 5, 'g1')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(1);
  });

  it('merges every doc sharing a groupId into one group, regardless of offsets', () => {
    // Same shape useHighlightPopup's `pick` produces for one cross-segment selection: every
    // range written by that call shares the server-assigned `g`.
    const groups = groupHighlights([h('a', 0, 4, 10, 'g1'), h('b', 1, 0, 8, 'g1')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('keeps two independently-created highlights in adjacent segments separate when their groupIds differ', () => {
    const groups = groupHighlights([h('a', 0, 2, 5, 'g1'), h('b', 1, 0, 3, 'g2')]);
    expect(groups).toHaveLength(2);
  });

  it('sorts out-of-order input before grouping', () => {
    const groups = groupHighlights([h('b', 1, 0, 8, 'g1'), h('a', 0, 4, 10, 'g1')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('buildCrossSegmentRanges', () => {
  it('gives the tail of the first segment, the full length of a middle one, and the head of the last', () => {
    const ranges = buildCrossSegmentRanges(
      [
        { i: 0, fullLen: 10 },
        { i: 1, fullLen: 9 },
        { i: 2, fullLen: 10 },
      ],
      6,
      5
    );
    expect(ranges).toEqual([
      { i: 0, s: 6, e: 10 },
      { i: 1, s: 0, e: 9 },
      { i: 2, s: 0, e: 5 },
    ]);
  });

  it('handles exactly two segments (no middle segment)', () => {
    const ranges = buildCrossSegmentRanges(
      [
        { i: 0, fullLen: 5 },
        { i: 1, fullLen: 4 },
      ],
      2,
      2
    );
    expect(ranges).toEqual([
      { i: 0, s: 2, e: 5 },
      { i: 1, s: 0, e: 2 },
    ]);
  });

  it('drops a segment whose computed range is empty (edge-aligned selection)', () => {
    const ranges = buildCrossSegmentRanges(
      [
        { i: 0, fullLen: 5 },
        { i: 1, fullLen: 4 },
      ],
      0,
      0
    );
    expect(ranges).toEqual([{ i: 0, s: 0, e: 5 }]);
  });

  it('uses each segment\'s own fullLen, not a shared one, for middle segments', () => {
    const ranges = buildCrossSegmentRanges(
      [
        { i: 0, fullLen: 3 },
        { i: 1, fullLen: 20 },
        { i: 2, fullLen: 7 },
        { i: 3, fullLen: 1 },
      ],
      0,
      1
    );
    expect(ranges).toEqual([
      { i: 0, s: 0, e: 3 },
      { i: 1, s: 0, e: 20 },
      { i: 2, s: 0, e: 7 },
      { i: 3, s: 0, e: 1 },
    ]);
  });
});
