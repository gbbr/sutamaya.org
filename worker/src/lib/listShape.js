// Returns one list row as the object sent to the client.
export function shapeList(id, data) {
  return {
    id,
    label: data.label,
    parentId: data.parentId ?? null,
    kind: data.kind === 'group' ? 'group' : 'list',
    items: data.items || [],
  };
}
