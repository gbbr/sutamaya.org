import { globalHistory } from '@reach/router';

// How the app arrived at the location it's currently showing.
//
// A *return* is the user coming back to somewhere they already were: browser/OS back or forward
// (including iOS' swipe-back gesture), a refresh or a bookmarked load, and the app relaunching
// into its last location. Picking up exactly where they left off is the whole point of those.
//
// A *fresh* entry is the user choosing this destination now: tapping a row in the library, a
// search hit, Prev/Next in the reader. Those should start at the top of the document, the way
// following a link in a browser does — restoring a half-scrolled position there lands the reader
// in the middle of a sutta they didn't ask to resume.
//
// Only the reader consults this (see ReaderPage); the library panes restore their scroll
// unconditionally, since a pane is a place you keep coming back to rather than something you read
// through.

let returned = true; // the very first load of the app is a return by this definition
let nextIsReturn = false;

// Marks the *next* navigate() as a return even though it's a fresh history entry. For the two
// redirects that continue the load the user already started ("/" restoring the last location, and
// a bare-uid link resolving to /read/:id — both in App.tsx) rather than choosing a new place to
// go. @reach/router reports every navigate() as "PUSH", `replace: true` included, so there's
// nothing in the navigation itself to tell those apart from a real one.
export function markReturnNavigation() {
  nextIsReturn = true;
}

export function enteredByReturn() {
  return returned;
}

globalHistory.listen(({ action }) => {
  returned = action === 'POP' || nextIsReturn;
  nextIsReturn = false;
});
