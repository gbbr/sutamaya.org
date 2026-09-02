// An mtime is `${ISO}|${deviceId}` (docs/offline-sync.md, mechanism 2). ISO 8601 is fixed-width,
// so every conditional write compares stored against incoming with a plain string `>`.

// The device id on an mtime this Worker mints.
const SERVER_DEVICE_ID = 'server';

// The last millisecond stamped, clamping the clock forward so two writes in one millisecond can't
// tie — a tie its own conditional write would reject as not newer.
let lastMs = 0;

// Returns a fresh mtime stamped by this Worker.
function serverMtime() {
  const ms = Math.max(Date.now(), lastMs + 1);
  lastMs = ms;
  return `${new Date(ms).toISOString()}|${SERVER_DEVICE_ID}`;
}

// The shape a stored mtime must have. Comparison being lexicographic, a value sorting above every
// real timestamp would win every conditional write and freeze the row for good.
const MTIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\|.+$/;

// Returns the client's mtime if it is well-formed, else a fresh server one.
export function resolveMtime(clientMtime) {
  return typeof clientMtime === 'string' && MTIME_PATTERN.test(clientMtime) ? clientMtime : serverMtime();
}
