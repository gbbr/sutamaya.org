// Repairs the stored lists into a renderable tree at read time — cascading a deleted group's
// descendants out, breaking cycles and re-homing danglers (docs/offline-sync.md, mechanism 4).
// Every step is deterministic given identical input, so two devices converge without
// communicating; tombstones are passed in rather than filtered in SQL, the cascade needing them.

// Orders by (mtime, id), lowest first.
function olderFirst(a, b) {
  if (a.mtime !== b.mtime) return a.mtime < b.mtime ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}

// Orders siblings by (position, id); two devices prepending offline do compute the same position.
function bySiblingOrder(a, b) {
  if (a.position !== b.position) return a.position - b.position;
  return a.id < b.id ? -1 : 1;
}

// Returns the live, reachable lists in sibling order, each with a valid `parentId`. `lists` is
// `{id, parentId, position, mtime, deleted}` per entry, tombstones included; other fields pass
// through untouched.
export function repairListTree(lists) {
  const byId = new Map(lists.map((list) => [list.id, list]));

  // Each list's parent, a parentId naming no row at all becoming top-level.
  const parentOf = new Map(
    lists.map((list) => [list.id, list.parentId && byId.has(list.parentId) ? list.parentId : null])
  );

  // Break cycles, before anything else walks an ancestor chain. Walking up from every node in id
  // order finds every cycle, each node having one parent, and the loser is the cycle's global
  // minimum, so neither input order nor the entry point changes the outcome.
  for (const { id } of [...lists].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const path = [];
    const seen = new Set();
    let cur = id;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      path.push(cur);
      cur = parentOf.get(cur) ?? null;
    }
    if (!cur) continue; // reached the root — no cycle on this chain
    // The cycle proper: from where the walk re-entered itself onward.
    const cycle = path.slice(path.indexOf(cur)).map((memberId) => byId.get(memberId));
    // The oldest member is re-homed, so the most recent move survives.
    const loser = cycle.reduce((lowest, candidate) => (olderFirst(candidate, lowest) < 0 ? candidate : lowest));
    parentOf.set(loser.id, null);
  }

  // Reports whether a list survives: it is gone if it is tombstoned or anything above it is, so
  // the survivors form a closed forest.
  const survives = (id) => {
    let cur = id;
    while (cur) {
      if (byId.get(cur).deleted) return false;
      cur = parentOf.get(cur) ?? null;
    }
    return true;
  };

  return lists
    .filter((list) => survives(list.id))
    .map((list) => ({ ...list, parentId: parentOf.get(list.id) ?? null }))
    .sort(bySiblingOrder);
}
