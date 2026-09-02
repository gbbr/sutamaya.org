// The client half of the read-time list-tree repair (docs/offline-sync.md's A3), a port of
// worker/src/lib/listTree.js — same algorithm and order, so both halves build the same tree from
// the same rows. It exists twice because the mirror is what the UI renders from, and a group
// deleted offline has to take its contents with it at once, with no network. Tombstoned rows are
// passed in rather than filtered out first: the cascade needs to know which ancestors are dead.

export interface TreeRow {
  id: string;
  parentId: string | null;
  position: number;
  mtime: string;
  deleted: boolean;
}

// Lowest (mtime, id) first, `id` breaking a same-millisecond tie identically on every device.
function olderFirst(a: TreeRow, b: TreeRow): number {
  if (a.mtime !== b.mtime) return a.mtime < b.mtime ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}

// Siblings in `position` order, `id` breaking the tie two devices prepending offline both produce.
function bySiblingOrder(a: TreeRow, b: TreeRow): number {
  if (a.position !== b.position) return a.position - b.position;
  return a.id < b.id ? -1 : 1;
}

// Returns a new array of just the live, reachable rows — sorted, with any dangling `parentId`
// re-homed. Extra fields on each row pass through untouched.
export function repairListTree<T extends TreeRow>(lists: T[]): T[] {
  const byId = new Map(lists.map((list) => [list.id, list]));

  // Each row's parent, with a parentId naming no row at all re-homed to the top level — a safety
  // net for a parent not yet pulled, which would otherwise exist but render nowhere. A parentId
  // naming a tombstoned row is the cascade's business below.
  const parentOf = new Map<string, string | null>(
    lists.map((list) => [list.id, list.parentId && byId.has(list.parentId) ? list.parentId : null])
  );

  // Break every cycle, before anything walks an ancestor chain. A row has at most one parent, so a
  // walk up from any node enters at most one cycle, and walking from every node finds them all.
  // Iterated in id order with the loser taken as the cycle's global minimum, so neither the input
  // order nor where the walk entered changes the outcome.
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
    // The walk re-entered itself at `cur`, so the cycle proper is everything from there on;
    // anything before it merely leads in and stays put.
    const cycle = path.slice(path.indexOf(cur)).map((memberId) => byId.get(memberId)!);
    // The lowest mtime is re-homed, so the most recent move is the one that survives.
    const loser = cycle.reduce((lowest, candidate) => (olderFirst(candidate, lowest) < 0 ? candidate : lowest));
    parentOf.set(loser.id, null);
  }

  // True while neither this row nor anything above it is tombstoned — deleting a group deletes
  // what is inside it, as deleting a folder does. The survivors form a closed forest.
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
