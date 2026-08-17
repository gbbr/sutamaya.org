import { describe, expect, it } from 'vitest';
import { createListRecord, emptyMirror, queueMembership, removeListRecord, setNoteRecord, writeHighlightRecord, markVisitedRecord, type MirrorState } from './mirror';
import { deriveUserData, highlightRowsFor } from './mirrorView';
import { HIGHLIGHTS_AUTO_LIST_ID, NOTES_AUTO_LIST_ID, RECENT_AUTO_LIST_ID } from './autoLists';

function list(state: MirrorState, id: string, parentId: string | null = null, kind: 'list' | 'group' = 'list'): MirrorState {
  return createListRecord(state, { id, label: id, parentId, kind });
}

describe('deriveUserData', () => {
  it('derives membership from the lists own items', () => {
    let state = list(emptyMirror('u1'), 'l1');
    state = list(state, 'l2');
    state = queueMembership(state, 'l1', 'dn1', true);
    state = queueMembership(state, 'l2', 'dn1', true);

    const { membership } = deriveUserData(state);
    expect(membership.dn1.sort()).toEqual(['l1', 'l2']);
  });

  it('drops a tombstoned group and everything beneath it', () => {
    let state = list(emptyMirror('u1'), 'g1', null, 'group');
    state = list(state, 'c1', 'g1');
    state = list(state, 'gc1', 'c1');
    state = list(state, 'keep');
    // A pending create is dropped outright rather than tombstoned, so the group is pushed through a
    // pull-shaped state first: mark it clean, then delete it.
    state = { ...state, lists: { ...state.lists, g1: { dirty: false, data: { ...state.lists.g1.data, pendingCreate: false } } } };
    state = removeListRecord(state, 'g1');

    // Deleting a folder deletes what is inside it — one tombstone, and the read-time cascade does
    // the rest, which is what makes two devices agree without communicating.
    expect(deriveUserData(state).lists.map((l) => l.id)).toEqual(['keep']);
  });

  it('re-homes a list whose parent is missing entirely rather than dropping it', () => {
    const state = list(emptyMirror('u1'), 'orphan', 'never-pulled');

    // A dangling parentId is not a delete — dropping it would lose a list with no tombstone to
    // explain why.
    expect(deriveUserData(state).lists).toEqual([
      { id: 'orphan', label: 'orphan', parentId: null, kind: 'list', items: [] },
    ]);
  });

  it('synthesizes the three auto-lists from the mirror, so they work offline', () => {
    let state = setNoteRecord(emptyMirror('u1'), 'dn1', 'a note');
    state = writeHighlightRecord(state, 'dn2', [{ i: 0, s: 0, e: 4 }], 'yellow');
    state = markVisitedRecord(state, 'dn3');

    const { lists, membership } = deriveUserData(state);
    expect(lists.find((l) => l.id === NOTES_AUTO_LIST_ID)?.items).toEqual(['dn1']);
    expect(lists.find((l) => l.id === HIGHLIGHTS_AUTO_LIST_ID)?.items).toEqual(['dn2']);
    expect(lists.find((l) => l.id === RECENT_AUTO_LIST_ID)?.items).toEqual(['dn3']);
    expect(membership.dn1).toEqual([NOTES_AUTO_LIST_ID]);
  });

  it('leaves a cleared note out, while keeping the record that has to lose the merge', () => {
    let state = setNoteRecord(emptyMirror('u1'), 'dn1', 'a note');
    state = setNoteRecord(state, 'dn1', '');

    const { notes, lists } = deriveUserData(state);
    expect(notes.dn1).toBeUndefined();
    expect(lists.some((l) => l.id === NOTES_AUTO_LIST_ID)).toBe(false);
    // The record itself stays: it is what a stale device pushing the old body back loses against.
    expect(state.notes.dn1.data.text).toBe('');
  });

  it('renders one row per segment of a group, keyed stably by its group id', () => {
    const state = writeHighlightRecord(
      emptyMirror('u1'),
      'dn1',
      [
        { i: 0, s: 3, e: 9 },
        { i: 1, s: 0, e: 4 },
      ],
      'green'
    );
    const rows = deriveUserData(state).highlights.dn1;
    const g = rows[0].g;

    // Row ids are derived from (g, segment), not minted by the server, so they survive a pull
    // unchanged — they only ever serve as React keys and scroll targets.
    expect(rows.map((r) => r.id)).toEqual([`${g}:0`, `${g}:1`]);
    expect(rows.every((r) => r.c === 'green')).toBe(true);
    expect(highlightRowsFor(state, 'dn1')).toHaveLength(2);
  });

  it('reports no rows for an erase-only write', () => {
    let state = writeHighlightRecord(emptyMirror('u1'), 'dn1', [{ i: 0, s: 0, e: 4 }], 'yellow');
    state = { ...state, highlights: Object.fromEntries(Object.entries(state.highlights).map(([g, r]) => [g, { dirty: false, data: r.data }])) };
    state = writeHighlightRecord(state, 'dn1', [{ i: 0, s: 0, e: 4 }], null);

    // The write still has to be pushed (it names the group it tombstones), but it paints nothing.
    expect(Object.keys(state.highlights)).toHaveLength(1);
    expect(deriveUserData(state).highlights.dn1).toBeUndefined();
  });
});
