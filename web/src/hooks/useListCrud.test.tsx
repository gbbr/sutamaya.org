import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useListCrud } from './useListCrud';
import type { ListDef } from '../lib/types';

// renderHook needs jsdom (see useListTreeIndex.test.tsx's note) even though this hook itself
// touches no DOM beyond a ref.

const lists: ListDef[] = [
  { id: 'l1', label: 'Favorites', parentId: null, kind: 'list', items: [] },
  { id: 'l2', label: 'Read later', parentId: null, kind: 'list', items: [] },
  { id: 'l3', label: 'Nested', parentId: 'l1', kind: 'list', items: [] },
];
const listChildrenOf = (parentId: string) => lists.filter((l) => l.parentId === parentId);
const topLevelLists = lists.filter((l) => !l.parentId);

function setup(overrides: Partial<Parameters<typeof useListCrud>[0]> = {}) {
  const setListExpanded = vi.fn();
  const createList = vi.fn(async (label: string, parentId: string | null = null, kind: 'list' | 'group' = 'list') => ({
    id: 'new1',
    label,
    parentId,
    kind,
    items: [],
  }));
  const renameList = vi.fn(async () => {});
  const removeList = vi.fn(async () => {});
  const reorderLists = vi.fn(async () => {});
  const onCreated = vi.fn();
  const { result } = renderHook(() =>
    useListCrud({ listChildrenOf, topLevelLists, setListExpanded, createList, renameList, removeList, reorderLists, onCreated, ...overrides })
  );
  return { result, setListExpanded, createList, renameList, removeList, reorderLists, onCreated };
}

describe('useListCrud', () => {
  it('toggleListMenu opens then closes the same id', () => {
    const { result } = setup();
    act(() => result.current.toggleListMenu('l1'));
    expect(result.current.menuOpenId).toBe('l1');
    act(() => result.current.toggleListMenu('l1'));
    expect(result.current.menuOpenId).toBeNull();
  });

  it('startEditList seeds the draft from the list label and closes the menu', () => {
    const { result } = setup();
    act(() => result.current.toggleListMenu('l1'));
    act(() => result.current.startEditList(lists[0]));
    expect(result.current.editingId).toBe('l1');
    expect(result.current.editDraft).toBe('Favorites');
    expect(result.current.menuOpenId).toBeNull();
  });

  it('commitEditList renames with the trimmed draft and exits edit mode', () => {
    const { result, renameList } = setup();
    act(() => result.current.startEditList(lists[0]));
    act(() => result.current.setEditDraft('  Renamed  '));
    act(() => result.current.commitEditList());
    expect(renameList).toHaveBeenCalledWith('l1', 'Renamed');
    expect(result.current.editingId).toBeNull();
  });

  it('commitEditList does not rename on an empty (or whitespace-only) draft', () => {
    const { result, renameList } = setup();
    act(() => result.current.startEditList(lists[0]));
    act(() => result.current.setEditDraft('   '));
    act(() => result.current.commitEditList());
    expect(renameList).not.toHaveBeenCalled();
  });

  it('cancelEditList exits edit mode without renaming', () => {
    const { result, renameList } = setup();
    act(() => result.current.startEditList(lists[0]));
    act(() => result.current.cancelEditList());
    expect(result.current.editingId).toBeNull();
    expect(renameList).not.toHaveBeenCalled();
  });

  it('armDeleteList arms confirmation and closes the menu; deleteList removes and disarms', () => {
    const { result, removeList } = setup();
    act(() => result.current.toggleListMenu('l2'));
    act(() => result.current.armDeleteList(lists[1]));
    expect(result.current.confirmDeleteId).toBe('l2');
    expect(result.current.menuOpenId).toBeNull();
    act(() => result.current.deleteList(lists[1]));
    expect(removeList).toHaveBeenCalledWith('l2');
    expect(result.current.confirmDeleteId).toBeNull();
  });

  it('cancelDeleteList disarms without removing', () => {
    const { result, removeList } = setup();
    act(() => result.current.armDeleteList(lists[1]));
    act(() => result.current.cancelDeleteList());
    expect(result.current.confirmDeleteId).toBeNull();
    expect(removeList).not.toHaveBeenCalled();
  });

  it('armDeleteList blocks a non-empty list instead of arming confirmation', () => {
    const { result } = setup();
    act(() => result.current.armDeleteList({ id: 'x1', label: 'Nonempty', parentId: null, kind: 'list', items: ['a', 'b'] }));
    expect(result.current.blockedDelete).toEqual({ id: 'x1', count: 2, kind: 'items' });
    expect(result.current.confirmDeleteId).toBeNull();
  });

  it('armDeleteList blocks a non-empty group (by nested list/group count, not items)', () => {
    const { result } = setup();
    // l1 has one child in the fixture list tree (l3, parentId: 'l1') — reused here as a group.
    act(() => result.current.armDeleteList({ ...lists[0], kind: 'group' }));
    expect(result.current.blockedDelete).toEqual({ id: 'l1', count: 1, kind: 'children' });
    expect(result.current.confirmDeleteId).toBeNull();
  });

  it('armDeleteList arms normal confirmation for an empty list/group', () => {
    const { result } = setup();
    act(() => result.current.armDeleteList(lists[1])); // l2: empty list, no children
    expect(result.current.confirmDeleteId).toBe('l2');
    expect(result.current.blockedDelete).toBeNull();
  });

  it('armDeleteList with bypassBlock skips the block and arms normal confirmation for a non-empty list', () => {
    const { result } = setup();
    act(() => result.current.armDeleteList({ id: 'x1', label: 'Nonempty', parentId: null, kind: 'list', items: ['a', 'b'] }, true));
    expect(result.current.confirmDeleteId).toBe('x1');
    expect(result.current.blockedDelete).toBeNull();
  });

  it('armDeleteList with bypassBlock skips the block and arms normal confirmation for a non-empty group', () => {
    const { result } = setup();
    act(() => result.current.armDeleteList({ ...lists[0], kind: 'group' }, true));
    expect(result.current.confirmDeleteId).toBe('l1');
    expect(result.current.blockedDelete).toBeNull();
  });

  it('blockedDelete auto-dismisses after its timeout, with no manual dismiss control', () => {
    vi.useFakeTimers();
    try {
      const { result } = setup();
      act(() => result.current.armDeleteList({ id: 'x1', label: 'Nonempty', parentId: null, kind: 'list', items: ['a'] }));
      expect(result.current.blockedDelete).not.toBeNull();
      act(() => vi.advanceTimersByTime(3999));
      expect(result.current.blockedDelete).not.toBeNull();
      act(() => vi.advanceTimersByTime(1));
      expect(result.current.blockedDelete).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-arming a blocked delete resets its own timeout rather than stacking', () => {
    vi.useFakeTimers();
    try {
      const { result } = setup();
      act(() => result.current.armDeleteList({ id: 'x1', label: 'A', parentId: null, kind: 'list', items: ['a'] }));
      act(() => vi.advanceTimersByTime(3000));
      act(() => result.current.armDeleteList({ id: 'x2', label: 'B', parentId: null, kind: 'list', items: ['b'] }));
      act(() => vi.advanceTimersByTime(3000)); // 3000+3000 > 4000, but the second arm restarted the clock
      expect(result.current.blockedDelete).toEqual({ id: 'x2', count: 1, kind: 'items' });
      act(() => vi.advanceTimersByTime(1000));
      expect(result.current.blockedDelete).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('addChildList expands the parent, opens a draft input scoped to it, and closes the menu', () => {
    const { result, setListExpanded } = setup();
    act(() => result.current.toggleListMenu('l1'));
    act(() => result.current.addChildList('l1'));
    expect(result.current.creatingParentId).toBe('l1');
    expect(result.current.menuOpenId).toBeNull();
    expect(setListExpanded).toHaveBeenCalled();
    const updater = setListExpanded.mock.calls[0][0];
    expect(updater({})).toEqual({ l1: true });
  });

  it('moveList swaps with the previous/next sibling and reorders within the same parent scope', () => {
    const { result, reorderLists } = setup();
    act(() => result.current.moveList(lists[1], -1)); // l2 (index 1 of top-level) moves up
    expect(reorderLists).toHaveBeenCalledWith(null, ['l2', 'l1']);
  });

  it('moveList is a no-op at the start/end of its sibling scope', () => {
    const { result, reorderLists } = setup();
    act(() => result.current.moveList(lists[0], -1)); // l1 is already first
    act(() => result.current.moveList(lists[1], 1)); // l2 is already last
    expect(reorderLists).not.toHaveBeenCalled();
  });

  it('submitDraft at the top level defaults to list, or creates a group once picked', async () => {
    const { result, createList, onCreated } = setup();
    act(() => result.current.setDraft('New List'));
    await act(async () => result.current.submitDraft());
    expect(createList).toHaveBeenCalledWith('New List', null, 'list');
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'new1', label: 'New List' }));
    expect(result.current.draft).toBe('');
    expect(result.current.creatingParentId).toBeUndefined();

    act(() => result.current.setCreatingParentId(null));
    act(() => result.current.setDraftKind('group'));
    act(() => result.current.setDraft('New Group'));
    await act(async () => result.current.submitDraft());
    expect(createList).toHaveBeenCalledWith('New Group', null, 'group');
  });

  it('submitDraft under a parent always creates a list, ignoring draftKind', async () => {
    const { result, createList } = setup();
    act(() => result.current.setCreatingParentId('l1'));
    act(() => result.current.setDraftKind('group')); // no picker shown there, but confirm it's ignored regardless
    act(() => result.current.setDraft('Sub-list'));
    await act(async () => result.current.submitDraft());
    expect(createList).toHaveBeenCalledWith('Sub-list', 'l1', 'list');
  });

  it('toggleTopLevelDraft opens/closes the top-level draft and resets draftKind to list', () => {
    const { result } = setup();
    act(() => result.current.setDraftKind('group'));
    act(() => result.current.toggleTopLevelDraft());
    expect(result.current.creatingParentId).toBeNull();
    expect(result.current.draftKind).toBe('list');
    act(() => result.current.toggleTopLevelDraft());
    expect(result.current.creatingParentId).toBeUndefined();
  });

  it('submitDraft does nothing for an empty name, still closing the draft input', async () => {
    const { result, createList } = setup();
    act(() => result.current.setCreatingParentId(null));
    act(() => result.current.setDraft('   '));
    await act(async () => result.current.submitDraft());
    expect(createList).not.toHaveBeenCalled();
    expect(result.current.creatingParentId).toBeUndefined();
  });

  it('onDraftKey submits on Enter and clears the draft on Escape', async () => {
    const { result, createList } = setup();
    act(() => result.current.setCreatingParentId(null));
    act(() => result.current.setDraft('Via Enter'));
    await act(async () => result.current.onDraftKey({ key: 'Enter', preventDefault: () => {} } as never));
    expect(createList).toHaveBeenCalledWith('Via Enter', null, 'list');

    act(() => result.current.setCreatingParentId(null));
    act(() => result.current.setDraft('Discarded'));
    act(() => result.current.onDraftKey({ key: 'Escape', preventDefault: () => {} } as never));
    expect(result.current.draft).toBe('');
    expect(result.current.creatingParentId).toBeUndefined();
  });
});
