import { globalHistory } from '@reach/router';
import { LAST_LOCATION_KEY } from './storageKeys';

// Lets `/` (a fresh tab, or a PWA relaunched from the home-screen icon — both land on the bare
// origin) restore whatever screen the user was last on, instead of always bouncing to
// /browse/dn. `globalHistory.listen` sees every navigate() call anywhere in the app for free
// (they all funnel through this same shared history object), so this needs no per-page wiring.

const VALID_PATH = /^\/browse\/[^/]+(\/[^/]*)?$|^\/read\/[^/]+$/;

function maybePersist(pathname: string) {
  // Only ever overwrite the stored location with another one `getLastLocation()` would actually
  // return — otherwise a bogus URL (a stale/typo'd link, anything landing on NotFoundPage) would
  // clobber a genuinely valid last location with one `getLastLocation()`'s own VALID_PATH check
  // immediately rejects on read, losing the real one instead of falling back to it. '/' itself is
  // a transient bounce-off (about to be redirected away from) and would fail VALID_PATH anyway;
  // Settings is deliberately excluded so reopening the app doesn't land back in it. Bare '/browse'
  // fails VALID_PATH too, which is right: it's the first-visit screen with nothing selected, so
  // there's no location there to come back to — reopening should just show it again.
  if (!VALID_PATH.test(pathname) || pathname.startsWith('/settings')) return;
  try {
    localStorage.setItem(LAST_LOCATION_KEY, pathname);
  } catch {
    // storage unavailable/quota exceeded — nothing to fall back to, just skip this write
  }
}

function trackLastLocation() {
  // `listen` only fires on *future* navigations, not the page's current location at the time of
  // subscription — so a direct/bookmarked load (e.g. /browse/sn5, typed or opened straight from a
  // link) needs its own capture here too, or closing the tab without any further in-app
  // navigation would silently leave the previous session's last location in place instead.
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
