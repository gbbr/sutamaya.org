import type { SegmentFile } from './corpus';

// Segment keys — SuttaCentral's own segment ids, `${uid}:${paragraph}.${line}` — and the document
// order they carry.
//
// A highlight anchors on a key rather than on a segment's position, so that adding or removing a
// line moves no highlight but the one on that line. The order is readable from the keys alone,
// which is what lets the offline mirror decide what a new selection overlaps while holding nothing
// but the highlights themselves.

// What follows a segment key's colon: digits and dots.
const LINE_RE = /^\d+(?:\.\d+)*$/;

// Returns whether `line` is one a segment key can end in, as "15.4" is.
export function isKeyLine(line: string): boolean {
  return LINE_RE.test(line);
}

// Returns the sutta a segment key belongs to: "sn46.53" of "sn46.53:15.4".
export function keySutta(key: string): string {
  return key.slice(0, key.indexOf(':'));
}

// Returns a segment key's line within its sutta: "15.4" of "sn46.53:15.4".
export function keyLine(key: string): string {
  return key.slice(key.indexOf(':') + 1);
}

// Document order over two segment keys, comparing digit runs as numbers so `1.10` follows `1.2`
// rather than preceding it. build-corpus.mjs asserts every document it emits is in this order —
// see scripts/lib/segmentKeys.js, the build's copy of this function.
export function compareSegmentKeys(a: string, b: string): number {
  if (a === b) return 0;
  const ra = a.match(SEGMENT_RUN_RE) ?? [];
  const rb = b.match(SEGMENT_RUN_RE) ?? [];
  for (let i = 0; i < ra.length || i < rb.length; i++) {
    const x = ra[i];
    const y = rb[i];
    // The shorter key is a prefix of the longer, so it comes first.
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = DIGITS_RE.test(x);
    const ny = DIGITS_RE.test(y);
    if (nx && ny) {
      if (+x !== +y) return +x - +y;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

// A key splits into runs of digits and runs of everything else, which is what lets the numbers be
// compared as numbers.
const SEGMENT_RUN_RE = /\d+|\D+/g;
const DIGITS_RE = /^\d+$/;

// Where each of a document's segments sits in it. One map per loaded text, built once and shared by
// everything that has to turn a stored key back into a position to render it.
export function segmentIndex(segments: SegmentFile[]): Map<string, number> {
  const index = new Map<string, number>();
  for (let i = 0; i < segments.length; i++) index.set(segments[i].key, i);
  return index;
}

// Returns where in `segments` the line `key` names sits or, where they don't have it — a title, a
// line with no English, a line a text refresh renumbered — the next line of the same sutta; -1
// where they have neither.
export function segmentAt(segments: SegmentFile[], key: string): number {
  const sutta = `${keySutta(key)}:`;
  return segments.findIndex((s) => s.key.startsWith(sutta) && compareSegmentKeys(s.key, key) >= 0);
}
