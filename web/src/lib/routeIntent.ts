// Router `location.state` set by navigate() survives a same-tab hard refresh — the browser keeps
// history.state for the current entry across a reload — but a manual change made *after* that
// navigate() (e.g. flipping a toggle by hand) has no way to invalidate it, so a refresh can
// resurrect a now-stale value and silently override what the user just did (e.g. a mobile pane
// switch reverting itself on refresh, in TreePane/LibraryPage's own pane-toggle sync).
//
// A navigate() call carrying a one-shot "do this on arrival" value tags it with a fresh id
// (tagIntent); the one mount meant to consume it does so exactly once via consumeIntent, which
// remembers the last-consumed id in sessionStorage (survives a refresh, unlike an in-memory flag,
// but starts empty on a genuinely new tab/session). A second consumeIntent() call for the same id
// — exactly what a stale-but-preserved history.state produces on refresh — returns null, so the
// caller falls back to persisted preference instead of trusting the stale value.
export interface RouteIntent {
  navId: string;
  [key: string]: unknown;
}

// crypto.randomUUID() only exists in secure contexts (https, or http on localhost) — plain
// http on a LAN IP (e.g. opening the dev server from a phone) has no crypto.randomUUID, and
// calling it throws before navigate() ever runs, silently breaking every caller (the reader's
// close button among them). Fall back to a non-cryptographic id; navId only needs to be unique
// enough to distinguish one navigate() call from the next, not unguessable.
function freshNavId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function tagIntent<T extends object>(state: T): T & RouteIntent {
  return { ...state, navId: freshNavId() };
}

export function consumeIntent<T extends RouteIntent>(state: T | null | undefined, storageKey: string): T | null {
  if (!state?.navId) return null;
  try {
    if (sessionStorage.getItem(storageKey) === state.navId) return null;
    sessionStorage.setItem(storageKey, state.navId);
  } catch {
    // sessionStorage unavailable — best effort, treat the intent as fresh rather than losing it
  }
  return state;
}
