import type { SegmentFile } from './corpus';
import { HIGHLIGHT_COLORS } from './theme';
import type { Highlight } from './types';

// A highlight's stored extent, on its own — the half-open span from (i0, o0) to (i1, o1). See
// Highlight in lib/types.ts.
export interface HlSpan {
  i0: number;
  o0: number;
  i1: number;
  o1: number;
}

// Document order over two (segment, offset) points. Everything about how spans relate to each other
// is decided with this and nothing else, so it holds in the mirror, where no sutta text is loaded.
function before(iA: number, oA: number, iB: number, oB: number): boolean {
  return iA < iB || (iA === iB && oA < oB);
}

// True when two spans share at least one character. Edge-touching isn't overlap: a selection that
// starts exactly where a highlight ends displaces nothing.
export function spansOverlap(a: HlSpan, b: HlSpan): boolean {
  return before(a.i0, a.o0, b.i1, b.o1) && before(b.i0, b.o0, a.i1, a.o1);
}

// The highlights a new selection displaces — every one whose span overlaps `span`. A highlight is
// immutable and atomic: recolouring or erasing any part of one retires the whole thing, rather than
// leaving the characters the selection missed behind as a stranded remnant.
//
// The client works this out from what it can see and tells the server explicitly, so the write
// means the same thing whenever it is replayed — a server-side "delete whatever currently overlaps"
// would take highlights another device created in the meantime.
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

// One highlight's coverage segment by segment, in document order, against the text this device
// currently holds. The endpoint segments contribute the offsets the user selected; everything
// between them is covered in full, which is why text reworded longer since can't leave a gap.
//
// Both ends are clamped to what actually exists. A device can be holding an older, shorter copy of
// a sutta than the one the highlight was made against — text files revalidate in the background, so
// two devices can disagree for a while — and an end anchor past the last segment would otherwise
// have nothing to stop at. A highlight whose start is past the end of the document has nothing to
// paint at all.
export function highlightRanges(h: Highlight, segments: SegmentFile[]): { i: number; s: number; e: number }[] {
  if (h.i0 >= segments.length) return [];
  const last = Math.min(h.i1, segments.length - 1);
  const ranges: { i: number; s: number; e: number }[] = [];
  for (let i = h.i0; i <= last; i++) {
    const len = segments[i].en.length;
    const s = i === h.i0 ? Math.min(h.o0, len) : 0;
    const e = i === h.i1 ? Math.min(h.o1, len) : len;
    if (e > s) ranges.push({ i, s, e });
  }
  return ranges;
}

// Every highlight's ranges, bucketed by segment index — what the renderer walks. Built once per
// change rather than having each segment re-scan the whole array.
export function expandHighlights(highlights: Highlight[], segments: SegmentFile[]): Map<number, SegmentRange[]> {
  const bySeg = new Map<number, SegmentRange[]>();
  for (const h of highlights) {
    for (const { i, s, e } of highlightRanges(h, segments)) {
      const ranges = bySeg.get(i);
      if (ranges) ranges.push({ s, e, src: h });
      else bySeg.set(i, [{ s, e, src: h }]);
    }
  }
  return bySeg;
}

// Later highlight wins: mtime first, id as the tiebreak so two devices' writes in the same
// millisecond still resolve identically on both of them.
function precedes(a: Highlight, b: Highlight): boolean {
  return a.m === b.m ? a.id < b.id : a.m < b.m;
}

// Resolves one segment's ranges into non-overlapping pieces to render, in document order.
//
// Highlights can genuinely overlap, since they are immutable: two devices highlighting overlapping
// spans offline both survive, so the reader is where the contest is settled — deterministically, by
// (mtime, id), the later highlight taking the characters both cover. An earlier one overlapped in
// the middle comes back as two pieces.
export function paintSegmentRanges(ranges: SegmentRange[]): SegmentRange[] {
  if (ranges.length < 2) return ranges.map(({ s, e, src }) => ({ s, e, src }));
  // Ascending precedence, so the last covering range found for a slice is its winner.
  const ranked = [...ranges].sort((a, b) => (precedes(a.src, b.src) ? -1 : 1));
  // Every endpoint, so each elementary slice between two adjacent ones is either fully inside a
  // range or fully outside it — never partially.
  const bounds = [...new Set(ranked.flatMap((r) => [r.s, r.e]))].sort((a, b) => a - b);
  const painted: SegmentRange[] = [];
  for (let k = 0; k < bounds.length - 1; k++) {
    const [s, e] = [bounds[k], bounds[k + 1]];
    let winner: SegmentRange | undefined;
    for (const r of ranked) if (r.s <= s && r.e >= e) winner = r;
    if (!winner) continue;
    const prev = painted[painted.length - 1];
    // Adjacent slices the same highlight won are one span, not several — otherwise a highlight
    // overlapped at one end would render as two abutting spans with a seam between them.
    if (prev && prev.src === winner.src && prev.e === s) prev.e = e;
    else painted.push({ s, e, src: winner.src });
  }
  return painted;
}

// The distinct colours a sutta's highlights use, drawn as the swatches beside their count (see
// HighlightCountBadge). Ordered by the palette rather than by when each colour was first used, so a
// row's swatches sit in the same order on every sutta. A colour outside the palette — a highlight
// made against an older build — still gets a swatch, at the end.
export function highlightColors(highlights: Highlight[]): string[] {
  const rank = (c: string) => {
    const i = HIGHLIGHT_COLORS.indexOf(c);
    return i < 0 ? HIGHLIGHT_COLORS.length : i;
  };
  return [...new Set(highlights.map((h) => h.c))].sort((a, b) => rank(a) - rank(b));
}

// The highlighted text itself, for the reader panel's list of a sutta's highlights. Segments are
// joined with a space: consecutive segments are separate lines of the document, not a continuous
// string.
export function highlightText(h: Highlight, segments: SegmentFile[] | null): string {
  if (!segments) return '';
  return highlightRanges(h, segments)
    .map(({ i, s, e }) => segments[i].en.slice(s, e))
    .join(' ')
    .trim();
}
