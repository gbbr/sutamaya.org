import { describe, expect, it } from 'vitest';
import { ancestorsOfList } from './lists';
import type { ListDef } from './types';

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
