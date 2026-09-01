import { describe, expect, it } from 'vitest';
import {
  assembleUserData,
  RECENT_AUTO_LIST_ID,
  HIGHLIGHTS_AUTO_LIST_ID,
  NOTES_AUTO_LIST_ID,
  AUTO_LIST_CAP,
  VISITED_AUTO_LIST_CAP,
} from './userData.js';

const empty = { listDocs: [], noteDocs: [], highlightDocs: [], visitedDocs: [] };

describe('assembleUserData', () => {
  it('returns empty shapes and no auto-lists when the user has nothing', () => {
    expect(assembleUserData(empty)).toEqual({ lists: [], membership: {}, notes: {}, highlights: {}, visited: {} });
  });

  it('builds lists and derives membership from each list’s items', () => {
    const result = assembleUserData({
      ...empty,
      listDocs: [
        { id: 'g1', data: { label: 'Study', kind: 'group', items: [] } },
        { id: 'l1', data: { label: 'Favorites', parentId: 'g1', kind: 'list', items: ['dn1', 'dn2'] } },
      ],
    });
    expect(result.lists).toEqual([
      { id: 'g1', label: 'Study', parentId: null, kind: 'group', items: [] },
      { id: 'l1', label: 'Favorites', parentId: 'g1', kind: 'list', items: ['dn1', 'dn2'] },
    ]);
    expect(result.membership).toEqual({ dn1: ['l1'], dn2: ['l1'] });
  });

  // listDocs arrives with its tombstones (unlike the other three), so the drop-and-cascade happens
  // here rather than in SQL — and a deleted group must take its children's membership chips with it.
  it('drops a tombstoned list and everything beneath it, membership included', () => {
    const result = assembleUserData({
      ...empty,
      listDocs: [
        { id: 'g1', data: { label: 'Study', kind: 'group', items: [], deleted: 1 } },
        { id: 'l1', data: { label: 'Buried', parentId: 'g1', kind: 'list', items: ['dn1'] } },
        { id: 'l2', data: { label: 'Kept', kind: 'list', items: ['dn2'] } },
      ],
    });
    expect(result.lists.map((l) => l.id)).toEqual(['l2']);
    expect(result.membership).toEqual({ dn2: ['l2'] });
  });

  // A parentId pointing at no doc at all is the dangling case, not a delete — re-homed, not dropped.
  it('re-homes a list whose parent is absent from the doc set entirely', () => {
    const result = assembleUserData({
      ...empty,
      listDocs: [{ id: 'l1', data: { label: 'Dangler', parentId: 'never-synced', kind: 'list', items: [] } }],
    });
    expect(result.lists).toEqual([{ id: 'l1', label: 'Dangler', parentId: null, kind: 'list', items: [] }]);
  });

  // position/mtime/deleted are inputs to the repair only — they must not reach the client.
  it('does not leak position, mtime or deleted into the returned lists', () => {
    const result = assembleUserData({
      ...empty,
      listDocs: [{ id: 'l1', data: { label: 'X', kind: 'list', items: [], position: -3, mtime: '2026-01-01|d', deleted: 0 } }],
    });
    expect(result.lists).toEqual([{ id: 'l1', label: 'X', parentId: null, kind: 'list', items: [] }]);
  });

  it('orders lists by position, tie-breaking on id', () => {
    const result = assembleUserData({
      ...empty,
      listDocs: [
        { id: 'b', data: { label: 'B', items: [], position: 0 } },
        { id: 'a', data: { label: 'A', items: [], position: 0 } },
        { id: 'first', data: { label: 'First', items: [], position: -1 } },
      ],
    });
    expect(result.lists.map((l) => l.id)).toEqual(['first', 'a', 'b']);
  });

  it('defaults a doc with no kind field to a plain list', () => {
    const result = assembleUserData({ ...empty, listDocs: [{ id: 'l1', data: { label: 'X', items: [] } }] });
    expect(result.lists[0].kind).toBe('list');
  });

  it('maps notes by doc id, carrying each one’s mtime', () => {
    // `m` is what the client orders its own Notes auto-list by (web/src/lib/mirrorView.ts derives
    // it over the mirror so an offline note appears there with no round trip); dropping it here
    // leaves every pulled note comparing equal and the list in SELECT order.
    const result = assembleUserData({
      ...empty,
      noteDocs: [{ id: 'dn1', data: { text: 'hello', updatedAt: '2026-08-01T00:00:00.000Z|a' } }],
    });
    expect(result.notes).toEqual({ dn1: { text: 'hello', m: '2026-08-01T00:00:00.000Z|a' } });
  });

  it('groups highlights by suttaId, preserving each entry’s fields', () => {
    const result = assembleUserData({
      ...empty,
      highlightDocs: [{ id: 'h1', data: { suttaId: 'dn1', i0: 0, o0: 5, i1: 2, o1: 10, color: 'y', mtime: '2026-08-01T00:00:00.000Z|a' } }],
    });
    expect(result.highlights).toEqual({ dn1: [{ id: 'h1', i0: 0, o0: 5, i1: 2, o1: 10, c: 'y', m: '2026-08-01T00:00:00.000Z|a' }] });
  });

  it('maps visited by doc id to visitedAt', () => {
    const result = assembleUserData({ ...empty, visitedDocs: [{ id: 'dn1', data: { visitedAt: '2026-08-01' } }] });
    expect(result.visited).toEqual({ dn1: '2026-08-01' });
  });

  it('synthesizes a Recent auto-list from visited docs, most recent first, and adds membership', () => {
    const result = assembleUserData({
      ...empty,
      visitedDocs: [
        { id: 'dn1', data: { visitedAt: '2026-08-01' } },
        { id: 'dn2', data: { visitedAt: '2026-08-05' } },
      ],
    });
    const recent = result.lists.find((l) => l.id === RECENT_AUTO_LIST_ID);
    expect(recent).toMatchObject({ label: 'Visited', parentId: null, kind: 'list', auto: true, items: ['dn2', 'dn1'] });
    expect(result.membership.dn2).toContain(RECENT_AUTO_LIST_ID);
  });

  it('synthesizes Highlights and Notes auto-lists the same way', () => {
    const result = assembleUserData({
      ...empty,
      highlightDocs: [{ id: 'h1', data: { suttaId: 'dn1', i: 0, s: 0, e: 1, createdAt: '2026-08-01' } }],
      noteDocs: [{ id: 'dn3', data: { text: 'note', updatedAt: '2026-08-01' } }],
    });
    expect(result.lists.find((l) => l.id === HIGHLIGHTS_AUTO_LIST_ID)).toMatchObject({ label: 'Highlights', items: ['dn1'] });
    expect(result.lists.find((l) => l.id === NOTES_AUTO_LIST_ID)).toMatchObject({ label: 'Notes', items: ['dn3'] });
  });

  it('omits an auto-list entirely when its source collection is empty', () => {
    const result = assembleUserData(empty);
    expect(result.lists.some((l) => l.auto)).toBe(false);
  });

  it('caps each auto-list at its own cap, and reports the uncapped total', () => {
    const visitedDocs = Array.from({ length: VISITED_AUTO_LIST_CAP + 5 }, (_, i) => ({
      id: `s${i}`,
      data: { visitedAt: String(i).padStart(4, '0') },
    }));
    const highlightDocs = Array.from({ length: AUTO_LIST_CAP + 5 }, (_, i) => ({
      id: `h${i}`,
      data: { suttaId: `s${i}`, createdAt: String(i).padStart(4, '0') },
    }));
    const result = assembleUserData({ ...empty, visitedDocs, highlightDocs });
    const recent = result.lists.find((l) => l.id === RECENT_AUTO_LIST_ID);
    const highlights = result.lists.find((l) => l.id === HIGHLIGHTS_AUTO_LIST_ID);
    expect(recent.items).toHaveLength(VISITED_AUTO_LIST_CAP);
    expect(highlights.items).toHaveLength(AUTO_LIST_CAP);
    // What the reader has, which is what the tree's count badge and ListPane's "Showing N of M"
    // are drawn from — so a cap that bites can't quietly become the number displayed.
    expect(recent.total).toBe(VISITED_AUTO_LIST_CAP + 5);
    expect(highlights.total).toBe(AUTO_LIST_CAP + 5);
  });

  it('counts a sutta once in Highlights however many times it is highlighted', () => {
    const highlightDocs = Array.from({ length: 6 }, (_, i) => ({
      id: `h${i}`,
      data: { suttaId: 'mn1', createdAt: String(i).padStart(4, '0') },
    }));
    const result = assembleUserData({ ...empty, highlightDocs });
    const highlights = result.lists.find((l) => l.id === HIGHLIGHTS_AUTO_LIST_ID);
    expect(highlights.items).toEqual(['mn1']);
    expect(highlights.total).toBe(1);
  });

  it('dedupes a sutta highlighted multiple times into one Highlights entry', () => {
    const result = assembleUserData({
      ...empty,
      highlightDocs: [
        { id: 'h1', data: { suttaId: 'dn1', createdAt: '2026-08-01' } },
        { id: 'h2', data: { suttaId: 'dn1', createdAt: '2026-08-02' } },
      ],
    });
    expect(result.lists.find((l) => l.id === HIGHLIGHTS_AUTO_LIST_ID).items).toEqual(['dn1']);
  });
});
