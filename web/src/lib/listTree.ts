// The client half of the read-time tree repair (offline-sync.md's A3), ported from
// worker/src/lib/listTree.js — same algorithm, same order, so both halves produce the same tree
// from the same rows. It has to exist twice because the mirror is now the source of truth the UI
// renders from: a group deleted offline has to take its contents with it immediately, with no
// network, and that cascade is what expresses the delete. (There is no module shared between the
// two npm workspaces — the same duplication autoLists.ts already lives with.)
//
// Tombstoned rows are passed in rather than filtered out beforehand: the cascade needs to know
// which ancestors are dead in order to drop what hangs off them.

export interface TreeRow {
  id: string;
  parentId: string | null;
  position: number;
  mtime: string;
  deleted: boolean;
}

// Lowest (mtime, id) first. `id` breaks the tie so two rows written in the same millisecond still
// order identically on every device.
function olderFirst(a: TreeRow, b: TreeRow): number {
  if (a.mtime !== b.mtime) return a.mtime < b.mtime ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}

// Siblings render in `position` order; `id` breaks the tie, which the negative-prepend scheme
// (firstPosition in lib/mirror.ts) can genuinely produce — two devices each prepending offline
// both compute the same next position.
function bySiblingOrder(a: TreeRow, b: TreeRow): number {
  if (a.position !== b.position) return a.position - b.position;
  return a.id < b.id ? -1 : 1;
}

// Returns a new array of just the live, reachable rows — sorted, with any dangling `parentId`
// re-homed. Extra fields on each row pass through untouched.
export function repairListTree<T extends TreeRow>(lists: T[]): T[] {
  const byId = new Map(lists.map((list) => [list.id, list]));

  // Re-home danglers: a parentId pointing at no row *at all* becomes top-level. This is a safety
  // net, not delete semantics — a list whose parent simply hasn't been pulled yet would otherwise
  // exist but render nowhere. A parentId pointing at a *tombstoned* row is the different case the
  // cascade below handles.
  const parentOf = new Map<string, string | null>(
    lists.map((list) => [list.id, list.parentId && byId.has(list.parentId) ? list.parentId : null])
  );

  // Break cycles, before anything walks an ancestor chain — otherwise these walks never terminate.
  // Each row has at most one parent, so a walk up from any node enters at most one cycle: one break
  // per walk is enough, and walking from every node finds every cycle. Iterated in id order, and
  // the loser chosen as the global minimum of the cycle's members, so neither the input's order nor
  // which node the walk entered the cycle from can change the outcome.
  for (const { id } of [...lists].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const path: string[] = [];
    const seen = new Set<string>();
    let cur: string | null = id;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      path.push(cur);
      cur = parentOf.get(cur) ?? null;
    }
    if (!cur) continue; // reached the root — no cycle on this chain
    // `cur` is where the walk re-entered itself, so everything from there on is the cycle proper
    // (any nodes before it merely lead into it and stay put).
    const cycle = path.slice(path.indexOf(cur)).map((memberId) => byId.get(memberId)!);
    // The lowest mtime is re-homed, so the most recent move is the one that survives.
    const loser = cycle.reduce((lowest, candidate) => (olderFirst(candidate, lowest) < 0 ? candidate : lowest));
    parentOf.set(loser.id, null);
  }

  // Cascade: a list is gone if it is tombstoned or anything above it is. Deleting a group deletes
  // what's inside it, the way deleting a folder does. Survivors form a closed forest (a live list
  // can never point at a dropped parent), since anything whose parent went went too.
  const survives = (id: string): boolean => {
    let cur: string | null = id;
    while (cur) {
      if (byId.get(cur)!.deleted) return false;
      cur = parentOf.get(cur) ?? null;
    }
    return true;
  };

  return lists
    .filter((list) => survives(list.id))
    .map((list) => ({ ...list, parentId: parentOf.get(list.id) ?? null }))
    .sort(bySiblingOrder);
}
