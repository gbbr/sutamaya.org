// Reconciles a client-submitted sibling order against the parent's current stored children — used
// by PUT /order (routes/lists.js), the sibling-order counterpart of lib/listItemOrder.js.
//
// Reconciling rather than writing the posted `order` as-is is what makes that route safe to replay
// from an offline queue: a reorder made an hour ago and flushed now would otherwise drop a list
// another device created in this parent since — it isn't in the posted order, so it would keep a
// stale position among rows renumbered around it — and resurrect the position of one deleted since.
//
// `order` may legitimately name a list that is *not* currently a child of this parent — that is a
// cross-parent drop, and moving it in is the whole point — so an id is dropped only when it doesn't
// exist as a live row at all. `currentChildIds` supplies what the client couldn't have known about:
// anything living in this parent that the posted order never mentions, appended in its existing
// relative order rather than discarded.
export function reconcileSiblingOrder(order, currentChildIds, liveIds) {
  const reconciled = order.filter((id) => liveIds.has(id));
  const reconciledSet = new Set(reconciled);
  currentChildIds.forEach((id) => {
    if (!reconciledSet.has(id)) reconciled.push(id);
  });
  return reconciled;
}
