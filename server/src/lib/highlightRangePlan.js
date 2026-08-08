import { rangesOverlap } from './highlightOverlap.js';

// Decides what PUT /highlights/ranges (routes/annotations.js) should delete and insert for one
// atomic write, given the highlights already stored for this sutta. Pulled out as a pure
// function — no Firestore reference — so the overlap-filtering and shared-groupId-insert logic
// (the most-patched part of the app's history: gutter misalignment, cross-segment highlights not
// merging, etc.) is unit-testable without a live Firestore/emulator; the route itself only
// supplies the already-fetched docs and reads/writes the transaction.
//
// `existing` is `{id, data}` pairs (data being each doc's own {suttaId, i, s, e, color, g,
// createdAt}); `ranges` is one or more `{i, s, e}` (a multi-segment selection passes every
// segment's range in one call — see useHighlightPopup). `color === null`/undefined just removes
// every overlap (no re-insert) — the "erase" case.
export function planHighlightRangeUpdate(existing, ranges, color, { suttaId, createdAt, groupId }) {
  const deleteIds = existing.filter(({ data }) => ranges.some((r) => rangesOverlap(data, r.i, r.s, r.e))).map(({ id }) => id);
  // Every range from one call shares a single groupId so a cross-segment highlight (one doc per
  // segment) can be recombined for display/counting by lib/highlights.ts's groupHighlights,
  // without inferring it from segment adjacency.
  const inserts = color ? ranges.map((r) => ({ suttaId, i: r.i, s: r.s, e: r.e, color, g: groupId, createdAt })) : [];
  return { deleteIds, inserts };
}
