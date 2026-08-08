// A ListGroup can hold other lists/groups; a plain list can't hold anything — so any non-null
// parentId, for either kind of doc, must point at an existing group. `doc` is a Firestore
// DocumentSnapshot-shaped object ({exists, data()}) for the candidate parent. Returns an error
// message string if invalid, or null if the parent checks out (including the top-level `null`
// parentId case, where `doc` is never even fetched — see routes/lists.js's invalidParentReason).
export function invalidParentReasonForDoc(doc) {
  if (!doc.exists) return 'Parent not found.';
  if (doc.data().kind !== 'group') return 'Only a group can contain other lists.';
  return null;
}

// True if setting `movingId`'s parent to `parentId` would create a cycle — either directly (a
// list set as its own parent) or by moving it underneath one of its own descendants, which would
// make one of `movingId`'s current ancestors end up nested under `movingId` itself. `allLists`
// is every list doc for this user as plain {id, parentId} pairs (cheap at personal scale — same
// assumption the rest of this file already makes), enough to walk the chain in memory without
// further Firestore round trips. The client's own drag-and-drop (useListTreeDrag's isDescendant)
// already avoids this in the normal case; this is the server-side backstop for a stale/racing or
// buggy request that reaches routes/lists.js directly.
export function wouldCreateCycle(movingId, parentId, allLists) {
  if (!parentId) return false;
  if (parentId === movingId) return true;
  const byId = new Map(allLists.map((l) => [l.id, l]));
  let cur = byId.get(parentId);
  while (cur?.parentId) {
    if (cur.parentId === movingId) return true;
    cur = byId.get(cur.parentId);
  }
  return false;
}
