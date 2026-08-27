import type { SegmentFile } from './corpus';
import { HIGHLIGHT_COLORS } from './theme';
import type { Highlight } from './types';

export interface HighlightGroup {
  key: string;
  c: string;
  i: number;
  items: Highlight[];
}

export interface HlRange {
  i: number;
  s: number;
  e: number;
}

// Range-building math for a cross-segment selection (useHighlightPopup's onTextUp): the first
// segment gets the tail from the selection start to its own end, each segment in between its full
// length, and the last the head from its own start to the selection end. `segs` must be in document
// order, and each `fullLen` has to come from the stored segment text rather than rendered DOM
// textContent, which carries characters that aren't part of it.
export function buildCrossSegmentRanges(
  segs: { i: number; fullLen: number }[],
  startOffset: number,
  endOffset: number
): HlRange[] {
  return segs
    .map(({ i, fullLen }, idx) => {
      const s = idx === 0 ? startOffset : 0;
      const e = idx === segs.length - 1 ? endOffset : fullLen;
      return { i, s, e };
    })
    .filter((r) => r.e > r.s);
}

// A cross-segment highlight is stored as one Highlight document per segment, all sharing the same
// `g` — the group id the client mints when the user picks the colour. Collected by that field
// rather than by segment/offset adjacency, which two overlapping groups would interleave and split
// apart. Groups come back in document order, keyed on their first row's id.
export function groupHighlights(highlights: Highlight[]): HighlightGroup[] {
  const byGroup = new Map<string, Highlight[]>();
  for (const h of [...highlights].sort((a, b) => a.i - b.i || a.s - b.s)) {
    const items = byGroup.get(h.g);
    if (items) items.push(h);
    else byGroup.set(h.g, [h]);
  }
  return [...byGroup.values()]
    .sort((a, b) => a[0].i - b[0].i || a[0].s - b[0].s)
    .map((items) => ({ key: items[0].id, c: items[0].c, i: items[0].i, items }));
}

// The groups a new selection displaces — every group with a row overlapping one of `ranges` (same
// segment, `h.s < r.e && h.e > r.s`, so edge-touching isn't overlap). A group is immutable and
// atomic: recolouring or erasing any part of one retires the whole thing, rather than leaving the
// segments the selection missed behind as a stranded remnant.
//
// The client works this out from what it can see and tells the server explicitly, so the write
// means the same thing whenever it is replayed — a server-side "delete whatever currently
// overlaps" would take highlights another device created in the meantime.
export function displacedGroupIds(highlights: Highlight[], ranges: HlRange[]): string[] {
  const ids = new Set<string>();
  for (const h of highlights) {
    if (ranges.some((r) => h.i === r.i && h.s < r.e && h.e > r.s)) ids.add(h.g);
  }
  return [...ids];
}

// A painted piece of one segment's text: `s`/`e` are what to draw, `src` the highlight that won
// those characters (its own stored range may be wider — see paintSegmentHighlights).
export interface PaintedRange {
  s: number;
  e: number;
  src: Highlight;
}

// Later group wins: mtime first, groupId as the tiebreak so two devices' writes in the same
// millisecond still resolve identically on both of them.
function precedes(a: Highlight, b: Highlight): boolean {
  return a.m === b.m ? a.g < b.g : a.m < b.m;
}

// Resolves one segment's highlights into non-overlapping pieces to render, in document order.
//
// Stored ranges can genuinely overlap, since groups are immutable: two devices highlighting
// overlapping spans offline both survive, so the reader is where the contest is settled —
// deterministically, by (mtime, g), the later group taking the characters both cover. An earlier
// group overlapped in the middle comes back as two pieces, both carrying its own stored range.
export function paintSegmentHighlights(hlForSeg: Highlight[]): PaintedRange[] {
  if (hlForSeg.length < 2) return hlForSeg.map((h) => ({ s: h.s, e: h.e, src: h }));
  // Ascending precedence, so the last covering highlight found for a slice is its winner.
  const ranked = [...hlForSeg].sort((a, b) => (precedes(a, b) ? -1 : 1));
  // Every endpoint, so each elementary slice between two adjacent ones is either fully inside a
  // stored range or fully outside it — never partially.
  const bounds = [...new Set(ranked.flatMap((h) => [h.s, h.e]))].sort((a, b) => a - b);
  const painted: PaintedRange[] = [];
  for (let k = 0; k < bounds.length - 1; k++) {
    const [s, e] = [bounds[k], bounds[k + 1]];
    let winner: Highlight | undefined;
    for (const h of ranked) if (h.s <= s && h.e >= e) winner = h;
    if (!winner) continue;
    const prev = painted[painted.length - 1];
    // Adjacent slices the same highlight won are one span, not several — otherwise a group
    // overlapped at one end would render as two abutting spans with a seam between them.
    if (prev && prev.src === winner && prev.e === s) prev.e = e;
    else painted.push({ s, e, src: winner });
  }
  return painted;
}

// Total number of merged highlights on a sutta (see groupHighlights), across every colour — the
// number in ListPane's and ReaderPage's highlight indicators.
export function highlightCount(highlights: Highlight[]): number {
  return groupHighlights(highlights).length;
}

// The distinct colours those highlights use, drawn as the swatches beside that count (see
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

export function highlightGroupText(group: HighlightGroup, segments: SegmentFile[] | null): string {
  return group.items
    .map((h) => (segments?.[h.i]?.en || '').slice(h.s, h.e))
    .join(' ')
    .trim();
}
