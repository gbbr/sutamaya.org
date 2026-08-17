import { describe, expect, it } from 'vitest';
import { groupHighlights, buildCrossSegmentRanges, displacedGroupIds, paintSegmentHighlights } from './highlights';
import type { Highlight } from './types';

function h(id: string, i: number, s: number, e: number, g: string, c = '#ffe08a', m = '2026-01-01T00:00:00.000Z|dev'): Highlight {
  return { id, i, s, e, c, g, m };
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

  // Two devices' overlapping groups now both survive, which interleaves them in document order —
  // a group is whatever shares a `g`, never a run of adjacent rows.
  it('keeps a cross-segment group whole when another group interleaves with it', () => {
    const groups = groupHighlights([h('a1', 0, 0, 10, 'g1'), h('b1', 0, 5, 15, 'g2'), h('a2', 1, 0, 4, 'g1')]);
    expect(groups).toHaveLength(2);
    expect(groups.find((x) => x.items[0].g === 'g1')?.items.map((x) => x.id)).toEqual(['a1', 'a2']);
  });
});

describe('displacedGroupIds', () => {
  it('names every group with a row overlapping the selection, once each', () => {
    const highlights = [h('a1', 0, 0, 10, 'g1'), h('a2', 1, 0, 10, 'g1'), h('b1', 0, 20, 30, 'g2')];
    expect(displacedGroupIds(highlights, [{ i: 0, s: 5, e: 25 }])).toEqual(['g1', 'g2']);
  });

  // A group is atomic: a selection touching one of its segments displaces all of them, so the
  // rest can't be left behind as a stranded remnant.
  it('names a group whose overlap is in one segment only', () => {
    const highlights = [h('a1', 0, 0, 10, 'g1'), h('a2', 1, 0, 10, 'g1')];
    expect(displacedGroupIds(highlights, [{ i: 1, s: 9, e: 12 }])).toEqual(['g1']);
  });

  it('names a group the selection fully contains, and one that fully contains the selection', () => {
    const inside = [h('a', 0, 5, 10, 'g1')];
    expect(displacedGroupIds(inside, [{ i: 0, s: 0, e: 15 }])).toEqual(['g1']);
    const around = [h('a', 0, 0, 20, 'g1')];
    expect(displacedGroupIds(around, [{ i: 0, s: 5, e: 10 }])).toEqual(['g1']);
  });

  it('ignores an edge-touching range and one in another segment', () => {
    const highlights = [h('a', 0, 0, 10, 'g1'), h('b', 1, 0, 10, 'g2')];
    expect(displacedGroupIds(highlights, [{ i: 0, s: 10, e: 20 }])).toEqual([]);
  });
});

describe('paintSegmentHighlights', () => {
  it('leaves non-overlapping highlights as they are, in document order', () => {
    const painted = paintSegmentHighlights([h('b', 0, 20, 30, 'g2'), h('a', 0, 0, 10, 'g1')]);
    expect(painted.map(({ s, e, src }) => [s, e, src.id])).toEqual([
      [0, 10, 'a'],
      [20, 30, 'b'],
    ]);
  });

  // The residue of immutable groups: two devices highlighting overlapping spans offline both
  // survive, and the later one takes the characters they contest.
  it('gives the contested characters to the group with the later mtime', () => {
    const older = h('a', 0, 0, 10, 'g1', '#ffe08a', '2026-01-01T00:00:00.000Z|dev');
    const newer = h('b', 0, 5, 15, 'g2', '#a8d8f0', '2026-01-02T00:00:00.000Z|dev');
    expect(paintSegmentHighlights([older, newer]).map(({ s, e, src }) => [s, e, src.id])).toEqual([
      [0, 5, 'a'],
      [5, 15, 'b'],
    ]);
  });

  it('resolves the same way whichever order the two groups arrive in', () => {
    const older = h('a', 0, 0, 10, 'g1', '#ffe08a', '2026-01-01T00:00:00.000Z|dev');
    const newer = h('b', 0, 5, 15, 'g2', '#a8d8f0', '2026-01-02T00:00:00.000Z|dev');
    expect(paintSegmentHighlights([newer, older])).toEqual(paintSegmentHighlights([older, newer]));
  });

  // Same millisecond on two devices — the groupId breaks the tie, so both devices paint it the
  // same way without having to talk to each other.
  it('breaks an mtime tie on groupId', () => {
    const m = '2026-01-01T00:00:00.000Z|dev';
    const a = h('a', 0, 0, 10, 'g1', '#ffe08a', m);
    const b = h('b', 0, 5, 15, 'g2', '#a8d8f0', m);
    expect(paintSegmentHighlights([b, a]).map(({ src }) => src.id)).toEqual(['a', 'b']);
  });

  // The loser keeps its own stored range on both pieces, so clicking either one still resolves to
  // the whole highlight (see SegmentedText's buildParts).
  it('splits an earlier group covered in the middle into two pieces', () => {
    const older = h('a', 0, 0, 20, 'g1', '#ffe08a', '2026-01-01T00:00:00.000Z|dev');
    const newer = h('b', 0, 5, 10, 'g2', '#a8d8f0', '2026-01-02T00:00:00.000Z|dev');
    expect(paintSegmentHighlights([older, newer]).map(({ s, e, src }) => [s, e, src.id, src.s, src.e])).toEqual([
      [0, 5, 'a', 0, 20],
      [5, 10, 'b', 5, 10],
      [10, 20, 'a', 0, 20],
    ]);
  });

  it('drops an earlier group entirely covered by a later one', () => {
    const older = h('a', 0, 5, 10, 'g1', '#ffe08a', '2026-01-01T00:00:00.000Z|dev');
    const newer = h('b', 0, 0, 20, 'g2', '#a8d8f0', '2026-01-02T00:00:00.000Z|dev');
    expect(paintSegmentHighlights([older, newer]).map(({ s, e, src }) => [s, e, src.id])).toEqual([[0, 20, 'b']]);
  });

  // Abutting slices the same highlight won must come back as one span, not several with seams.
  it('merges adjacent slices won by the same highlight', () => {
    const winner = h('a', 0, 0, 30, 'g1', '#ffe08a', '2026-01-03T00:00:00.000Z|dev');
    const loser1 = h('b', 0, 5, 10, 'g2', '#a8d8f0', '2026-01-01T00:00:00.000Z|dev');
    const loser2 = h('c', 0, 15, 20, 'g3', '#a8d8f0', '2026-01-02T00:00:00.000Z|dev');
    expect(paintSegmentHighlights([winner, loser1, loser2]).map(({ s, e, src }) => [s, e, src.id])).toEqual([[0, 30, 'a']]);
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
