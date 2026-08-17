import { randomId } from './ids';
import { DEVICE_ID_KEY } from './storageKeys';

// `${ISO}|${deviceId}` — the timestamp every mutable write carries, and the whole of this app's
// conflict resolution: the server stores a write only when its mtime is strictly newer than the
// stored one (see worker/src/lib/mtime.js and offline-sync.md's A2/A3). ISO 8601 is fixed-width,
// so plain lexicographic comparison is chronological comparison in both SQLite TEXT and
// JavaScript `<`, with no parsing anywhere.
//
// Stamp it when the user acts, not when the write reaches the network. That distinction is the
// entire point: a note edited offline on Monday and flushed on Friday has to lose to a Wednesday
// edit made elsewhere, which it only does if it still carries Monday's timestamp.

// Random, per-device, persisted. It only ever breaks a tie between two devices writing in the
// same millisecond, so the outcome is decided deterministically rather than by arrival order.
let cachedDeviceId: string | null = null;

function deviceId(): string {
  if (cachedDeviceId) return cachedDeviceId;
  let id: string | null = null;
  try {
    id = localStorage.getItem(DEVICE_ID_KEY);
  } catch {
    // storage unavailable — fall through to a fresh id, which is still a valid tiebreak for the
    // life of this page.
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

// The last millisecond this device stamped a write with. Clamping against it guards two things:
// a backwards clock adjustment producing a timestamp that sorts below this device's own previous
// write, and two writes landing in the same millisecond — which would tie, and a tie loses a
// conditional write.
let lastMs = 0;

export function nextMtime(): string {
  const ms = Math.max(Date.now(), lastMs + 1);
  lastMs = ms;
  return `${new Date(ms).toISOString()}|${deviceId()}`;
}
