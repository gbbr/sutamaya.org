// Character caps for user-entered free text — shared by the list/list-group name inputs
// (ListRow, ListsTreeView, ListMembershipPicker) and the note editor (NoteEditor), plus
// UserDataContext's createList/renameList/submitNote, which enforce the same cap server-side of
// the UI so a truncation can't be bypassed by any caller that skips a capped <input>.
export const LIST_NAME_MAX_LENGTH = 50;
export const NOTE_MAX_LENGTH = 500;
