// Reconciles a client-submitted item order against a list's current stored items — used by
// PUT /:id/items/order (routes/lists.js). Blind-replacing `items` with the posted `order` would
// silently drop a sutta another tab added (arrayUnion) after this client snapshotted `order`, and
// resurrect one removed the same way — so this filters `order` down to ids that still exist in
// `current`, then appends any id in `current` that's missing from `order` (arrived after the
// snapshot) at the end, in its existing relative order.
export function reconcileItemOrder(current, order) {
  const currentSet = new Set(current);
  const reconciled = order.filter((id) => currentSet.has(id));
  const reconciledSet = new Set(reconciled);
  current.forEach((id) => {
    if (!reconciledSet.has(id)) reconciled.push(id);
  });
  return reconciled;
}
