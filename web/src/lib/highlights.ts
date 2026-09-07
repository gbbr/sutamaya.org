import type { SegmentFile } from './corpus';
import { compareSegmentKeys, segmentIndex } from './segmentKeys';
import { HIGHLIGHT_COLORS } from './theme';
import type { Highlight } from './types';

// Highlight geometry: which highlights a new selection displaces, and how overlapping ones resolve
// into the pieces the reader actually paints.
//
// A highlight is one half-open span from (k0, o0) to (k1, o1) in segment-key-and-offset
// coordinates, immutable and atomic — a selection touching any part of one retires the whole of it,
// and the client names what it displaced so the write means the same thing whenever it is replayed.
// Highlights can still genuinely overlap, two devices having made them offline, so the reader is
// where that contest is settled: deterministically by (mtime, id), the later one taking the
// characters both cover.

// A highlight's stored extent on its own. See Highlight in lib/types.ts.
export interface HlSpan {
  k0: string;
  o0: number;
  k1: string;
  o1: number;
}

// Document order over two (segment, offset) points. Everything about how spans relate is decided
// with this alone, so it holds in the mirror, where no sutta text is loaded.
function before(kA: string, oA: number, kB: string, oB: number): boolean {
  const seg = compareSegmentKeys(kA, kB);
  return seg < 0 || (seg === 0 && oA < oB);
}

// True when two spans share at least one character. Edge-touching isn't overlap: a selection that
// starts exactly where a highlight ends displaces nothing.
export function spansOverlap(a: HlSpan, b: HlSpan): boolean {
  return before(a.k0, a.o0, b.k1, b.o1) && before(b.k0, b.o0, a.k1, a.o1);
}

// The ids of every highlight a new selection displaces.
export function displacedIds(highlights: Highlight[], span: HlSpan): string[] {
  return highlights.filter((h) => spansOverlap(h, span)).map((h) => h.id);
}

// A piece of one segment's text to paint, in that segment's own character offsets, and the
// highlight it came from.
export interface SegmentRange {
  s: number;
  e: number;
  src: Highlight;
}

// One highlight's coverage segment by segment, against the text this device holds. The endpoints
// contribute the offsets selected and everything between is covered in full, so text reworded
// longer since can't leave a gap, and both offsets are clamped to the segment they land in.
//
// A span naming a segment this copy of the sutta doesn't have resolves to nothing and paints
// nothing. The highlight is untouched in the account and paints again as soon as the text has that
// segment.
export function highlightRanges(
  h: Highlight,
  segments: SegmentFile[],
  index: Map<string, number> = segmentIndex(segments)
): { i: number; s: number; e: number }[] {
  const i0 = index.get(h.k0);
  const i1 = index.get(h.k1);
  if (i0 === undefined || i1 === undefined || i1 < i0) return [];
  const ranges: { i: number; s: number; e: number }[] = [];
  for (let i = i0; i <= i1; i++) {
    const len = segments[i].en.length;
    const s = i === i0 ? Math.min(h.o0, len) : 0;
    const e = i === i1 ? Math.min(h.o1, len) : len;
    if (e > s) ranges.push({ i, s, e });
  }
  return ranges;
}

// The segment a highlight begins on in this copy of the text — where a jump from the gutter or the
// panel lands — or null for one naming a segment the text doesn't have.
export function highlightStart(
  h: Highlight,
  segments: SegmentFile[],
  index: Map<string, number> = segmentIndex(segments)
): number | null {
  const ranges = highlightRanges(h, segments, index);
  return ranges.length ? ranges[0].i : null;
}

// Every highlight's ranges, bucketed by segment index — what the renderer walks. Built once per
// change rather than having each segment re-scan the whole array.
export function expandHighlights(highlights: Highlight[], segments: SegmentFile[]): Map<number, SegmentRange[]> {
  const index = segmentIndex(segments);
  const bySeg = new Map<number, SegmentRange[]>();
  for (const h of highlights) {
    for (const { i, s, e } of highlightRanges(h, segments, index)) {
      const ranges = bySeg.get(i);
      if (ranges) ranges.push({ s, e, src: h });
      else bySeg.set(i, [{ s, e, src: h }]);
    }
  }
  return bySeg;
}

// True when `a` loses to `b`: mtime first, id as the tiebreak, so two devices resolve identically.
function precedes(a: Highlight, b: Highlight): boolean {
  return a.m === b.m ? a.id < b.id : a.m < b.m;
}

// Resolves one segment's ranges into the non-overlapping pieces to render, in document order. A
// highlight overlapped in the middle comes back as two pieces.
export function paintSegmentRanges(ranges: SegmentRange[]): SegmentRange[] {
  if (ranges.length < 2) return ranges.map(({ s, e, src }) => ({ s, e, src }));
  // Ascending precedence, so the last covering range found for a slice is its winner.
  const ranked = [...ranges].sort((a, b) => (precedes(a.src, b.src) ? -1 : 1));
  // Every endpoint, so each slice between two adjacent ones is either fully inside a range or
  // fully outside it.
  const bounds = [...new Set(ranked.flatMap((r) => [r.s, r.e]))].sort((a, b) => a - b);
  const painted: SegmentRange[] = [];
  for (let k = 0; k < bounds.length - 1; k++) {
    const [s, e] = [bounds[k], bounds[k + 1]];
    let winner: SegmentRange | undefined;
    for (const r of ranked) if (r.s <= s && r.e >= e) winner = r;
    if (!winner) continue;
    const prev = painted[painted.length - 1];
    // Adjacent slices one highlight won are merged, or a highlight overlapped at one end would
    // render as two abutting spans with a seam between them.
    if (prev && prev.src === winner.src && prev.e === s) prev.e = e;
    else painted.push({ s, e, src: winner.src });
  }
  return painted;
}

// The distinct colours a sutta's highlights use, in palette order so a row's swatches sit the same
// way on every sutta. A colour outside the palette still gets a swatch, at the end.
export function highlightColors(highlights: Highlight[]): string[] {
  const rank = (c: string) => {
    const i = HIGHLIGHT_COLORS.indexOf(c);
    return i < 0 ? HIGHLIGHT_COLORS.length : i;
  };
  return [...new Set(highlights.map((h) => h.c))].sort((a, b) => rank(a) - rank(b));
}

// The highlighted text itself, for the reader panel's list. Segments are joined with a space,
// being separate lines of the document rather than one continuous string.
export function highlightText(h: Highlight, segments: SegmentFile[] | null, index?: Map<string, number>): string {
  if (!segments) return '';
  return highlightRanges(h, segments, index ?? segmentIndex(segments))
    .map(({ i, s, e }) => segments[i].en.slice(s, e))
    .join(' ')
    .trim();
}
