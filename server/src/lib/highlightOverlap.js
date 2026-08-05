// A highlight `h` (stored as {i, s, e, ...}, half-open [s, e) within segment i) overlaps a
// candidate range [s, e) in the same segment i if their intervals intersect at all — including
// one fully containing the other, but *not* merely touching at an edge (h.e === s or h.s === e
// is adjacent, not overlapping).
export function rangesOverlap(h, i, s, e) {
  return h.i === i && h.s < e && h.e > s;
}
