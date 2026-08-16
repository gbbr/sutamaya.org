// Shapes one list doc's raw Firestore field data into the response object sent to the client —
// shared by routes/lists.js's serializeList (GET /api/lists) and lib/userData.js's
// assembleUserData (GET /api/data), which otherwise computed the identical shape independently
// and could silently drift apart on a field rename.
export function shapeList(id, data) {
  return {
    id,
    label: data.label,
    parentId: data.parentId ?? null,
    kind: data.kind === 'group' ? 'group' : 'list',
    items: data.items || [],
  };
}
