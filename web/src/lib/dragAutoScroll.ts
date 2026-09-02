const EDGE = 56;
const MAX_SPEED = 16;

// Nudges a container's scroll toward the pointer while a drag holds it within EDGE px of the top
// or bottom edge. Called once per frame by both drag loops.
export function autoScrollEdge(container: HTMLElement | null, pointerY: number) {
  if (!container) return;
  const rect = container.getBoundingClientRect();
  if (pointerY < rect.top + EDGE) container.scrollTop -= MAX_SPEED * Math.min(1, (rect.top + EDGE - pointerY) / EDGE);
  else if (pointerY > rect.bottom - EDGE) container.scrollTop += MAX_SPEED * Math.min(1, (pointerY - (rect.bottom - EDGE)) / EDGE);
}
