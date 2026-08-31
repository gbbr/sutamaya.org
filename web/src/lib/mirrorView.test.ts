import { describe, expect, it } from 'vitest';
import { createListRecord, emptyMirror, queueMembership, removeListRecord, setNoteRecord, writeHighlightRecord, markVisitedRecord, type MirrorState } from './mirror';
import { deriveUserData, highlightsFor } from './mirrorView';
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
    state = writeHighlightRecord(state, 'dn2', { i0: 0, o0: 0, i1: 0, o1: 4 }, 'yellow');
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

  it('renders a cross-segment highlight as one row carrying both ends', () => {
    const state = writeHighlightRecord(emptyMirror('u1'), 'dn1', { i0: 0, o0: 3, i1: 1, o1: 4 }, 'green');
    const [row, ...rest] = deriveUserData(state).highlights.dn1;

    expect(rest).toEqual([]);
    // The row's id is the id the client minted, not one the server assigned, so it survives a pull
    // unchanged — it serves as a React key, a scroll target and the handle a click acts on.
    expect(row).toMatchObject({ id: Object.keys(state.highlights)[0], i0: 0, o0: 3, i1: 1, o1: 4, c: 'green' });
    expect(highlightsFor(state, 'dn1')).toHaveLength(1);
  });

  // The reader's highlights panel lists them top to bottom, and the gutter draws its marks from the
  // same array — neither has an order of its own to impose.
  it('puts a sutta\'s highlights in document order, not mirror order', () => {
    let state = writeHighlightRecord(emptyMirror('u1'), 'dn1', { i0: 8, o0: 0, i1: 8, o1: 4 }, 'green');
    state = writeHighlightRecord(state, 'dn1', { i0: 2, o0: 5, i1: 3, o1: 1 }, 'yellow');
    state = writeHighlightRecord(state, 'dn1', { i0: 2, o0: 0, i1: 2, o1: 4 }, 'blue');

    expect(deriveUserData(state).highlights.dn1.map((r) => [r.i0, r.o0])).toEqual([
      [2, 0],
      [2, 5],
      [8, 0],
    ]);
  });

  // Only reachable through a mirror persisted by an app version upgradeStoredMirror doesn't cover.
  // Losing the highlight is the right failure; taking the reader down with it is not.
  it('drops a record with no span rather than throwing', () => {
    const state = writeHighlightRecord(emptyMirror('u1'), 'dn1', { i0: 0, o0: 0, i1: 0, o1: 4 }, 'yellow');
    const [g] = Object.keys(state.highlights);
    const { span: _dropped, ...rest } = state.highlights[g].data;
    const malformed = { ...state, highlights: { [g]: { dirty: false, data: rest } } } as unknown as MirrorState;

    expect(deriveUserData(malformed).highlights.dn1).toBeUndefined();
    expect(highlightsFor(malformed, 'dn1')).toEqual([]);
  });

  it('reports no row for an erase-only write', () => {
    let state = writeHighlightRecord(emptyMirror('u1'), 'dn1', { i0: 0, o0: 0, i1: 0, o1: 4 }, 'yellow');
    state = { ...state, highlights: Object.fromEntries(Object.entries(state.highlights).map(([g, r]) => [g, { dirty: false, data: r.data }])) };
    state = writeHighlightRecord(state, 'dn1', { i0: 0, o0: 0, i1: 0, o1: 4 }, null);

    // The write still has to be pushed (it names the highlight it tombstones), but it paints
    // nothing.
    expect(Object.keys(state.highlights)).toHaveLength(1);
    expect(deriveUserData(state).highlights.dn1).toBeUndefined();
  });

  // Displacement is decided on (segment, offset) pairs alone, which is what lets the mirror work it
  // out with no sutta text loaded — including where the overlap is in a segment neither end sits in.
  it('displaces a cross-segment highlight overlapped only in the middle of its span', () => {
    let state = writeHighlightRecord(emptyMirror('u1'), 'dn1', { i0: 0, o0: 2, i1: 5, o1: 3 }, 'yellow');
    const [first] = Object.keys(state.highlights);
    state = writeHighlightRecord(state, 'dn1', { i0: 3, o0: 0, i1: 3, o1: 6 }, 'green');

    expect(state.highlights[first]).toBeUndefined();
    expect(deriveUserData(state).highlights.dn1.map((r) => r.c)).toEqual(['green']);
  });
});
