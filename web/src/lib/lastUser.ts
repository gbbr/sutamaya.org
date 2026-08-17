import { LAST_USER_KEY } from './storageKeys';
import type { User } from './types';

// The last user the server confirmed a session for, remembered across reloads.
//
// Identity is the one thing the offline mirror can't answer for itself: it stores every list, note
// and highlight under a user id (lib/mirrorDb.ts), but only `GET /api/auth/me` ever said what that
// id is. Relaunching with no network — the PWA on a plane, which is the case this whole design
// exists for — left that fetch failing, `user` null, and the provider mounting an empty mirror over
// a full one: nothing to read, and nothing writable either.
//
// This is a cache of who was signed in, not a credential. The signed session cookie is still the
// only thing that authorizes anything, so the worst a stale entry does is show the user their own
// local data and queue writes that the next flush answers with a 401 — which is exactly the
// re-auth path (see UserDataContext's `needsReauth`).

function isUser(value: unknown): value is User {
  const u = value as Partial<User> | null;
  return !!u && typeof u.id === 'string' && !!u.id && typeof u.email === 'string';
}

export function readLastUser(): User | null {
  try {
    const raw = localStorage.getItem(LAST_USER_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isUser(parsed) ? parsed : null;
  } catch {
    // Unavailable or unparseable storage is simply no cached identity — the app falls back to
    // asking the server, which is what it did before this existed.
    return null;
  }
}

export function writeLastUser(user: User | null): void {
  try {
    if (user) localStorage.setItem(LAST_USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(LAST_USER_KEY);
  } catch {
    // ignore — a session that can't be remembered still works, it just can't start offline.
  }
}
