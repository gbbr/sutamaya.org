// The three auto-managed lists ("Recent", "Highlights", "Notes") are synthesized server-side in
// buildUserData() (server/src/routes/data.js) from the visited/highlights/notes collections —
// never stored as real `lists` docs, so a ListDef for one always carries `auto: true` and one of
// these fixed ids. Excluded from the user-editable "My lists" tree, rendered instead in
// TreePane's own "Automatic" section since they aren't user lists.
// The id string literals are duplicated in server/src/routes/data.js (no module shared between
// the two npm workspaces) — keep both in sync if either ever changes.
export const RECENT_AUTO_LIST_ID = 'auto-recent';
export const HIGHLIGHTS_AUTO_LIST_ID = 'auto-highlights';
export const NOTES_AUTO_LIST_ID = 'auto-notes';

// membership[suttaId] entries (see server/src/routes/data.js's buildUserData) are list ids, so
// telling an auto list apart from a real one is a plain id check against these fixed
// constants — no need to look anything up in `lists` first.
export const AUTO_LIST_IDS: ReadonlySet<string> = new Set([RECENT_AUTO_LIST_ID, HIGHLIGHTS_AUTO_LIST_ID, NOTES_AUTO_LIST_ID]);

// Mirrors server/src/lib/userData.js's RECENT_AUTO_LIST_CAP — needed client-side so markVisited
// (UserDataContext) can keep the "Recent" list's optimistic local update capped the same way the
// server caps it, rather than growing unbounded until the next full sync.
export const RECENT_AUTO_LIST_CAP = 20;
