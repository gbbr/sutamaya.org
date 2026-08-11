import { describe, expect, it } from 'vitest';
import { ancestorsOfList, applyListReorder, flattenListTree, suttaRowMeta } from './lists';
import { HIGHLIGHTS_AUTO_LIST_ID, NOTES_AUTO_LIST_ID } from './autoLists';
import type { Highlight, ListDef } from './types';

const lists: ListDef[] = [
  { id: 'g1', label: 'Suttas to study', parentId: null, kind: 'group', items: [] },
  { id: 'l1', label: 'Favorites', parentId: 'g1', kind: 'list', items: [] },
  { id: 'l2', label: 'Read later', parentId: null, kind: 'list', items: [] },
];

describe('ancestorsOfList', () => {
  it('includes the node itself plus every parentId up the chain', () => {
    expect(ancestorsOfList(lists, 'l1')).toEqual({ l1: true, g1: true });
  });

  it('includes just the node itself for a top-level list', () => {
    expect(ancestorsOfList(lists, 'l2')).toEqual({ l2: true });
  });

  it('returns an empty object when nodeId is missing', () => {
    expect(ancestorsOfList(lists, undefined)).toEqual({});
  });

  it('returns an empty object for an id not found in lists', () => {
    expect(ancestorsOfList(lists, 'nope')).toEqual({});
  });
});

describe('applyListReorder', () => {
  const topLevel: ListDef[] = [
    { id: 'a', label: 'A', parentId: null, kind: 'list', items: [] },
    { id: 'b', label: 'B', parentId: null, kind: 'list', items: [] },
    { id: 'c', label: 'C', parentId: null, kind: 'list', items: [] },
  ];

  it('reorders siblings to match the given order', () => {
    const result = applyListReorder(topLevel, null, ['c', 'a', 'b']);
    expect(result.map((l) => l.id)).toEqual(['c', 'a', 'b']);
  });

  it('leaves lists outside the reordered set untouched and in their own relative order', () => {
    const ab = topLevel.filter((l) => l.id !== 'c');
    const withOther: ListDef[] = [...ab, { id: 'g1', label: 'Group', parentId: null, kind: 'group', items: [] }];
    const result = applyListReorder(withOther, null, ['b', 'a']);
    expect(result.map((l) => l.id)).toEqual(['g1', 'b', 'a']);
  });

  it("sets parentId on every id in `order`, re-parenting one crossing into a new parent for the first time", () => {
    // Mirrors the server's PUT /order handler, and what lets a cross-parent drag-drop fold into
    // this single call (see planListDrop in lib/listTreeDrop.ts) instead of a separate
    // setListParent call first — the fix for the two-step-flicker bug (a55e1ecc).
    const group: ListDef = { id: 'g1', label: 'Group', parentId: null, kind: 'group', items: [] };
    const dragged: ListDef = { id: 'a', label: 'A', parentId: null, kind: 'list', items: [] };
    const existingChild: ListDef = { id: 'b', label: 'B', parentId: 'g1', kind: 'list', items: [] };

    const result = applyListReorder([group, dragged, existingChild], 'g1', ['b', 'a']);

    const byId = new Map(result.map((l) => [l.id, l]));
    expect(byId.get('a')?.parentId).toBe('g1');
    expect(byId.get('b')?.parentId).toBe('g1');
    expect(result.filter((l) => l.parentId === 'g1').map((l) => l.id)).toEqual(['b', 'a']);
  });

  it('does not mutate a list already at the target parent (referential no-op for that entry)', () => {
    const alreadyThere: ListDef = { id: 'a', label: 'A', parentId: 'g1', kind: 'list', items: [] };
    const result = applyListReorder([alreadyThere], 'g1', ['a']);
    expect(result[0]).toBe(alreadyThere);
  });
});

function h(id: string, i: number, s: number, e: number, g: string, c = '#ffe08a'): Highlight {
  return { id, i, s, e, c, g };
}

describe('suttaRowMeta', () => {
  const flatLists = flattenListTree(lists);

  it('resolves each membership id to its chip breadcrumb, nested lists included', () => {
    const map = suttaRowMeta(['dn1'], { dn1: ['l1', 'l2'] }, {}, flatLists);
    expect(map.get('dn1')?.chips).toEqual([
      { id: 'l1', breadcrumb: 'Suttas to study / Favorites' },
      { id: 'l2', breadcrumb: 'Read later' },
    ]);
  });

  it('filters the auto-managed lists (Highlights/Notes) out of the chips', () => {
    const map = suttaRowMeta(['dn1'], { dn1: ['l2', HIGHLIGHTS_AUTO_LIST_ID, NOTES_AUTO_LIST_ID] }, {}, flatLists);
    expect(map.get('dn1')?.chips).toEqual([{ id: 'l2', breadcrumb: 'Read later' }]);
  });

  it('counts merged highlight groups (by shared groupId), not raw highlight docs', () => {
    const highlights = { dn1: [h('a', 0, 2, 5, 'g1'), h('b', 1, 0, 3, 'g1'), h('c', 2, 0, 4, 'g2')] };
    const map = suttaRowMeta(['dn1'], {}, highlights, flatLists);
    expect(map.get('dn1')?.hlCount).toBe(2);
  });

  it('gives an empty-chips/zero-count entry for a sutta with no membership or highlights', () => {
    const map = suttaRowMeta(['dn1'], {}, {}, flatLists);
    expect(map.get('dn1')).toEqual({ chips: [], hlCount: 0 });
  });

  it('produces one entry per requested id', () => {
    const map = suttaRowMeta(['dn1', 'dn2'], { dn1: ['l2'] }, {}, flatLists);
    expect([...map.keys()]).toEqual(['dn1', 'dn2']);
  });
});
