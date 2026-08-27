import { describe, expect, it } from 'vitest';
import { invalidParentReasonForRow, wouldCreateCycle } from './listParent.js';

describe('invalidParentReasonForRow', () => {
  it('rejects a parent that does not exist', () => {
    expect(invalidParentReasonForRow(null)).toBe('parent_not_found');
  });

  it('rejects a parent that is a plain list, not a group', () => {
    expect(invalidParentReasonForRow({ kind: 'list' })).toBe('parent_not_a_group');
  });

  it('rejects a parent with no kind field (defaults to list)', () => {
    expect(invalidParentReasonForRow({})).toBe('parent_not_a_group');
  });

  it('accepts a parent that is a group', () => {
    expect(invalidParentReasonForRow({ kind: 'group' })).toBeNull();
  });
});

describe('wouldCreateCycle', () => {
  const tree = [
    { id: 'g1', parentId: null },
    { id: 'g2', parentId: 'g1' },
    { id: 'g3', parentId: 'g2' },
    { id: 'l1', parentId: 'g1' },
  ];

  it('is false for moving to the top level', () => {
    expect(wouldCreateCycle('g2', null, tree)).toBe(false);
  });

  it('is true for a list set as its own parent', () => {
    expect(wouldCreateCycle('g1', 'g1', tree)).toBe(true);
  });

  it('is true for moving a group under its own direct child', () => {
    expect(wouldCreateCycle('g1', 'g2', tree)).toBe(true);
  });

  it('is true for moving a group under a deeper descendant', () => {
    expect(wouldCreateCycle('g1', 'g3', tree)).toBe(true);
  });

  it('is false for moving a list under an unrelated group', () => {
    expect(wouldCreateCycle('l1', 'g2', tree)).toBe(false);
  });

  it('is false for moving a group under its own parent (no-op reparent)', () => {
    expect(wouldCreateCycle('g2', 'g1', tree)).toBe(false);
  });

  it('is false for moving a leaf list around regardless of target', () => {
    expect(wouldCreateCycle('l1', 'g3', tree)).toBe(false);
  });

  it('terminates on rows that are already in a cycle', () => {
    // Cycles are broken at read time (lib/listTree.js) and never written back, so storage can
    // genuinely hold one — two devices' reparents interleaving, which D1 gives no transaction to
    // prevent. Without the visited set this walk never ends, and every later request touching that
    // subtree burns the Worker's CPU limit instead of answering.
    const cyclic = [
      { id: 'a', parentId: 'b' },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: null },
    ];
    expect(wouldCreateCycle('c', 'a', cyclic)).toBe(false);
    // Still correct for a move that really would close a loop through the same rows.
    expect(wouldCreateCycle('a', 'b', cyclic)).toBe(true);
  });
});
