// Returns one list row as the object sent to the client. Shared by routes/lists.js and
// lib/userData.js, so the two can't drift apart.
export function shapeList(id, data) {
  return {
    id,
    label: data.label,
    parentId: data.parentId ?? null,
    kind: data.kind === 'group' ? 'group' : 'list',
    items: data.items || [],
  };
}
