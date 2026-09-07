import { describe, expect, it } from 'vitest';
import {
  displacedIds,
  expandHighlights,
  highlightColors,
  highlightRanges,
  highlightStart,
  highlightText,
  paintSegmentRanges,
  spansOverlap,
  type HlSpan,
} from './highlights';
import { HIGHLIGHT_COLORS } from './theme';
import type { SegmentFile } from './corpus';
import type { Highlight } from './types';

// The key `segs` gives the segment at position `i`, so these tests go on being written in the
// positions they read most clearly in while the code under test sees only keys.
const key = (i: number) => `sn1.1:${i}`;

function h(
  id: string,
  i0: number,
  o0: number,
  i1: number,
  o1: number,
  c = '#ffe08a',
  m = '2026-01-01T00:00:00.000Z|dev'
): Highlight {
  return { id, k0: key(i0), o0, k1: key(i1), o1, c, m };
}

function span(i0: number, o0: number, i1: number, o1: number): HlSpan {
  return { k0: key(i0), o0, k1: key(i1), o1 };
}

// `en` is all these tests read; the other fields are along for the type.
function segs(...lengths: number[]): SegmentFile[] {
  return lengths.map((len, i) => ({ key: key(i), pali: '', en: 'x'.repeat(len) }));
}

// Per-segment ranges out of expandHighlights, flattened for comparison.
function flat(highlights: Highlight[], segments: SegmentFile[]): [number, number, number, string][] {
  return [...expandHighlights(highlights, segments).entries()]
    .sort((a, b) => a[0] - b[0])
    .flatMap(([i, ranges]) => ranges.map((r) => [i, r.s, r.e, r.src.id] as [number, number, number, string]));
}

describe('highlightRanges', () => {
  it('covers the tail of the first segment, every middle one in full, and the head of the last', () => {
    expect(highlightRanges(h('a', 0, 6, 2, 5), segs(10, 9, 10))).toEqual([
      { i: 0, s: 6, e: 10 },
      { i: 1, s: 0, e: 9 },
      { i: 2, s: 0, e: 5 },
    ]);
  });

  it('handles a span inside one segment, and two adjacent segments with no middle', () => {
    expect(highlightRanges(h('a', 1, 2, 1, 6), segs(10, 9, 10))).toEqual([{ i: 1, s: 2, e: 6 }]);
    expect(highlightRanges(h('a', 0, 2, 1, 2), segs(5, 4))).toEqual([
      { i: 0, s: 2, e: 5 },
      { i: 1, s: 0, e: 2 },
    ]);
  });

  it('drops a segment whose range is empty — an end anchor at offset 0', () => {
    expect(highlightRanges(h('a', 0, 0, 1, 0), segs(5, 4))).toEqual([{ i: 0, s: 0, e: 5 }]);
  });

  // The whole point of endpoints: a middle segment is covered by whatever it currently says, not by
  // a length recorded when the highlight was made.
  it('covers a middle segment reworded longer since the highlight was made', () => {
    expect(highlightRanges(h('a', 0, 1, 2, 2), segs(4, 40, 9))).toEqual([
      { i: 0, s: 1, e: 4 },
      { i: 1, s: 0, e: 40 },
      { i: 2, s: 0, e: 2 },
    ]);
  });

  // A device can be holding an older, shorter copy of a sutta than the one the highlight was made
  // against — text files revalidate in the background. The end names a segment it hasn't got.
  it('paints nothing when an end names a segment the document lacks', () => {
    expect(highlightRanges(h('a', 0, 2, 7, 4), segs(6, 5))).toEqual([]);
  });

  it('clamps an offset past the end of its segment, and drops a start past the document', () => {
    expect(highlightRanges(h('a', 1, 0, 1, 99), segs(6, 5))).toEqual([{ i: 1, s: 0, e: 5 }]);
    expect(highlightRanges(h('a', 1, 99, 1, 200), segs(6, 5))).toEqual([]);
    expect(highlightRanges(h('a', 4, 0, 4, 3), segs(6, 5))).toEqual([]);
  });
});

describe('expandHighlights', () => {
  it('buckets every highlight by the segments it covers', () => {
    expect(flat([h('a', 0, 4, 1, 8), h('b', 2, 0, 2, 3)], segs(10, 10, 10))).toEqual([
      [0, 4, 10, 'a'],
      [1, 0, 8, 'a'],
      [2, 0, 3, 'b'],
    ]);
  });
});

describe('spansOverlap', () => {
  it('is true for a shared character and false for an edge touch', () => {
    expect(spansOverlap(span(0, 0, 0, 10), span(0, 5, 0, 15))).toBe(true);
    expect(spansOverlap(span(0, 0, 0, 10), span(0, 10, 0, 20))).toBe(false);
  });

  it('compares across segments, not offsets alone', () => {
    // Ends in segment 1 at offset 4; the other starts in segment 1 at offset 2.
    expect(spansOverlap(span(0, 8, 1, 4), span(1, 2, 3, 1))).toBe(true);
    // A high offset in an earlier segment is still before a low one in a later segment.
    expect(spansOverlap(span(0, 0, 0, 99), span(1, 0, 1, 2))).toBe(false);
  });

  // The keys are compared as a reader reads them rather than as strings, or `1.10` would sort
  // between `1.1` and `1.2` and a selection would displace the wrong highlights.
  it('orders segment 10 after segment 2 rather than lexically between 1 and 2', () => {
    expect(spansOverlap(span(2, 0, 2, 5), span(10, 0, 10, 5))).toBe(false);
    expect(spansOverlap(span(2, 0, 10, 5), span(9, 0, 9, 5))).toBe(true);
  });
});

describe('highlightColors', () => {
  it('lists each colour once, in palette order rather than in the order it was used', () => {
    const [yellow, green, blue] = HIGHLIGHT_COLORS;
    const hs = [h('a', 0, 0, 0, 2, blue), h('b', 1, 0, 1, 2, yellow), h('c', 2, 0, 2, 2, blue)];
    expect(highlightColors(hs)).toEqual([yellow, blue]);
    expect(highlightColors([h('a', 0, 0, 0, 2, green)])).toEqual([green]);
    expect(highlightColors([])).toEqual([]);
  });

  it('keeps a colour that is no longer in the palette, after the ones that are', () => {
    const hs = [h('a', 0, 0, 0, 2, '#ffe08a'), h('b', 1, 0, 1, 2, HIGHLIGHT_COLORS[2])];
    expect(highlightColors(hs)).toEqual([HIGHLIGHT_COLORS[2], '#ffe08a']);
  });
});

describe('displacedIds', () => {
  it('names every highlight overlapping the selection', () => {
    const highlights = [h('g1', 0, 0, 1, 10), h('g2', 0, 20, 0, 30)];
    expect(displacedIds(highlights, span(0, 5, 0, 25))).toEqual(['g1', 'g2']);
  });

  // A highlight is atomic: a selection touching any part of one displaces all of it, so the rest
  // can't be left behind as a stranded remnant.
  it('names a highlight the selection only reaches the far end of', () => {
    expect(displacedIds([h('g1', 0, 0, 1, 10)], span(1, 9, 1, 12))).toEqual(['g1']);
  });

  it('names one the selection fully contains, and one that fully contains the selection', () => {
    expect(displacedIds([h('g1', 0, 5, 0, 10)], span(0, 0, 0, 15))).toEqual(['g1']);
    expect(displacedIds([h('g1', 0, 0, 0, 20)], span(0, 5, 0, 10))).toEqual(['g1']);
  });

  it('ignores an edge-touching selection and one in another segment', () => {
    const highlights = [h('g1', 0, 0, 0, 10), h('g2', 1, 0, 1, 10)];
    expect(displacedIds(highlights, span(0, 10, 0, 20))).toEqual([]);
  });

  // Needs no sutta text, which is what lets the mirror work this out with nothing loaded.
  it('names a highlight overlapped only in a segment neither endpoint sits in', () => {
    expect(displacedIds([h('g1', 0, 0, 5, 2)], span(3, 1, 3, 4))).toEqual(['g1']);
  });
});

describe('paintSegmentRanges', () => {
  const range = (s: number, e: number, src: Highlight) => ({ s, e, src });

  it('leaves non-overlapping ranges as they are, in document order', () => {
    const painted = paintSegmentRanges([range(20, 30, h('b', 0, 20, 0, 30)), range(0, 10, h('a', 0, 0, 0, 10))]);
    expect(painted.map(({ s, e, src }) => [s, e, src.id])).toEqual([
      [0, 10, 'a'],
      [20, 30, 'b'],
    ]);
  });

  // The residue of immutable highlights: two devices highlighting overlapping spans offline both
  // survive, and the later one takes the characters they contest.
  it('gives the contested characters to the highlight with the later mtime', () => {
    const older = h('a', 0, 0, 0, 10, '#ffe08a', '2026-01-01T00:00:00.000Z|dev');
    const newer = h('b', 0, 5, 0, 15, '#a8d8f0', '2026-01-02T00:00:00.000Z|dev');
    const painted = paintSegmentRanges([range(0, 10, older), range(5, 15, newer)]);
    expect(painted.map(({ s, e, src }) => [s, e, src.id])).toEqual([
      [0, 5, 'a'],
      [5, 15, 'b'],
    ]);
  });

  it('resolves the same way whichever order the two arrive in', () => {
    const older = range(0, 10, h('a', 0, 0, 0, 10, '#ffe08a', '2026-01-01T00:00:00.000Z|dev'));
    const newer = range(5, 15, h('b', 0, 5, 0, 15, '#a8d8f0', '2026-01-02T00:00:00.000Z|dev'));
    expect(paintSegmentRanges([newer, older])).toEqual(paintSegmentRanges([older, newer]));
  });

  // Same millisecond on two devices — the id breaks the tie, so both devices paint it the same way
  // without having to talk to each other.
  it('breaks an mtime tie on id', () => {
    const m = '2026-01-01T00:00:00.000Z|dev';
    const a = range(0, 10, h('a', 0, 0, 0, 10, '#ffe08a', m));
    const b = range(5, 15, h('b', 0, 5, 0, 15, '#a8d8f0', m));
    expect(paintSegmentRanges([b, a]).map(({ src }) => src.id)).toEqual(['a', 'b']);
  });

  // Both pieces still carry the loser's own highlight, so clicking either resolves to the whole of
  // it (see SegmentedText's buildParts).
  it('splits an earlier highlight covered in the middle into two pieces', () => {
    const older = h('a', 0, 0, 0, 20, '#ffe08a', '2026-01-01T00:00:00.000Z|dev');
    const newer = h('b', 0, 5, 0, 10, '#a8d8f0', '2026-01-02T00:00:00.000Z|dev');
    const painted = paintSegmentRanges([range(0, 20, older), range(5, 10, newer)]);
    expect(painted.map(({ s, e, src }) => [s, e, src.id])).toEqual([
      [0, 5, 'a'],
      [5, 10, 'b'],
      [10, 20, 'a'],
    ]);
  });

  it('drops an earlier highlight entirely covered by a later one', () => {
    const older = h('a', 0, 5, 0, 10, '#ffe08a', '2026-01-01T00:00:00.000Z|dev');
    const newer = h('b', 0, 0, 0, 20, '#a8d8f0', '2026-01-02T00:00:00.000Z|dev');
    const painted = paintSegmentRanges([range(5, 10, older), range(0, 20, newer)]);
    expect(painted.map(({ s, e, src }) => [s, e, src.id])).toEqual([[0, 20, 'b']]);
  });

  // Abutting slices the same highlight won must come back as one span, not several with seams.
  it('merges adjacent slices won by the same highlight', () => {
    const winner = h('a', 0, 0, 0, 30, '#ffe08a', '2026-01-03T00:00:00.000Z|dev');
    const loser1 = h('b', 0, 5, 0, 10, '#a8d8f0', '2026-01-01T00:00:00.000Z|dev');
    const loser2 = h('c', 0, 15, 0, 20, '#a8d8f0', '2026-01-02T00:00:00.000Z|dev');
    const painted = paintSegmentRanges([range(0, 30, winner), range(5, 10, loser1), range(15, 20, loser2)]);
    expect(painted.map(({ s, e, src }) => [s, e, src.id])).toEqual([[0, 30, 'a']]);
  });
});

describe('highlightText', () => {
  it('joins the covered text segment by segment', () => {
    const segments: SegmentFile[] = [
      { key: key(0), pali: '', en: 'Mendicants, form is impermanent.' },
      { key: key(1), pali: '', en: 'What is impermanent is suffering.' },
    ];
    expect(highlightText(h('a', 0, 12, 1, 4), segments)).toBe('form is impermanent. What');
    expect(highlightText(h('a', 0, 0, 0, 10), null)).toBe('');
  });
});

// A highlight naming a segment the loaded text doesn't have paints nothing rather than painting
// somewhere its reader never put it. Nothing deletes it, so it paints again if the text regains the
// segment.
describe('a highlight naming a segment this text lacks', () => {
  const segments = segs(10, 10, 10);
  const missing = (k0: string, k1: string): Highlight => ({ id: 'g', k0, o0: 2, k1, o1: 4, c: 'yellow', m: '1|d' });

  it('paints nothing and reports no start', () => {
    for (const gone of [missing('sn1.1:7', 'sn1.1:8'), missing('sn1.1:7', key(2)), missing(key(0), 'sn1.1:8')]) {
      expect(highlightRanges(gone, segments)).toEqual([]);
      expect(highlightStart(gone, segments)).toBeNull();
      expect(expandHighlights([gone], segments).size).toBe(0);
    }
  });

  // The segments between the endpoints are never named, so losing one costs the highlight nothing.
  it('still covers a span whose middle segment is the one missing', () => {
    const overGap: Highlight = { id: 'g', k0: key(0), o0: 8, k1: key(2), o1: 3, c: 'yellow', m: '1|d' };
    expect(highlightRanges(overGap, [segments[0], segments[2]])).toEqual([
      { i: 0, s: 8, e: 10 },
      { i: 1, s: 0, e: 3 },
    ]);
  });
});
