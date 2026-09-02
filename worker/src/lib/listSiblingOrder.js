// Returns the order to write for one parent's children, reconciling a posted order against what
// is stored so an offline reorder stays safe to replay. The counterpart of lib/listItemOrder.js.
//
// An id is kept if `liveIds` has it — a posted id that is not yet a child of this parent is a
// cross-parent drop, not an error — and every id in `currentChildIds` the order never mentioned is
// appended in its existing relative order.
export function reconcileSiblingOrder(order, currentChildIds, liveIds) {
  const reconciled = order.filter((id) => liveIds.has(id));
  const reconciledSet = new Set(reconciled);
  currentChildIds.forEach((id) => {
    if (!reconciledSet.has(id)) reconciled.push(id);
  });
  return reconciled;
}
