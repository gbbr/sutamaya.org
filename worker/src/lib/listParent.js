// A ListGroup can hold other lists/groups; a plain list can't hold anything — so any non-null
// parentId, for either kind of row, must point at an existing group. `row` is the candidate
// parent's `lists` row (a plain object with a `kind` column) — or null if no such row exists.
// Returns an error code if invalid, or null if the parent checks out (including the top-level
// `null` parentId case, where `row` is never even fetched — see routes/lists.js's
// invalidParentReason).
export function invalidParentReasonForRow(row) {
  if (!row) return 'parent_not_found';
  if (row.kind !== 'group') return 'parent_not_a_group';
  return null;
}

// True if setting `movingId`'s parent to `parentId` would create a cycle — either directly (a
// list set as its own parent) or by moving it underneath one of its own descendants, which would
// make one of `movingId`'s current ancestors end up nested under `movingId` itself. `allLists`
// is every list row for this user as plain {id, parentId} pairs (cheap at personal scale — same
// assumption the rest of this file already makes), enough to walk the chain in memory without
// further D1 round trips. The client's own drag-and-drop (useListTreeDrag's isDescendant)
// already avoids this in the normal case; this is the server-side backstop for a stale/racing or
// buggy request that reaches routes/lists.js directly.
export function wouldCreateCycle(movingId, parentId, allLists) {
  if (!parentId) return false;
  if (parentId === movingId) return true;
  const byId = new Map(allLists.map((l) => [l.id, l]));
  // `seen` is what makes this terminate on rows that are *already* in a cycle. Cycles are broken at
  // read time (lib/listTree.js) and never written back, so a pair of rows pointing at each other —
  // two devices' reparents interleaving, which D1 has no transaction to prevent — stays that way in
  // storage, and an unguarded walk up from one of them would spin until the Worker's CPU limit
  // killed every request touching that subtree. The client's port has the same guard
  // (web/src/lib/listTree.ts).
  const seen = new Set([movingId]);
  let cur = byId.get(parentId);
  while (cur?.parentId) {
    if (cur.parentId === movingId) return true;
    if (seen.has(cur.id)) return false;
    seen.add(cur.id);
    cur = byId.get(cur.parentId);
  }
  return false;
}
