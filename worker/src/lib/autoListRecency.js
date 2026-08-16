// Dedupes `entries` by id keeping each one's most recent `at`, sorts descending by `at`, and
// caps to `limit` — shared by the auto-highlights/auto-notes list synthesis in routes/data.js so
// those lists (and the DOM rows ListPane renders for them, unvirtualized) can't grow unbounded.
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
