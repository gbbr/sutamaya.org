import { describe, expect, it } from 'vitest';
import { resolveDragReorder } from './listPaneDrag';

const ROW_H = 40;

// Three rows stacked with no gap, midpoints at 20, 60, 100 — matches real layout math (see
// listTreeDrop.test.ts's own ROW_H stacking convention).
function mids(order: string[]): { itemId: string; mid: number }[] {
  return order.map((itemId, i) => ({ itemId, mid: i * ROW_H + ROW_H / 2 }));
}

describe('resolveDragReorder', () => {
  it('moves the dragged item down past a later row', () => {
    const order = ['a', 'b', 'c'];
    // Dragging 'a' down to just past 'b's midpoint (60).
    const next = resolveDragReorder(order, 'a', mids(order), 70);
    expect(next).toEqual(['b', 'a', 'c']);
  });

  it('moves the dragged item up past an earlier row', () => {
    const order = ['a', 'b', 'c'];
    // Dragging 'c' up to just above 'b's midpoint (60).
    const next = resolveDragReorder(order, 'c', mids(order), 50);
    expect(next).toEqual(['a', 'c', 'b']);
  });

  it('returns the same array reference when the position has not changed', () => {
    const order = ['a', 'b', 'c'];
    // 'a' hovering within its own row, above every midpoint — resolves back to index 0, its
    // current position.
    const next = resolveDragReorder(order, 'a', mids(order), 10);
    expect(next).toBe(order);
  });

  it('resolves to the end when the pointer is past every row', () => {
    const order = ['a', 'b', 'c'];
    const next = resolveDragReorder(order, 'a', mids(order), 500);
    expect(next).toEqual(['b', 'c', 'a']);
  });

  it('resolves to the start when the pointer is above every row', () => {
    const order = ['a', 'b', 'c'];
    const next = resolveDragReorder(order, 'c', mids(order), -100);
    expect(next).toEqual(['c', 'a', 'b']);
  });

  it('returns the same array reference when the dragged id is not in order', () => {
    const order = ['a', 'b', 'c'];
    const next = resolveDragReorder(order, 'missing', mids(order), 70);
    expect(next).toBe(order);
  });
});
