export interface ItemMidpoint {
  itemId: string;
  mid: number;
}

// Pure reposition logic for ListPane's own sutta-item drag reorder — kept out of the component
// so "which index does this vertical position resolve to, and what does removing and reinserting
// the dragged id there produce" is testable without real DOM rects. `mids`
// are each item's current vertical midpoint (an item with no measured row yet is already filtered
// out by the caller). Returns the same `order` reference, not a copy, when the drop position
// hasn't actually changed — lets a caller (a React state updater) bail out via referential
// equality instead of triggering a no-op re-render.
export function resolveDragReorder(order: string[], draggedId: string, mids: ItemMidpoint[], y: number): string[] {
  let targetIndex = mids.length;
  for (let i = 0; i < mids.length; i++) {
    if (y < mids[i].mid) {
      targetIndex = i;
      break;
    }
  }
  const currentIndex = order.indexOf(draggedId);
  if (currentIndex === -1) return order;
  const insertAt = currentIndex < targetIndex ? targetIndex - 1 : targetIndex;
  if (insertAt === currentIndex) return order;
  const next = order.filter((x) => x !== draggedId);
  next.splice(insertAt, 0, draggedId);
  return next;
}
