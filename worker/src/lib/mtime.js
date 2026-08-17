// A2: `${ISO}|${deviceId}`. ISO 8601 is fixed-width, so lexicographic string comparison is
// chronological comparison in both SQLite TEXT and JavaScript `<`, which is what lets a
// conditional write compare a stored mtime against an incoming one with a plain `>`.
const SERVER_DEVICE_ID = 'server';

// Two writes from an old client — which never sends mtime — can land in the same millisecond
// (nothing throttles it; a bulk sibling reorder alone issues one INSERT/UPDATE per row). Without
// this guard, the second would generate a tying timestamp and its own conditional write would
// silently reject it as "not newer" — the exact loss this column exists to prevent, self-inflicted
// by the fallback generator. Same monotonic-clamp idea as A2's client-side guard, applied here to
// this worker instance's own clock instead of one device's.
let lastMs = 0;

function serverMtime() {
  const ms = Math.max(Date.now(), lastMs + 1);
  lastMs = ms;
  return `${new Date(ms).toISOString()}|${SERVER_DEVICE_ID}`;
}

// Comparison is lexicographic, so a stored value that sorts above every real ISO timestamp — a
// stray 'zzz', a wrong-shape id, anything starting past '9' — wins every conditional write from
// then on, and the row can never be updated again. A rejected write is a silent no-op by design
// (last-writer-wins has no loser to report), so that state is unrecoverable short of direct D1
// access. Validating the shape here is what keeps a malformed mtime from becoming permanent.
const MTIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\|.+$/;

// A write with no client-supplied mtime (every write from a client that predates offline sync)
// still needs a real, ordered value rather than the '' migration default, which would always
// lose a conflict.
export function resolveMtime(clientMtime) {
  return typeof clientMtime === 'string' && MTIME_PATTERN.test(clientMtime) ? clientMtime : serverMtime();
}
