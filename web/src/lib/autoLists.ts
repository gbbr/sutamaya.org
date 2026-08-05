// The two auto-managed lists ("Highlights", "Notes") are synthesized server-side in
// buildUserData() (server/src/routes/data.js) from the highlights/notes collections — never
// stored as real `lists` docs, so a ListDef for one always carries `auto: true` and one of
// these fixed ids. Excluded from the user-editable "My lists" tree, rendered instead in
// TreePane's own "Automatic" section since they aren't user lists.
// The id string literals are duplicated in server/src/routes/data.js (no module shared between
// the two npm workspaces) — keep both in sync if either ever changes.
export const HIGHLIGHTS_AUTO_LIST_ID = 'auto-highlights';
export const NOTES_AUTO_LIST_ID = 'auto-notes';
export const HIGHLIGHTS_LIST_LABEL = 'Highlights';
export const NOTES_LIST_LABEL = 'Notes';
