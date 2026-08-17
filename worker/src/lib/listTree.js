// A4: repairs the list set into a renderable tree at read time, rather than rewriting rows when a
// delete happens. Deleting a group has to take everything inside it, and two devices can each make
// a valid move that together form a cycle — neither is fixable at write time, because whichever
// write lands second never sees the other. Repairing on read instead means both devices converge on
// the same tree without communicating, which is why every step here has to be deterministic given
// identical input rather than dependent on row order.
//
// Tombstoned rows are passed in rather than filtered out in SQL: the cascade needs to know which
// ancestors are dead in order to drop what hangs off them.

// Lowest (mtime, id) first. `id` breaks the tie so two rows written in the same millisecond still
// order identically on every device.
function olderFirst(a, b) {
  if (a.mtime !== b.mtime) return a.mtime < b.mtime ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}

// Siblings render in `position` order; `id` breaks the tie, which the negative-prepend scheme
// (lib/listPositions.js's firstPosition) can genuinely produce — two devices each prepending
// offline both compute the same next position.
function bySiblingOrder(a, b) {
  if (a.position !== b.position) return a.position - b.position;
  return a.id < b.id ? -1 : 1;
}

// `lists` is `{id, parentId, position, mtime, deleted}` per entry, tombstones included (extra fields
// pass through untouched). Returns a new array of just the live, reachable lists — sorted, with any
// dangling `parentId` re-homed.
export function repairListTree(lists) {
  const byId = new Map(lists.map((list) => [list.id, list]));

  // Re-home danglers: a parentId pointing at no row *at all* becomes top-level. This is a safety
  // net, not delete semantics — `parent_id` has no foreign key, so a client that pushes a child
  // before its parent would otherwise leave a list that exists but renders nowhere. A parentId
  // pointing at a *tombstoned* row is the different case the cascade below handles.
  const parentOf = new Map(
    lists.map((list) => [list.id, list.parentId && byId.has(list.parentId) ? list.parentId : null])
  );

  // Break cycles, before anything walks an ancestor chain — otherwise these walks never terminate.
  // Each row has at most one parent, so a walk up from any node enters at most one cycle: one break
  // per walk is enough, and walking from every node finds every cycle. Iterated in id order, and
  // the loser chosen as the global minimum of the cycle's members, so neither the input's order nor
  // which node the walk entered the cycle from can change the outcome.
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
    // `cur` is where the walk re-entered itself, so everything from there on is the cycle proper
    // (any nodes before it merely lead into it and stay put).
    const cycle = path.slice(path.indexOf(cur)).map((memberId) => byId.get(memberId));
    // The lowest mtime is re-homed, so the most recent move is the one that survives.
    const loser = cycle.reduce((lowest, candidate) => (olderFirst(candidate, lowest) < 0 ? candidate : lowest));
    parentOf.set(loser.id, null);
  }

  // Cascade: a list is gone if it is tombstoned or anything above it is. Deleting a group deletes
  // what's inside it, the way deleting a folder does — so one UPDATE on the group makes its whole
  // subtree disappear here, with no descendant walk at write time. Survivors form a closed forest
  // (a live list can never point at a dropped parent), since anything whose parent went went too.
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
