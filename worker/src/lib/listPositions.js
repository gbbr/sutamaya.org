// Returns the `position` that appends after `positions` — their max plus one, or 0 for an empty
// parent.
export function nextPosition(positions) {
  return positions.reduce((max, p) => Math.max(max, p ?? 0), -1) + 1;
}

// Returns the `position` that prepends before `positions` — their min less one, or 0 for an empty
// parent. lib/writes.js's CREATE_LIST_SQL is this expression in SQL.
export function firstPosition(positions) {
  return positions.reduce((min, p) => Math.min(min, p ?? 0), 1) - 1;
}
