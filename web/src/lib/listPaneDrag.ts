export interface ItemMidpoint {
  itemId: string;
  mid: number;
}

// Reposition logic for ListPane's sutta-item drag reorder, kept out of the component so it is
// testable without real DOM rects. `mids` are each item's current vertical midpoint; the caller has
// already dropped items with no measured row. Returns the same `order` reference when the drop
// position hasn't changed, so a React state updater can bail out on referential equality.
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
