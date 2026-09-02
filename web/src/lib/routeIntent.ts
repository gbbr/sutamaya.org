// One-shot "do this on arrival" values carried in router `location.state`, which survives a
// same-tab refresh and would otherwise resurrect a stale value over whatever the reader has done
// since. Each is stamped with a fresh id and handed back exactly once, the last-consumed id living
// in sessionStorage — which survives a refresh but starts empty in a new tab.
import { randomId } from './ids';

export interface RouteIntent {
  navId: string;
  [key: string]: unknown;
}

// Stamps router state with a fresh id, making it a one-shot intent.
export function tagIntent<T extends object>(state: T): T & RouteIntent {
  // randomId() rather than crypto.randomUUID(), which throws outside a secure context.
  return { ...state, navId: randomId() };
}

// Returns the intent the first time it is asked for, and null on every later call for the same id.
export function consumeIntent<T extends RouteIntent>(state: T | null | undefined, storageKey: string): T | null {
  if (!state?.navId) return null;
  try {
    if (sessionStorage.getItem(storageKey) === state.navId) return null;
    sessionStorage.setItem(storageKey, state.navId);
  } catch {
    // sessionStorage unavailable: treat the intent as fresh rather than losing it.
  }
  return state;
}
