import { globalHistory } from '@reach/router';
import { LAST_LOCATION_KEY } from './storageKeys';

// The last screen the reader was on, which "/" restores — a fresh tab, or a relaunch from the
// home-screen icon. `globalHistory.listen` sees every navigate() in the app, so no page wires this
// up itself.

const VALID_PATH = /^\/browse\/[^/]+(\/[^/]*)?$|^\/read\/[^/]+$/;

function maybePersist(pathname: string) {
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

function trackLastLocation() {
  // `listen` only fires on future navigations, not the location subscribed at — so a direct or
  // bookmarked load needs its own capture here.
  maybePersist(globalHistory.location.pathname);
  globalHistory.listen(({ location }) => maybePersist(location.pathname));
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

trackLastLocation();
