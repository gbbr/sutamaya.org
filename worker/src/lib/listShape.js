// Shapes one list row's raw field data into the response object sent to the client. Shared by
// routes/lists.js's serializeList and lib/userData.js's assembleUserData, so the two can't drift
// apart on a field rename.
export function shapeList(id, data) {
  return {
    id,
    label: data.label,
    parentId: data.parentId ?? null,
    kind: data.kind === 'group' ? 'group' : 'list',
    items: data.items || [],
  };
}
