import { useEffect, useRef } from 'react';
import { prefsApi } from '../lib/api';

// Debounced one-way save of local prefs up to a signed-in user's profile (server), plus a
// one-time restore-into-local-state merge whenever a signed-in user with saved server prefs
// shows up (sign-in, or already-signed-in on page load). Shared by ReaderPrefsContext and
// UiPrefsContext — `slot` is which half of `users/{uid}.prefs` this call owns ('reader' or
// 'ui'), so the two contexts' independent saves never clobber each other's half (see the
// server's dot-path `.update()` in routes/prefs.js).
export function useProfileSyncedPrefs<T extends object>(
  slot: 'reader' | 'ui',
  userId: string | undefined,
  serverValue: Partial<T> | undefined,
  prefs: T,
  setPrefs: (updater: (p: T) => T) => void
) {
  // Tracks which signed-in user's server value has already been merged in, so this only fires
  // once per sign-in — not on every render, and not every time `prefs` itself changes (which
  // would otherwise re-apply the *stale* server snapshot over a value the user just edited).
  const appliedForUserRef = useRef<string | undefined>(undefined);
  // Set right before a server-restore merge so the save effect below skips the one save that
  // would otherwise immediately follow it — that save would just be writing the server's own
  // value straight back, a harmless but pointless extra request.
  const skipNextSaveRef = useRef(false);

  useEffect(() => {
    if (!userId || !serverValue || appliedForUserRef.current === userId) return;
    appliedForUserRef.current = userId;
    skipNextSaveRef.current = true;
    setPrefs((p) => ({ ...p, ...serverValue }));
  }, [userId, serverValue, setPrefs]);

  useEffect(() => {
    if (!userId) return;
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    // Debounced — a slider (font size, line height, UI scale) fires this on every drag tick
    // otherwise, which would mean a request per pixel of movement instead of one after the user
    // settles on a value.
    const timer = window.setTimeout(() => {
      prefsApi.save({ [slot]: prefs }).catch((e) => console.error(`save ${slot} prefs failed`, e));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [slot, userId, prefs]);
}
