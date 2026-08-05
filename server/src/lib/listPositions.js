// Next sibling `position` to append after — the max of `positions` plus one, or 0 for an empty
// group. Shared by list creation (append to the end of the target parent's children) and
// delete-reparenting (append re-parented children after the new parent's existing children,
// instead of leaving their stale positions to collide with the new siblings').
export function nextPosition(positions) {
  return positions.reduce((max, p) => Math.max(max, p ?? 0), -1) + 1;
}
