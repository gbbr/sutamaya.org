// Labels of the auto-managed, top-level lists a sutta is kept in for as long as it has
// highlights / a note (see UserDataContext's syncAutoList) — each is created on first use and
// deleted again once empty, and both are excluded from the user-editable "My lists" tree,
// rendered instead in TreePane's own "Automatic" section since they aren't user lists.
export const HIGHLIGHTS_LIST_LABEL = 'Highlights';
export const NOTES_LIST_LABEL = 'Notes';
export const AUTO_LIST_LABELS: readonly string[] = [HIGHLIGHTS_LIST_LABEL, NOTES_LIST_LABEL];
