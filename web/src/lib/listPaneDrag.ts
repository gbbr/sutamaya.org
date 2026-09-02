export interface ItemMidpoint {
  itemId: string;
  mid: number;
}

// The order ListPane's sutta list takes with the dragged item at pointer position `y`, given each
// item's current midpoint. Returns the same `order` reference when nothing moved, so a state
// updater can bail out on identity. Kept out of the component so it is testable without DOM rects.
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
