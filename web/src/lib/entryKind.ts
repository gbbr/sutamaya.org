import { NavigationType } from 'react-router';

// How the app arrived at the location it is showing, which is what the reader consults to decide
// whether to resume a scroll position or open at the top.
//
// A return is the reader coming back somewhere they already were: back or forward, a refresh, a
// bookmarked load, the app relaunching into its last location. A fresh entry is them choosing this
// destination now — a library row, a search hit, Prev/Next — which opens at the top, the way
// following a link does. The library panes restore unconditionally and never ask.

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
