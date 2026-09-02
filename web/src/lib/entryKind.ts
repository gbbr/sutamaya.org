import { globalHistory } from '@reach/router';

// How the app arrived at the location it is showing, which is what the reader consults to decide
// whether to resume a scroll position or open at the top.
//
// A return is the reader coming back somewhere they already were: back or forward, a refresh, a
// bookmarked load, the app relaunching into its last location. A fresh entry is them choosing this
// destination now — a library row, a search hit, Prev/Next — which opens at the top, the way
// following a link does. The library panes restore unconditionally and never ask.

// True while the current location was arrived at by return; the first load counts as one.
let returned = true;
let nextIsReturn = false;

// Marks the next navigate() as a return despite being a fresh history entry, for a redirect that
// continues a load the reader already started. @reach/router reports every navigate() as "PUSH",
// `replace: true` included, so nothing in the navigation itself tells them apart.
export function markReturnNavigation() {
  nextIsReturn = true;
}

// True when the location on screen was arrived at by return.
export function enteredByReturn() {
  return returned;
}

globalHistory.listen(({ action }) => {
  returned = action === 'POP' || nextIsReturn;
  nextIsReturn = false;
});
