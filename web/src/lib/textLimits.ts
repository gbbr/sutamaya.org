// Character caps for user-entered free text, shared by the name inputs (ListRow, ListsTreeView,
// ListMembershipPicker), NoteEditor, and UserDataContext's createList/renameList/submitNote, which
// enforce the same cap for callers that skip a capped <input>.
export const LIST_NAME_MAX_LENGTH = 50;
export const NOTE_MAX_LENGTH = 500;
