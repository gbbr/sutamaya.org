import { NavigationType } from 'react-router';

// How the app arrived at the location it is showing, which is what the reader consults to decide
// whether to resume a scroll position or open at the top, and the library tree whether to reveal
// the node an address names.
//
// A return is the reader coming back somewhere they already were: back or forward, a refresh, a
// bookmarked load, the app relaunching into its last location. A fresh entry is them choosing this
// destination now — a library row, a search hit, Prev/Next — which opens at the top, the way
// following a link does. The library panes never ask about their scroll: a group or list opens at
// the top when picked there, and restores otherwise.

/**
 * The router state a redirect carries when it finishes a load the reader already started — "/"
 * restoring the last location, a bare-uid link resolving to /read/:id. The redirect makes a
 * history entry of its own, which would otherwise read as a fresh one.
 */
export const RETURN_STATE = { returning: true } as const;

/**
 * Whether the location on screen was arrived at by return, from the router's navigation type and
 * the state the location carries. A page load is a POP, so it counts as one.
 */
export function enteredByReturn(navigationType: NavigationType, state: unknown): boolean {
  return navigationType === NavigationType.Pop || (state as { returning?: boolean } | null)?.returning === true;
}

// Whether the page load's arrival has been taken.
let pageLoadTaken = false;

/**
 * takeAddressArrival returns whether the location on screen is the one the page loaded on by
 * opening its address — typed, pasted, bookmarked or followed from another site — rather than by a
 * refresh, Back or Forward. Only the first call can return true, so coming back to that location
 * later in the same visit is a return.
 */
export function takeAddressArrival(
  // The router location's key, "default" for the location the page loaded on.
  locationKey: string
): boolean {
  if (pageLoadTaken) return false;
  pageLoadTaken = true;
  if (locationKey !== 'default') return false;
  try {
    const load = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return load?.type === 'navigate';
  } catch {
    // No navigation timing to tell an address from a refresh by, so a return.
    return false;
  }
}
