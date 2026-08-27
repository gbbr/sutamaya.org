// One-shot "do this on arrival" values carried in router `location.state`.
//
// history.state survives a same-tab hard refresh, and a manual change made after the navigate()
// can't invalidate it — so a refresh would otherwise resurrect a stale value and override what the
// user just did (a mobile pane switch reverting itself, in TreePane/LibraryPage's pane-toggle
// sync). tagIntent stamps the state with a fresh id; consumeIntent hands it back exactly once,
// recording the last-consumed id in sessionStorage — which survives a refresh but starts empty in
// a new tab. A second call for the same id returns null, so the caller falls back to persisted
// preference.
import { randomId } from './ids';

export interface RouteIntent {
  navId: string;
  [key: string]: unknown;
}

export function tagIntent<T extends object>(state: T): T & RouteIntent {
  // randomId() rather than crypto.randomUUID(), which throws outside a secure context — before
  // navigate() ever runs. See lib/ids.ts.
  return { ...state, navId: randomId() };
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
