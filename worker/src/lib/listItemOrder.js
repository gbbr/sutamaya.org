// Returns the order to write for one list's suttas, reconciling a posted order against what is
// stored: ids no longer in `current` are dropped, and ids added since the client's snapshot are
// appended in their existing relative order.
export function reconcileItemOrder(current, order) {
  const currentSet = new Set(current);
  const reconciled = order.filter((id) => currentSet.has(id));
  const reconciledSet = new Set(reconciled);
  current.forEach((id) => {
    if (!reconciledSet.has(id)) reconciled.push(id);
  });
  return reconciled;
}
