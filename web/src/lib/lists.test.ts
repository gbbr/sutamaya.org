import { describe, expect, it } from 'vitest';
import { ancestorsOfList, flattenListTree, suttaRowMeta } from './lists';
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

function h(id: string, i: number, s: number, e: number, g: string, c = '#ffe08a'): Highlight {
  return { id, i, s, e, c, g, m: '2026-01-01T00:00:00.000Z|dev' };
}

describe('suttaRowMeta', () => {
  const flatLists = flattenListTree(lists);

  it('labels each chip with the list\'s own name and keeps its full path for the tooltip', () => {
    const map = suttaRowMeta(['dn1'], { dn1: ['l1', 'l2'] }, {}, flatLists);
    expect(map.get('dn1')?.chips).toEqual([
      { id: 'l1', label: 'Favorites', breadcrumb: 'Suttas to study / Favorites' },
      { id: 'l2', label: 'Read later', breadcrumb: 'Read later' },
    ]);
  });

  it('falls back to the id as the label for a membership whose list is gone', () => {
    const map = suttaRowMeta(['dn1'], { dn1: ['gone'] }, {}, flatLists);
    expect(map.get('dn1')?.chips).toEqual([{ id: 'gone', label: 'gone', breadcrumb: 'gone' }]);
  });

  it('filters the auto-managed lists (Highlights/Notes) out of the chips', () => {
    const map = suttaRowMeta(['dn1'], { dn1: ['l2', HIGHLIGHTS_AUTO_LIST_ID, NOTES_AUTO_LIST_ID] }, {}, flatLists);
    expect(map.get('dn1')?.chips).toEqual([{ id: 'l2', label: 'Read later', breadcrumb: 'Read later' }]);
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
