import { describe, expect, it } from 'vitest';
import { repairListTree } from './listTree.js';

// Entries arrive with their tombstones — the cascade needs them — so `deleted` is part of the input.
function list(id, { parentId = null, position = 0, mtime = '', deleted = 0 } = {}) {
  return { id, parentId, position, mtime, deleted };
}

function parentsById(result) {
  return Object.fromEntries(result.map((l) => [l.id, l.parentId]));
}

function idsOf(result) {
  return result.map((l) => l.id);
}

describe('repairListTree', () => {
  it('leaves a well-formed tree alone', () => {
    const result = repairListTree([
      list('g', { position: 0 }),
      list('a', { parentId: 'g', position: 1 }),
    ]);
    expect(parentsById(result)).toEqual({ g: null, a: 'g' });
  });

  it('handles an empty set', () => {
    expect(repairListTree([])).toEqual([]);
  });

  it('drops a tombstoned list', () => {
    const result = repairListTree([list('live'), list('dead', { deleted: 1 })]);
    expect(idsOf(result)).toEqual(['live']);
  });

  // Deleting a group takes what's inside it, the way deleting a folder does — children are not
  // re-homed. One tombstone on the group is all the write side has to do.
  it('cascades a tombstoned group’s children out', () => {
    const result = repairListTree([
      list('group', { deleted: 1 }),
      list('child', { parentId: 'group' }),
    ]);
    expect(idsOf(result)).toEqual([]);
  });

  it('cascades all the way down, not just one level', () => {
    const result = repairListTree([
      list('group', { deleted: 1 }),
      list('child', { parentId: 'group' }),
      list('grandchild', { parentId: 'child' }),
      list('unrelated'),
    ]);
    expect(idsOf(result)).toEqual(['unrelated']);
  });

  it('leaves a deleted group’s siblings and their subtrees alone', () => {
    const result = repairListTree([
      list('doomed', { deleted: 1, position: 0 }),
      list('doomed-child', { parentId: 'doomed', position: 1 }),
      list('keeper', { position: 2 }),
      list('keeper-child', { parentId: 'keeper', position: 3 }),
    ]);
    expect(idsOf(result)).toEqual(['keeper', 'keeper-child']);
    expect(parentsById(result)).toEqual({ keeper: null, 'keeper-child': 'keeper' });
  });

  // The narrow case re-homing still exists for, and it is not a delete: `parent_id` has no foreign
  // key, so a client that pushes a child before its parent leaves a reference to nothing. Dropping
  // that child would lose it with no tombstone to explain why.
  it('re-homes a child whose parent is absent entirely, rather than dropping it', () => {
    const result = repairListTree([list('child', { parentId: 'never-synced' })]);
    expect(parentsById(result)).toEqual({ child: null });
  });

  it('re-homes a dangling child to the root even when a grandparent survives', () => {
    const result = repairListTree([
      list('grandparent'),
      list('child', { parentId: 'never-synced' }),
    ]);
    expect(parentsById(result)).toEqual({ grandparent: null, child: null });
  });

  it('keeps deeper descendants attached to a re-homed dangler', () => {
    const result = repairListTree([
      list('dangler', { parentId: 'never-synced' }),
      list('grandchild', { parentId: 'dangler' }),
    ]);
    expect(parentsById(result)).toEqual({ dangler: null, grandchild: 'dangler' });
  });

  // A live list must never come back pointing at a parent that isn't in the output.
  it('leaves no survivor pointing at a dropped parent', () => {
    const result = repairListTree([
      list('a', { deleted: 1 }),
      list('b', { parentId: 'a' }),
      list('c', { parentId: 'b' }),
      list('d'),
    ]);
    const ids = new Set(idsOf(result));
    for (const entry of result) {
      if (entry.parentId !== null) expect(ids.has(entry.parentId)).toBe(true);
    }
  });

  // Step 3. Two devices each make a locally-valid move; together they form a cycle, and neither
  // write could have seen the other.
  it('breaks a two-node cycle by re-homing the lower-mtime member', () => {
    const result = repairListTree([
      list('a', { parentId: 'b', mtime: '2026-01-01T00:00:00.000Z|x' }),
      list('b', { parentId: 'a', mtime: '2026-01-02T00:00:00.000Z|y' }),
    ]);
    // `a` moved earlier, so `a` loses and `b`'s more recent move survives.
    expect(parentsById(result)).toEqual({ a: null, b: 'a' });
  });

  it('breaks a self-parenting row', () => {
    const result = repairListTree([list('a', { parentId: 'a' })]);
    expect(parentsById(result)).toEqual({ a: null });
  });

  it('breaks a three-node cycle by re-homing the lowest-mtime member', () => {
    const result = repairListTree([
      list('a', { parentId: 'c', mtime: '2026-01-03T00:00:00.000Z|x' }),
      list('b', { parentId: 'a', mtime: '2026-01-01T00:00:00.000Z|x' }),
      list('c', { parentId: 'b', mtime: '2026-01-02T00:00:00.000Z|x' }),
    ]);
    expect(parentsById(result)).toEqual({ a: 'c', b: null, c: 'b' });
  });

  // The property that lets two devices converge without communicating: the outcome must depend
  // only on the rows' own contents, never on the order they happened to be fetched in.
  it('resolves a cycle identically from every input order', () => {
    const entries = [
      list('a', { parentId: 'b', mtime: '2026-01-01T00:00:00.000Z|x' }),
      list('b', { parentId: 'c', mtime: '2026-01-03T00:00:00.000Z|x' }),
      list('c', { parentId: 'a', mtime: '2026-01-02T00:00:00.000Z|x' }),
    ];
    const expected = parentsById(repairListTree(entries));
    expect(expected).toEqual({ a: null, b: 'c', c: 'a' });

    // Every permutation of the same three rows.
    const permutations = [
      [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
    ];
    for (const order of permutations) {
      expect(parentsById(repairListTree(order.map((i) => entries[i])))).toEqual(expected);
    }
  });

  // A tie can happen for real: two devices prepending offline both compute the same position, and
  // an un-backfilled row's mtime is ''. Falling back to id keeps the order stable either way.
  it('breaks an mtime tie within a cycle on id, lowest losing', () => {
    const both = { mtime: '2026-01-01T00:00:00.000Z|x' };
    const result = repairListTree([list('b', { parentId: 'a', ...both }), list('a', { parentId: 'b', ...both })]);
    expect(parentsById(result)).toEqual({ a: null, b: 'a' });
  });

  // A node that merely leads into a cycle isn't part of it and must keep its parent.
  it('leaves a node dangling off a cycle attached once the cycle is broken', () => {
    const result = repairListTree([
      list('tail', { parentId: 'a', mtime: '2026-01-09T00:00:00.000Z|x' }),
      list('a', { parentId: 'b', mtime: '2026-01-01T00:00:00.000Z|x' }),
      list('b', { parentId: 'a', mtime: '2026-01-02T00:00:00.000Z|x' }),
    ]);
    expect(parentsById(result)).toEqual({ tail: 'a', a: null, b: 'a' });
  });

  it('breaks two independent cycles in one pass', () => {
    const result = repairListTree([
      list('a', { parentId: 'b', mtime: '2026-01-01T00:00:00.000Z|x' }),
      list('b', { parentId: 'a', mtime: '2026-01-02T00:00:00.000Z|x' }),
      list('c', { parentId: 'd', mtime: '2026-01-04T00:00:00.000Z|x' }),
      list('d', { parentId: 'c', mtime: '2026-01-03T00:00:00.000Z|x' }),
    ]);
    expect(parentsById(result)).toEqual({ a: null, b: 'a', c: 'd', d: null });
  });

  // The cascade walks ancestor chains, so it would spin forever on an unbroken cycle — cycles have
  // to be broken first. A tombstone inside a cycle is the case that pins the ordering.
  it('terminates and cascades correctly when a cycle contains a tombstone', () => {
    const result = repairListTree([
      list('a', { parentId: 'b', deleted: 1, mtime: '2026-01-01T00:00:00.000Z|x' }),
      list('b', { parentId: 'a', mtime: '2026-01-02T00:00:00.000Z|x' }),
    ]);
    // `a` has the lower mtime so it is re-homed to the root, then dropped as tombstoned — and `b`,
    // which still hangs off `a`, goes with it.
    expect(idsOf(result)).toEqual([]);
  });

  // Step 5.
  it('orders by position, ascending, including the negative values firstPosition produces', () => {
    const result = repairListTree([
      list('first', { position: 0 }),
      list('third', { position: -2 }),
      list('second', { position: -1 }),
    ]);
    expect(result.map((l) => l.id)).toEqual(['third', 'second', 'first']);
  });

  it('tie-breaks equal positions on id so the order is stable', () => {
    const result = repairListTree([list('b', { position: 0 }), list('a', { position: 0 })]);
    expect(result.map((l) => l.id)).toEqual(['a', 'b']);
  });

  it('passes extra fields through untouched', () => {
    const [only] = repairListTree([{ ...list('a'), label: 'Keep me', kind: 'group' }]);
    expect(only).toMatchObject({ id: 'a', label: 'Keep me', kind: 'group' });
  });

  it('does not mutate its input', () => {
    const entries = [list('a', { parentId: 'gone' })];
    repairListTree(entries);
    expect(entries[0].parentId).toBe('gone');
  });
});
