import { describe, expect, it } from 'vitest';
import { reconcileItemOrder } from './listItemOrder.js';

describe('reconcileItemOrder', () => {
  it('applies a straightforward reorder of items all still present', () => {
    expect(reconcileItemOrder(['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual(['c', 'a', 'b']);
  });

  it('drops an id from order that no longer exists in current (removed by another tab)', () => {
    expect(reconcileItemOrder(['a', 'c'], ['a', 'b', 'c'])).toEqual(['a', 'c']);
  });

  it('appends an id present in current but missing from order (added by another tab after the snapshot)', () => {
    expect(reconcileItemOrder(['a', 'b', 'c'], ['b', 'a'])).toEqual(['b', 'a', 'c']);
  });

  it('preserves current relative order for multiple appended ids', () => {
    expect(reconcileItemOrder(['a', 'b', 'c', 'd'], ['c'])).toEqual(['c', 'a', 'b', 'd']);
  });

  it('returns current unchanged (in its own order) when order is empty', () => {
    expect(reconcileItemOrder(['a', 'b'], [])).toEqual(['a', 'b']);
  });

  it('returns an empty array when current is empty, regardless of order', () => {
    expect(reconcileItemOrder([], ['a', 'b'])).toEqual([]);
  });
});
