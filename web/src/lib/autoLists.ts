// The three auto-managed lists ("Recent", "Highlights", "Notes") are synthesized from the
// visited/highlights/notes records rather than stored as real `lists` rows, so a ListDef for one
// always carries `auto: true` and one of these fixed ids. Excluded from the user-editable "My
// lists" tree, rendered instead in TreePane's own "Automatic" section since they aren't user lists.
// The synthesis happens twice: client-side over the mirror (lib/mirrorView.ts, which is what the UI
// renders, so a sutta noted offline appears under "Notes" with no network) and server-side in
// assembleUserData() (worker/src/lib/userData.js), which still shapes the pull.
// The id string literals are duplicated in worker/src/lib/userData.js (no module shared between
// the two npm workspaces — see autoLists.test.ts, the tripwire that keeps them in sync) — keep
// both in sync if either ever changes.
export const RECENT_AUTO_LIST_ID = 'auto-recent';
export const HIGHLIGHTS_AUTO_LIST_ID = 'auto-highlights';
export const NOTES_AUTO_LIST_ID = 'auto-notes';

// membership[suttaId] entries (see worker/src/routes/data.js's buildUserData) are list ids, so
// telling an auto list apart from a real one is a plain id check against these fixed
// constants — no need to look anything up in `lists` first.
export const AUTO_LIST_IDS: ReadonlySet<string> = new Set([RECENT_AUTO_LIST_ID, HIGHLIGHTS_AUTO_LIST_ID, NOTES_AUTO_LIST_ID]);

// "Recent" is the last 20 suttas visited — its actual product definition, not just a rendering
// safeguard. Mirrors worker/src/lib/userData.js's RECENT_AUTO_LIST_CAP, since the same list is
// synthesized on both sides.
export const RECENT_AUTO_LIST_CAP = 20;
