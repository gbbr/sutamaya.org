import { randomId } from './ids';
import { DEVICE_ID_KEY } from './storageKeys';

// `${ISO}|${deviceId}` — the timestamp every mutable write carries, and the whole of this app's
// conflict resolution: the server stores a write only when its mtime is strictly newer than the
// stored one (worker/src/lib/mtime.js, docs/offline-sync.md's A2). ISO 8601 is fixed-width, so
// lexicographic comparison is chronological comparison in both SQLite TEXT and JavaScript `<`.
//
// Stamp it when the user acts, not when the write reaches the network: a note edited offline on
// Monday and flushed on Friday has to lose to a Wednesday edit made elsewhere.

// Random, per-device, persisted. Breaks a tie between two devices writing in the same millisecond,
// so the outcome is deterministic rather than decided by arrival order.
let cachedDeviceId: string | null = null;

function deviceId(): string {
  if (cachedDeviceId) return cachedDeviceId;
  let id: string | null = null;
  try {
    id = localStorage.getItem(DEVICE_ID_KEY);
  } catch {
    // storage unavailable — a fresh id is still a valid tiebreak for the life of this page
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
// clock adjustment from sorting below this device's own previous write, and keeps two writes out
// of the same millisecond — they would tie, and a tie loses a conditional write.
let lastMs = 0;

export function nextMtime(): string {
  const ms = Math.max(Date.now(), lastMs + 1);
  lastMs = ms;
  return `${new Date(ms).toISOString()}|${deviceId()}`;
}
