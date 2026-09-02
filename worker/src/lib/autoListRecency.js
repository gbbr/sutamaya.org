// Returns at most `limit` ids from `entries`, deduped on each id's most recent `at` and ordered
// most recent first. The three auto-lists are built with it.
export function latestIds(entries, limit) {
  const mostRecent = new Map();
  entries.forEach(({ id, at }) => {
    const prev = mostRecent.get(id);
    if (prev === undefined || at > prev) mostRecent.set(id, at);
  });
  return [...mostRecent.entries()]
    .sort((a, b) => (a[1] < b[1] ? 1 : -1))
    .slice(0, limit)
    .map(([id]) => id);
}
