import { randomId } from './ids';
import { DEVICE_ID_KEY } from './storageKeys';

// `${ISO}|${deviceId}` — the timestamp every mutable write carries, and the whole of this app's
// conflict resolution: the server stores a write only when its mtime is strictly newer than the
// row's (docs/offline-sync.md's A2). ISO 8601 is fixed-width, so lexicographic comparison is
// chronological comparison in both SQLite TEXT and JavaScript `<`. It is stamped when the user
// acts, not when the write reaches the network, so a note edited offline on Monday and flushed on
// Friday still loses to a Wednesday edit made elsewhere.

// This device's id, cached for the session.
let cachedDeviceId: string | null = null;

// A random per-device id, persisted, which breaks a tie between two devices writing in the same
// millisecond so the outcome doesn't depend on arrival order.
function deviceId(): string {
  if (cachedDeviceId) return cachedDeviceId;
  let id: string | null = null;
  try {
    id = localStorage.getItem(DEVICE_ID_KEY);
  } catch {
    // A fresh id is still a valid tiebreak for the life of this page.
  }
  if (!id) {
    id = randomId();
    try {
      localStorage.setItem(DEVICE_ID_KEY, id);
    } catch {
      // ignore
    }
  }
  cachedDeviceId = id;
  return id;
}

// The last millisecond this device stamped a write with. Clamping against it keeps a backwards
// clock adjustment from sorting below this device's own earlier write, and keeps two writes out of
// one millisecond, where they would tie and a tie loses a conditional write.
let lastMs = 0;

// The mtime for a write happening now.
export function nextMtime(): string {
  const ms = Math.max(Date.now(), lastMs + 1);
  lastMs = ms;
  return `${new Date(ms).toISOString()}|${deviceId()}`;
}
