import { describe, expect, it } from 'vitest';
import { resolveTreeDropTarget, resolveDropIndicator, type DropRow } from './listTreeDrop';

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
