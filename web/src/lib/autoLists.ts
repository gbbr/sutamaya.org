// The three auto-managed lists ("Visited", "Highlights", "Notes") are synthesized from the
// visited/highlights/notes records rather than stored as real `lists` rows, so a ListDef for one
// always carries `auto: true` and one of these fixed ids. They are excluded from the user-editable
// "My lists" tree and rendered in TreePane's "Activity" section instead.
//
// The synthesis happens twice: client-side over the mirror (lib/mirrorView.ts, what the UI renders,
// so a sutta noted offline appears under "Notes" with no network) and server-side in
// assembleUserData() (worker/src/lib/userData.js), which shapes the pull. The id literals are
// duplicated in worker/src/lib/userData.js — no module is shared between the two npm workspaces,
// and autoLists.test.ts is the tripwire that keeps them in sync.
export const RECENT_AUTO_LIST_ID = 'auto-recent';
export const HIGHLIGHTS_AUTO_LIST_ID = 'auto-highlights';
export const NOTES_AUTO_LIST_ID = 'auto-notes';

// membership[suttaId] entries are list ids, so telling an auto list apart from a real one is a
// plain id check against these constants — nothing has to be looked up in `lists` first.
export const AUTO_LIST_IDS: ReadonlySet<string> = new Set([RECENT_AUTO_LIST_ID, HIGHLIGHTS_AUTO_LIST_ID, NOTES_AUTO_LIST_ID]);

// How many suttas the Highlights and Notes lists hold. These are the reader's own work, so the cap
// is set where it stops mattering rather than where it starts to pinch: a reader with notes in 300
// separate suttas is already an outlier, and the whole canon of highlights is not a list anyone
// scrolls. It bounds the render — ListPane draws every item as an unvirtualized DOM row — and the
// figure is chosen against Thag, the 264-row list the app already ships, so a full auto-list costs
// no more than a collection page that has never been a problem.
//
// Mirrors worker/src/lib/userData.js, since both sides synthesize the same lists and a device would
// otherwise show a different length before and after a sync; autoLists.test.ts is the tripwire.
export const AUTO_LIST_CAP = 300;

// Visited is capped lower, and alone among the three. It is a recency list rather than a record: a
// year of daily reading runs to thousands of visits, nobody reaches for the six-hundredth most
// recent one, and unlike a note or a highlight nothing is the reader's to lose when it falls off
// the end.
export const VISITED_AUTO_LIST_CAP = 100;
