// The build's copy of the reader's segment-key comparator (web/src/lib/segmentKeys.ts), nothing
// being shared across the two npm workspaces. build-corpus.mjs asserts every document it emits is
// in this order, so the reader can decide what a highlight overlaps from the keys alone — see
// docs/offline-sync.md's "Anchored on segment keys".
//
// Change one, change the other; web/src/lib/segmentKeys.test.ts is the tripwire.

const SEGMENT_RUN_RE = /\d+|\D+/g;
const DIGITS_RE = /^\d+$/;

export function compareSegmentKeys(a, b) {
  if (a === b) return 0;
  const ra = a.match(SEGMENT_RUN_RE) ?? [];
  const rb = b.match(SEGMENT_RUN_RE) ?? [];
  for (let i = 0; i < ra.length || i < rb.length; i++) {
    const x = ra[i];
    const y = rb[i];
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
