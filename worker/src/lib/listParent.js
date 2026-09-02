// Returns why a candidate parent row can't hold a list, or null if it can — only a group can.
// `row` is the parent's `lists` row, or null if there is none.
export function invalidParentReasonForRow(row) {
  if (!row) return 'parent_not_found';
  if (row.kind !== 'group') return 'parent_not_a_group';
  return null;
}

// Reports whether setting `movingId`'s parent to `parentId` would create a cycle — a list set as
// its own parent, or moved underneath one of its own descendants. `allLists` is every list row for
// this user as `{id, parentId}` pairs, walked in memory.
export function wouldCreateCycle(movingId, parentId, allLists) {
  if (!parentId) return false;
  if (parentId === movingId) return true;
  const byId = new Map(allLists.map((l) => [l.id, l]));
  // Terminates the walk on rows already in a cycle, which storage can hold — cycles are broken at
  // read time and never written back. The client's port has the same guard.
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
