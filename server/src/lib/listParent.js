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
