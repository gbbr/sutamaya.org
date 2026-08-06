import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useListTreeIndex } from './useListTreeIndex';
import type { ListDef } from '../lib/types';

// renderHook (from @testing-library/react) mounts a real component under the hood, hence jsdom
// (see vitest.config.ts's `jsdom` project) — the hook itself is otherwise pure data in/out, no
// DOM interaction of its own.

const lists: ListDef[] = [
  { id: 'g1', label: 'Suttas to study', parentId: null, kind: 'group', items: [] },
  { id: 'l1', label: 'Favorites', parentId: 'g1', kind: 'list', items: ['an1.1', 'an1.2'] },
  { id: 'l2', label: 'Nested favorites', parentId: 'g1', kind: 'list', items: ['an1.2', 'an1.3'] },
  { id: 'l3', label: 'Read later', parentId: null, kind: 'list', items: [] },
];

describe('useListTreeIndex', () => {
  it('listChildrenOf groups by parentId, including top-level (parentId: null)', () => {
    const { result } = renderHook(() => useListTreeIndex(lists));
    expect(result.current.listChildrenOf('g1').map((l) => l.id)).toEqual(['l1', 'l2']);
    expect(result.current.listChildrenOf('l1')).toEqual([]);
  });

  it('topLevelLists excludes nested and auto lists', () => {
    const withAuto: ListDef[] = [...lists, { id: 'auto1', label: 'Highlights', parentId: null, kind: 'list', items: [], auto: true }];
    const { result } = renderHook(() => useListTreeIndex(withAuto));
    expect(result.current.topLevelLists.map((l) => l.id)).toEqual(['g1', 'l3']);
  });

  it('countFor a list returns its distinct member count, deduped across its own sub-lists', () => {
    const { result } = renderHook(() => useListTreeIndex(lists));
    // g1 has no items of its own, but l1+l2 together cover an1.1/an1.2/an1.3 — 3 distinct.
    expect(result.current.countFor(lists[0])).toBe(2); // group: counts nested lists (l1, l2), not suttas
    expect(result.current.countFor(lists[1])).toBe(2); // l1: an1.1, an1.2
    expect(result.current.countFor(lists[3])).toBe(0); // l3: empty
  });

  it('countFor a group counts every list/group nested underneath it, not suttas', () => {
    const nested: ListDef[] = [
      { id: 'g1', label: 'Outer', parentId: null, kind: 'group', items: [] },
      { id: 'g2', label: 'Inner', parentId: 'g1', kind: 'group', items: [] },
      { id: 'l1', label: 'Leaf', parentId: 'g2', kind: 'list', items: ['x'] },
    ];
    const { result } = renderHook(() => useListTreeIndex(nested));
    expect(result.current.countFor(nested[0])).toBe(2); // g2 + l1
    expect(result.current.countFor(nested[1])).toBe(1); // l1
  });
});
