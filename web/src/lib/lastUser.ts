import { LAST_USER_KEY } from './storageKeys';
import type { User } from './types';

// The last user the server confirmed a session for, remembered across reloads.
//
// Identity is the one thing the offline mirror can't answer for itself: it files every list, note
// and highlight under a user id (lib/mirrorDb.ts), but only `GET /api/auth/me` says what that id
// is. Without this, relaunching with no network — the PWA on a plane — leaves that fetch failing,
// `user` null, and the provider mounting an empty mirror over a full one.
//
// A cache of who was signed in, not a credential. The signed session cookie is still the only
// thing that authorizes anything, so a stale entry at worst shows the user their own local data and
// queues writes the next flush answers with a 401 — the re-auth path (UserDataContext's
// `needsReauth`).

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
    // Unavailable or unparseable storage is simply no cached identity — the app asks the server.
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
