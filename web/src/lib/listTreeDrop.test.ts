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
function stack(spec: Array<{ id: string; isGroup?: boolean; parentId?: string | null }>): DropRow[] {
  return spec.map((s, i) => ({
    id: s.id,
    isGroup: !!s.isGroup,
    parentId: s.parentId ?? null,
    top: i * ROW_H,
    bottom: (i + 1) * ROW_H,
  }));
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
    // Past every row's midpoint: the end of the top level, which for a flat tree is the same
    // position "after the last row" named.
    expect(resolveTreeDropTarget(ROW_H * 1.9, rows)).toEqual({ id: 'b', zone: 'end' });
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
      // row, so it can never fall out the far end of the sibling pass.
      expect(target).not.toEqual({ id: 'group', zone: 'end' });
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
    expect(resolveTreeDropTarget(ROW_H * 1.9, rows)).toEqual({ id: 'next', zone: 'end' });
  });

  it('reads the empty space below the tree as the top level, not as the last row\'s parent', () => {
    // The reported bug: with an expanded group as the last thing in the tree, its children are
    // the last rendered rows, so dragging one down into the blank space below resolved to "after
    // my own sibling" — putting the row straight back in the group it was being dragged out of,
    // with no gesture left that means "out here, at the end".
    const rows = stack([{ id: 'group', isGroup: true }, { id: 'child' }]);
    expect(resolveTreeDropTarget(ROW_H * 2 + 40, rows)).toEqual({ id: 'child', zone: 'end' });
  });

  it('still means the end of the top level when the last row is already top-level', () => {
    // Same gesture over a flat tree: 'end' and "after the last row" name the same position, so
    // nothing about dropping at the bottom of an unnested list changes.
    const rows = stack([{ id: 'a' }, { id: 'b' }]);
    expect(resolveTreeDropTarget(ROW_H * 2 + 40, rows)).toEqual({ id: 'b', zone: 'end' });
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

  it('falls back to its own top edge only for the very first row (nothing above to recolor)', () => {
    expect(resolveDropIndicator({ id: 'a', zone: 'before' }, rows)).toEqual({ id: 'a', edge: 'top' });
  });

  it('renders an "inside" target as itself', () => {
    expect(resolveDropIndicator({ id: 'b', zone: 'inside' }, rows)).toEqual({ id: 'b', edge: 'inside' });
  });

  it('renders an "end" target as the last rendered row\'s bottom edge', () => {
    // Where the pointer actually is — the very bottom of the tree — rather than on whichever row
    // happens to be the last top-level one, which for an expanded group is its own title row
    // well above the children.
    expect(resolveDropIndicator({ id: 'c', zone: 'end' }, rows)).toEqual({ id: 'c', edge: 'bottom' });
  });

  it('passes null through', () => {
    expect(resolveDropIndicator(null, rows)).toBeNull();
  });

  it('draws on the target\'s own top edge when the row above it is not touching it', () => {
    // The dragged row still occupies its place on screen while being excluded from the
    // candidates, so the row above a target may be a ghost's height away. Recolouring that row's
    // separator put the line above the gap, well clear of the pointer — which reads as no line at
    // all, and was the whole of the reported "dragging the inner group down reveals no line".
    const gapped: DropRow[] = [
      { id: 'g1', top: 0, bottom: ROW_H, isGroup: true, parentId: null },
      // g2's ghost occupies the row between these two.
      { id: 'g3', top: ROW_H * 2, bottom: ROW_H * 3, isGroup: true, parentId: null },
    ];
    expect(resolveDropIndicator({ id: 'g3', zone: 'before' }, gapped)).toEqual({ id: 'g3', edge: 'top', insideId: undefined });
  });

  it('names the group a sibling drop lands in, so the line is not the only signal', () => {
    // A line under a group's last child and a line under the whole tree sit on the same boundary
    // and mean different parents; the tint is what tells them apart.
    const nested = stack([{ id: 'g', isGroup: true }, { id: 'child', parentId: 'g' }]);
    expect(resolveDropIndicator({ id: 'child', zone: 'before' }, nested)?.insideId).toBe('g');
    // 'end' is the top level, so nothing is tinted.
    expect(resolveDropIndicator({ id: 'child', zone: 'end' }, nested)?.insideId).toBeUndefined();
    // And a top-level sibling drop lands in no group either.
    expect(resolveDropIndicator({ id: 'g', zone: 'before' }, nested)?.insideId).toBeUndefined();
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
  it('allows a sibling drop regardless of kind', () => {
    expect(isValidListDrop(tree, 'l1', 'l2', 'before')).toBe(true);
    expect(isValidListDrop(tree, 'l1', 'g2', 'before')).toBe(true);
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

  it('allows "end" for anything, including a group dragged past its own descendants', () => {
    // 'end' is the top level, which is somewhere every row may rest — so the descendant guard
    // that makes 'inside' and 'before' unsafe near your own subtree doesn't apply.
    expect(isValidListDrop(tree, 'l1', 'l2', 'end')).toBe(true);
    expect(isValidListDrop(tree, 'g1', 'g3', 'end')).toBe(true);
  });
});

describe('siblingIdsWithInsert', () => {
  const childrenOf = (parentId: string) => tree.filter((l) => l.parentId === parentId);
  const topLevelLists = tree.filter((l) => !l.parentId);

  it('inserts before the target among top-level lists', () => {
    expect(siblingIdsWithInsert(childrenOf, topLevelLists, null, 'l1', 'l2')).toEqual(['g1', 'l1', 'l2']);
  });

  it('inserts within a named parent\'s own children', () => {
    expect(siblingIdsWithInsert(childrenOf, topLevelLists, 'g1', 'x', 'g2')).toEqual(['x', 'g2', 'l1']);
  });

  it('excludes the inserted id from its old position when it was already a sibling in scope', () => {
    // l1 dropped back among g1's own children (its current parent), reordered before g2.
    expect(siblingIdsWithInsert(childrenOf, topLevelLists, 'g1', 'l1', 'g2')).toEqual(['l1', 'g2']);
  });
});

describe('planListDrop', () => {
  const childrenOf = (parentId: string) => tree.filter((l) => l.parentId === parentId);
  const topLevelLists = tree.filter((l) => !l.parentId);
  const g2 = tree.find((l) => l.id === 'g2')!;
  const g1 = tree.find((l) => l.id === 'g1')!;
  const l2 = tree.find((l) => l.id === 'l2')!;

  it('plans a nest as a reorder onto the end of the group\'s own children', () => {
    // A group's row carries no position indicator — dropping on it says "in here", not "in here,
    // third" — so the row lands at the end, where the eye looks for the thing just added. Carried
    // by the same reorder the sibling zones use, which re-parents every id in the order it is
    // given, rather than a bare parent change that would leave the row at whatever position
    // number it happened to hold in the group it came from.
    expect(planListDrop(tree, 'l2', g2, 'inside', childrenOf, topLevelLists)).toEqual({
      type: 'reorder',
      parentId: 'g2',
      order: ['g3', 'l2'],
    });
  });

  it('re-drops a row inside the group it is already in as a move to the end', () => {
    const g1AsTarget = tree.find((l) => l.id === 'g1')!;
    expect(planListDrop(tree, 'l1', g1AsTarget, 'inside', childrenOf, topLevelLists)).toEqual({
      type: 'reorder',
      parentId: 'g1',
      order: ['g2', 'l1'],
    });
  });

  it('plans an "end" drop as the end of the top level, whatever row the pointer was past', () => {
    // The de-nesting gesture: l1 lives inside g1, and the pointer ended up below every rendered
    // row — including g1's own children. The plan has to be about the top level, not about
    // whichever row the pointer happened to pass last.
    expect(planListDrop(tree, 'l1', g2, 'end', childrenOf, topLevelLists)).toEqual({
      type: 'reorder',
      parentId: null,
      order: ['g1', 'l2', 'l1'],
    });
  });

  it('plans a single reorder for a sibling drop, even one crossing into a new parent', () => {
    // l2 (currently top-level) dropped before l1, which lives inside g1 — one 'reorder' plan
    // targeting g1 covers both the re-parent and the position, matching the server's own PUT
    // /order semantics (see queueSiblingOrder in lib/mirror.ts) and avoiding the two-step-flicker
    // bug (a55e1ecc) a separate 'reparent' call first used to cause.
    const l1 = tree.find((l) => l.id === 'l1')!;
    expect(planListDrop(tree, 'l2', l1, 'before', childrenOf, topLevelLists)).toEqual({
      type: 'reorder',
      parentId: 'g1',
      order: ['g2', 'l2', 'l1'],
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
