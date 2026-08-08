import { describe, expect, it } from 'vitest';
import { planHighlightRangeUpdate } from './highlightRangePlan.js';

const ctx = { suttaId: 'dn1', createdAt: '2026-08-08T00:00:00.000Z', groupId: 'g-new' };

describe('planHighlightRangeUpdate', () => {
  it('inserts one doc per range, all sharing the given groupId', () => {
    const { deleteIds, inserts } = planHighlightRangeUpdate(
      [],
      [
        { i: 0, s: 0, e: 5 },
        { i: 1, s: 0, e: 3 },
      ],
      'yellow',
      ctx
    );
    expect(deleteIds).toEqual([]);
    expect(inserts).toEqual([
      { suttaId: 'dn1', i: 0, s: 0, e: 5, color: 'yellow', g: 'g-new', createdAt: ctx.createdAt },
      { suttaId: 'dn1', i: 1, s: 0, e: 3, color: 'yellow', g: 'g-new', createdAt: ctx.createdAt },
    ]);
  });

  it('deletes any existing highlight overlapping any given range', () => {
    const existing = [
      { id: 'h1', data: { suttaId: 'dn1', i: 0, s: 2, e: 8 } },
      { id: 'h2', data: { suttaId: 'dn1', i: 0, s: 20, e: 25 } },
    ];
    const { deleteIds } = planHighlightRangeUpdate(existing, [{ i: 0, s: 0, e: 5 }], 'yellow', ctx);
    expect(deleteIds).toEqual(['h1']);
  });

  it('does not delete a highlight in a different segment even at the same offsets', () => {
    const existing = [{ id: 'h1', data: { suttaId: 'dn1', i: 1, s: 0, e: 5 } }];
    const { deleteIds } = planHighlightRangeUpdate(existing, [{ i: 0, s: 0, e: 5 }], 'yellow', ctx);
    expect(deleteIds).toEqual([]);
  });

  it('does not delete a highlight that only touches at an edge', () => {
    const existing = [{ id: 'h1', data: { suttaId: 'dn1', i: 0, s: 5, e: 10 } }];
    const { deleteIds } = planHighlightRangeUpdate(existing, [{ i: 0, s: 0, e: 5 }], 'yellow', ctx);
    expect(deleteIds).toEqual([]);
  });

  it('produces no inserts when color is null — the erase case', () => {
    const existing = [{ id: 'h1', data: { suttaId: 'dn1', i: 0, s: 0, e: 5 } }];
    const { deleteIds, inserts } = planHighlightRangeUpdate(existing, [{ i: 0, s: 0, e: 5 }], null, ctx);
    expect(deleteIds).toEqual(['h1']);
    expect(inserts).toEqual([]);
  });

  it('deletes every overlap across a multi-segment (cross-segment) selection in one plan', () => {
    const existing = [
      { id: 'h1', data: { suttaId: 'dn1', i: 0, s: 0, e: 5 } },
      { id: 'h2', data: { suttaId: 'dn1', i: 1, s: 0, e: 5 } },
      { id: 'h3', data: { suttaId: 'dn1', i: 2, s: 0, e: 5 } },
    ];
    const ranges = [
      { i: 0, s: 3, e: 8 },
      { i: 1, s: 3, e: 8 },
    ];
    const { deleteIds, inserts } = planHighlightRangeUpdate(existing, ranges, 'blue', ctx);
    expect(deleteIds.sort()).toEqual(['h1', 'h2']);
    expect(inserts).toHaveLength(2);
    expect(new Set(inserts.map((x) => x.g))).toEqual(new Set(['g-new']));
  });

  it('replacing an existing highlight with a new color deletes the old doc and inserts a fresh one', () => {
    const existing = [{ id: 'h1', data: { suttaId: 'dn1', i: 0, s: 0, e: 5, color: 'yellow', g: 'g-old' } }];
    const { deleteIds, inserts } = planHighlightRangeUpdate(existing, [{ i: 0, s: 0, e: 5 }], 'green', ctx);
    expect(deleteIds).toEqual(['h1']);
    expect(inserts).toEqual([{ suttaId: 'dn1', i: 0, s: 0, e: 5, color: 'green', g: 'g-new', createdAt: ctx.createdAt }]);
  });
});
