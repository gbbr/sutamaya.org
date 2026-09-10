import { LAST_LOCATION_KEY } from './storageKeys';

// The last screen the reader was on, which "/" restores — a fresh tab, or a relaunch from the
// home-screen icon. The app shell hands it every location the app shows (App.tsx), so no page
// wires this up itself.

const VALID_PATH = /^\/browse\/[^/]+(\/[^/]*)?$|^\/read\/[^/]+$/;

/** Stores `pathname` as the location "/" restores, where it is one that can be restored. */
export function rememberLocation(pathname: string) {
  // Only store a location `getLastLocation()` would accept, so a bogus URL can't clobber a valid
  // one with something the read side then rejects. Settings is excluded so reopening the app
  // doesn't land back in it; bare '/browse' fails VALID_PATH, which is right — it's the first-visit
  // screen with nothing selected, so there's no location there to come back to.
  if (!VALID_PATH.test(pathname) || pathname.startsWith('/settings')) return;
  try {
    localStorage.setItem(LAST_LOCATION_KEY, pathname);
  } catch {
    // storage unavailable/quota exceeded — nothing to fall back to, just skip this write
  }
}

export function getLastLocation(): string | null {
  try {
    const stored = localStorage.getItem(LAST_LOCATION_KEY);
    if (stored && VALID_PATH.test(stored)) return stored;
  } catch {
    // storage unavailable — fall through to null
  }
  return null;
}
