import { describe, expect, it } from 'vitest';
import {
  resolveTreeDropTarget,
  resolveDropIndicator,
  isDescendantOf,
  isValidListDrop,
  siblingIdsWithInsert,
  planListDrop,
  type DropRow,
} from './listTreeDrop';
import type { ListDef } from './types';

// A realistic row is roughly 34-40px tall (py-[7px] + one line of 15px text) — the exact number
// doesn't matter for this math, just that rows are stacked with no gap, matching real layout.
const ROW_H = 36;

// Builds a stack of contiguous rows (no gaps, matching real DOM layout) from a compact spec.
function stack(spec: Array<{ id: string; isGroup?: boolean }>): DropRow[] {
  return spec.map((s, i) => ({ id: s.id, isGroup: !!s.isGroup, top: i * ROW_H, bottom: (i + 1) * ROW_H }));
}

describe('resolveTreeDropTarget', () => {
  it('always resolves to a target somewhere within a plain (non-group) row — no dead zone', () => {
    // This was the actual bug: hovering the middle half of a plain row used to compute an
    // 'inside' zone, reject it (only groups can hold children), and drop the candidate entirely
    // with no fallback — dragging there and letting go silently reset to the start position.
    const rows = stack([{ id: 'a' }, { id: 'b' }]);
    for (let y = rows[0].top; y <= rows[rows.length - 1].bottom; y++) {
      expect(resolveTreeDropTarget(y, rows)).not.toBeNull();
    }
  });

  it('splits a plain row before/after at its midpoint', () => {
    const rows = stack([{ id: 'a' }, { id: 'b' }]);
    expect(resolveTreeDropTarget(ROW_H * 0.4, rows)).toEqual({ id: 'a', zone: 'before' });
    // Past a row's own midpoint falls through to "before the next row" — the same resulting
    // position as "after this row" whenever they're siblings (see resolveDropIndicator for how
    // that's turned into a single rendered line rather than two).
    expect(resolveTreeDropTarget(ROW_H * 0.6, rows)).toEqual({ id: 'b', zone: 'before' });
    // Past every row's midpoint: insert after the last one.
    expect(resolveTreeDropTarget(ROW_H * 1.9, rows)).toEqual({ id: 'b', zone: 'after' });
  });

  it('nests into a group only in its inner half, never at its own edges', () => {
    const rows = stack([{ id: 'g', isGroup: true }]);
    expect(resolveTreeDropTarget(ROW_H * 0.1, rows)?.zone).not.toBe('inside');
    expect(resolveTreeDropTarget(ROW_H * 0.5, rows)).toEqual({ id: 'g', zone: 'inside' });
    expect(resolveTreeDropTarget(ROW_H * 0.9, rows)?.zone).not.toBe('inside');
  });

  it('resolves the boundary under an expanded group and its first child to exactly one target', () => {
    // The actual reported bug: hovering right under an expanded group's own name used to
    // independently compute BOTH "after the group" (exit the group) and "before the first
    // child" (stay nested) as valid, and both could render as a drop-indicator line at once.
    const rows = stack([{ id: 'group', isGroup: true }, { id: 'child1' }, { id: 'child2' }]);
    for (let y = rows[0].top; y <= rows[rows.length - 1].bottom; y++) {
      const target = resolveTreeDropTarget(y, rows);
      expect(target).not.toBeNull();
      // Never "after the group" — an expanded group with a rendered child can never be the last
      // row, so it can never fall out the 'after' end of the sibling pass.
      expect(target).not.toEqual({ id: 'group', zone: 'after' });
    }
    // Specifically: from just past the group's own nesting band (its lower quarter, including
    // right at its own bottom edge) through into its first child's own upper half, it always
    // means "nest as first child" — the one interpretation that actually made sense there — never
    // something ambiguous with an "exit the group" reading.
    for (const y of [ROW_H * 0.8, ROW_H * 0.99, ROW_H, ROW_H * 1.24]) {
      expect(resolveTreeDropTarget(y, rows)).toEqual({ id: 'child1', zone: 'before' });
    }
  });

  it('still allows dropping before an expanded group itself when hovering its own upper half', () => {
    // A capability worth keeping: an expanded group is not exempt from ordinary reordering, only
    // from the specific ambiguity at its boundary with its own first child (see the test above).
    const rows = stack([{ id: 'earlier' }, { id: 'group', isGroup: true }, { id: 'child1' }]);
    expect(resolveTreeDropTarget(ROW_H * 1.1, rows)).toEqual({ id: 'group', zone: 'before' });
  });

  it('is unaffected by a collapsed group (no rendered children to disambiguate against)', () => {
    const rows = stack([{ id: 'group', isGroup: true }, { id: 'next' }]);
    expect(resolveTreeDropTarget(ROW_H * 0.9, rows)).toEqual({ id: 'next', zone: 'before' });
    expect(resolveTreeDropTarget(ROW_H * 1.9, rows)).toEqual({ id: 'next', zone: 'after' });
  });

  it('returns null with no rows', () => {
    expect(resolveTreeDropTarget(100, [])).toBeNull();
  });
});

describe('resolveDropIndicator', () => {
  const rows = stack([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);

  it('renders a "before" target as the previous row\'s own bottom edge', () => {
    expect(resolveDropIndicator({ id: 'b', zone: 'before' }, rows)).toEqual({ id: 'a', edge: 'bottom' });
  });

  it('renders an "after" target as its own bottom edge', () => {
    expect(resolveDropIndicator({ id: 'b', zone: 'after' }, rows)).toEqual({ id: 'b', edge: 'bottom' });
  });

  it('falls back to its own top edge only for the very first row (nothing above to recolor)', () => {
    expect(resolveDropIndicator({ id: 'a', zone: 'before' }, rows)).toEqual({ id: 'a', edge: 'top' });
  });

  it('renders an "inside" target as itself', () => {
    expect(resolveDropIndicator({ id: 'b', zone: 'inside' }, rows)).toEqual({ id: 'b', edge: 'inside' });
  });

  it('never produces two indicators for adjacent before/after targets on the same boundary', () => {
    // "before b" and "after a" describe the same physical boundary — both must resolve to the
    // exact same rendered indicator, or the doubled-line bug is back.
    expect(resolveDropIndicator({ id: 'b', zone: 'before' }, rows)).toEqual(resolveDropIndicator({ id: 'a', zone: 'after' }, rows));
  });

  it('passes null through', () => {
    expect(resolveDropIndicator(null, rows)).toBeNull();
  });
});

// Same tree shape as worker/src/lib/listParent.test.js's cycle-guard fixture (the client's own
// backstop for the same rule — see useListTreeDrag's own comment on isDescendantOf).
const tree: ListDef[] = [
  { id: 'g1', label: 'G1', parentId: null, kind: 'group', items: [] },
  { id: 'g2', label: 'G2', parentId: 'g1', kind: 'group', items: [] },
  { id: 'g3', label: 'G3', parentId: 'g2', kind: 'group', items: [] },
  { id: 'l1', label: 'L1', parentId: 'g1', kind: 'list', items: [] },
  { id: 'l2', label: 'L2', parentId: null, kind: 'list', items: [] },
];

describe('isDescendantOf', () => {
  it('is true for a direct child', () => {
    expect(isDescendantOf(tree, 'g2', 'g1')).toBe(true);
  });

  it('is true for a deeper descendant', () => {
    expect(isDescendantOf(tree, 'g3', 'g1')).toBe(true);
  });

  it('is false for an unrelated top-level list', () => {
    expect(isDescendantOf(tree, 'l2', 'g1')).toBe(false);
  });

  it('is false for a node checked against itself', () => {
    expect(isDescendantOf(tree, 'g1', 'g1')).toBe(false);
  });

  it('is false for a parent checked against its own child (wrong direction)', () => {
    expect(isDescendantOf(tree, 'g1', 'g2')).toBe(false);
  });
});

describe('isValidListDrop', () => {
  it('allows a before/after sibling drop regardless of kind', () => {
    expect(isValidListDrop(tree, 'l1', 'l2', 'before')).toBe(true);
    expect(isValidListDrop(tree, 'l1', 'g2', 'after')).toBe(true);
  });

  it('allows nesting inside a group', () => {
    expect(isValidListDrop(tree, 'l1', 'g2', 'inside')).toBe(true);
  });

  it('rejects nesting inside a plain list', () => {
    expect(isValidListDrop(tree, 'l1', 'l2', 'inside')).toBe(false);
  });

  it('rejects dropping a group near/into its own descendant, regardless of zone', () => {
    expect(isValidListDrop(tree, 'g1', 'g3', 'inside')).toBe(false);
    expect(isValidListDrop(tree, 'g1', 'g3', 'before')).toBe(false);
  });

  it('rejects an unknown dragged or target id', () => {
    expect(isValidListDrop(tree, 'missing', 'g2', 'inside')).toBe(false);
    expect(isValidListDrop(tree, 'l1', 'missing', 'inside')).toBe(false);
  });
});

describe('siblingIdsWithInsert', () => {
  const childrenOf = (parentId: string) => tree.filter((l) => l.parentId === parentId);
  const topLevelLists = tree.filter((l) => !l.parentId);

  it('inserts before the target among top-level lists', () => {
    expect(siblingIdsWithInsert(childrenOf, topLevelLists, null, 'l1', 'l2', false)).toEqual(['g1', 'l1', 'l2']);
  });

  it('inserts after the target among top-level lists', () => {
    expect(siblingIdsWithInsert(childrenOf, topLevelLists, null, 'l1', 'l2', true)).toEqual(['g1', 'l2', 'l1']);
  });

  it('inserts within a named parent\'s own children', () => {
    expect(siblingIdsWithInsert(childrenOf, topLevelLists, 'g1', 'x', 'g2', true)).toEqual(['g2', 'x', 'l1']);
  });

  it('excludes the inserted id from its old position when it was already a sibling in scope', () => {
    // l1 dropped back among g1's own children (its current parent), reordered before g2.
    expect(siblingIdsWithInsert(childrenOf, topLevelLists, 'g1', 'l1', 'g2', false)).toEqual(['l1', 'g2']);
  });
});

describe('planListDrop', () => {
  const childrenOf = (parentId: string) => tree.filter((l) => l.parentId === parentId);
  const topLevelLists = tree.filter((l) => !l.parentId);
  const g2 = tree.find((l) => l.id === 'g2')!;
  const g1 = tree.find((l) => l.id === 'g1')!;
  const l2 = tree.find((l) => l.id === 'l2')!;

  it('plans a reparent when dropping inside a group the dragged item is not already in', () => {
    expect(planListDrop(tree, 'l2', g2, 'inside', childrenOf, topLevelLists)).toEqual({
      type: 'reparent',
      parentId: 'g2',
      alreadyParented: false,
    });
  });

  it('marks alreadyParented when the dragged item is already that group\'s direct child', () => {
    const g1AsTarget = tree.find((l) => l.id === 'g1')!;
    expect(planListDrop(tree, 'l1', g1AsTarget, 'inside', childrenOf, topLevelLists)).toEqual({
      type: 'reparent',
      parentId: 'g1',
      alreadyParented: true,
    });
  });

  it('plans a single reorder for a before/after drop, even one crossing into a new parent', () => {
    // l2 (currently top-level) dropped after l1, which lives inside g1 — one 'reorder' plan
    // targeting g1 covers both the re-parent and the position, matching the server's own PUT
    // /order semantics (see reorderListRecords in lib/mirror.ts) and avoiding the two-step-flicker
    // bug (a55e1ecc) a separate 'reparent' call first used to cause.
    const l1 = tree.find((l) => l.id === 'l1')!;
    expect(planListDrop(tree, 'l2', l1, 'after', childrenOf, topLevelLists)).toEqual({
      type: 'reorder',
      parentId: 'g1',
      order: ['g2', 'l1', 'l2'],
    });
  });

  it('plans invalid for nesting inside a plain list', () => {
    expect(planListDrop(tree, 'g1', l2, 'inside', childrenOf, topLevelLists)).toEqual({ type: 'invalid' });
  });

  it('plans invalid for dropping a group into its own descendant', () => {
    const g3 = tree.find((l) => l.id === 'g3')!;
    expect(planListDrop(tree, 'g1', g3, 'inside', childrenOf, topLevelLists)).toEqual({ type: 'invalid' });
  });

  it('plans invalid for an unknown dragged id', () => {
    expect(planListDrop(tree, 'missing', g1, 'before', childrenOf, topLevelLists)).toEqual({ type: 'invalid' });
  });
});
