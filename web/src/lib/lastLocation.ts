import { globalHistory } from '@reach/router';
import { LAST_LOCATION_KEY } from './storageKeys';

// Lets `/` — a fresh tab, or a PWA relaunched from its home-screen icon — restore whatever screen
// the user was last on instead of bouncing to /browse/dn. `globalHistory.listen` sees every
// navigate() call in the app, so this needs no per-page wiring.

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
