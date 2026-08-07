import { describe, expect, it } from 'vitest';
import { groupHighlights } from './highlights';
import type { Highlight } from './types';

function h(id: string, i: number, s: number, e: number, g: string, c = '#ffe08a'): Highlight {
  return { id, i, s, e, c, g };
}

describe('groupHighlights', () => {
  it('keeps a single-segment highlight as its own group', () => {
    const groups = groupHighlights([h('a', 0, 2, 5, 'g1')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(1);
  });

  it('merges every doc sharing a groupId into one group, regardless of offsets', () => {
    // Same shape useHighlightPopup's `pick` produces for one cross-segment selection: every
    // range written by that call shares the server-assigned `g`.
    const groups = groupHighlights([h('a', 0, 4, 10, 'g1'), h('b', 1, 0, 8, 'g1')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('keeps two independently-created highlights in adjacent segments separate when their groupIds differ', () => {
    const groups = groupHighlights([h('a', 0, 2, 5, 'g1'), h('b', 1, 0, 3, 'g2')]);
    expect(groups).toHaveLength(2);
  });

  it('sorts out-of-order input before grouping', () => {
    const groups = groupHighlights([h('b', 1, 0, 8, 'g1'), h('a', 0, 4, 10, 'g1')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((x) => x.id)).toEqual(['a', 'b']);
  });
});
