const EDGE = 56;
const MAX_SPEED = 16;

// Nudges `container`'s scrollTop toward the pointer when a drag holds it within EDGE px of the
// container's top/bottom edge — shared by ListPane (sutta reorder) and TreePane (list-tree
// reorder/nest), both driven by a rAF loop that calls this once per frame during a drag.
export function autoScrollEdge(container: HTMLElement | null, pointerY: number) {
  if (!container) return;
  const rect = container.getBoundingClientRect();
  if (pointerY < rect.top + EDGE) container.scrollTop -= MAX_SPEED * Math.min(1, (rect.top + EDGE - pointerY) / EDGE);
  else if (pointerY > rect.bottom - EDGE) container.scrollTop += MAX_SPEED * Math.min(1, (pointerY - (rect.bottom - EDGE)) / EDGE);
}
