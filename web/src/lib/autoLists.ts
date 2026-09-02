// The three auto-managed lists — "Visited", "Highlights", "Notes" — synthesized from the records
// they describe rather than stored as rows, so a ListDef for one always carries `auto: true` and a
// fixed id. They render in TreePane's "Activity" section rather than the editable "My lists" tree.
//
// The synthesis happens twice, client-side over the mirror (lib/mirrorView.ts) so a sutta noted
// offline still appears, and server-side in assembleUserData(). These ids and caps are duplicated
// in worker/src/lib/userData.js, the two workspaces sharing no modules, and autoLists.test.ts is
// the tripwire that fails when one side moves alone.
export const RECENT_AUTO_LIST_ID = 'auto-recent';
export const HIGHLIGHTS_AUTO_LIST_ID = 'auto-highlights';
export const NOTES_AUTO_LIST_ID = 'auto-notes';

// The three ids, so an auto list can be told from a real one without a lookup in `lists`.
export const AUTO_LIST_IDS: ReadonlySet<string> = new Set([RECENT_AUTO_LIST_ID, HIGHLIGHTS_AUTO_LIST_ID, NOTES_AUTO_LIST_ID]);

// How many suttas the Highlights and Notes lists hold.
export const AUTO_LIST_CAP = 300;

// How many the Visited list holds, lower than the other two: it is a recency list rather than a
// record of the reader's own work, so nothing is lost when a visit falls off the end.
export const VISITED_AUTO_LIST_CAP = 100;
