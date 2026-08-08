import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { UserDataProvider, useUserData } from './UserDataContext';
import type { UserData } from '../lib/api';
import { RECENT_AUTO_LIST_ID } from '../lib/autoLists';

// UserDataProvider reads `useAuth()` straight from AuthContext (not injected), so a signed-in
// user is stubbed here rather than wrapping every test in a real AuthProvider (which would need
// its own authApi.me() mock plumbing this hook doesn't otherwise care about).
const mockUser = { id: 'u1', email: 'a@b.com', name: 'A', picture: '' };
const promptGoogleSignIn = vi.fn();
vi.mock('./AuthContext', () => ({
  useAuth: () => ({ user: mockUser, promptGoogleSignIn }),
}));

const dataApiAll = vi.fn();
const listsApiRename = vi.fn();
const notesApiSet = vi.fn();
const highlightsApiSetRanges = vi.fn();

vi.mock('../lib/api', () => ({
  dataApi: { all: (...args: unknown[]) => dataApiAll(...args) },
  listsApi: {
    create: vi.fn(),
    rename: (...args: unknown[]) => listsApiRename(...args),
    setParent: vi.fn(),
    remove: vi.fn(),
    reorder: vi.fn(),
    reorderItems: vi.fn(),
    addItem: vi.fn(),
    removeItem: vi.fn(),
  },
  notesApi: { set: (...args: unknown[]) => notesApiSet(...args) },
  highlightsApi: { setRanges: (...args: unknown[]) => highlightsApiSetRanges(...args), remove: vi.fn() },
  visitedApi: { mark: vi.fn(() => Promise.resolve()) },
}));

const baseData: UserData = {
  lists: [{ id: 'l1', label: 'Favorites', parentId: null, kind: 'list', items: [] }],
  membership: {},
  notes: {},
  highlights: {},
  visited: {},
};

function setup() {
  return renderHook(() => useUserData(), { wrapper: UserDataProvider });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('UserDataProvider', () => {
  it('fetches user data on mount and marks ready once loaded', async () => {
    dataApiAll.mockResolvedValue(structuredClone(baseData));
    const { result } = setup();
    expect(result.current.ready).toBe(false);
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.lists).toEqual(baseData.lists);
  });

  it('renameList applies the edit optimistically and keeps it after a successful save', async () => {
    dataApiAll.mockResolvedValue(structuredClone(baseData));
    listsApiRename.mockResolvedValueOnce({ ok: true });
    const { result } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.renameList('l1', 'New label');
    });

    expect(result.current.lists[0].label).toBe('New label');
    // No resync on success for renameList — the optimistic edit is the final state, and
    // dataApi.all should only have been called once, for the initial mount fetch.
    expect(dataApiAll).toHaveBeenCalledTimes(1);
  });

  it('rolls back to server truth and logs when a rename fails to save', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    dataApiAll
      .mockResolvedValueOnce(structuredClone(baseData)) // initial mount fetch
      .mockResolvedValueOnce({ ...structuredClone(baseData), lists: [{ ...baseData.lists[0], label: 'Favorites' }] }); // resync-after-failure
    listsApiRename.mockRejectedValueOnce(new Error('boom'));
    const { result } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.renameList('l1', 'Optimistic label');
    });

    // The failed write's optimistic edit never actually happened server-side — the resync
    // discards it and restores the real stored label.
    expect(result.current.lists[0].label).toBe('Favorites');
    expect(errorSpy).toHaveBeenCalledWith('rename list failed', expect.any(Error));
    expect(dataApiAll).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });

  it('submitNote syncs fresh server state (including derived auto-lists) after a successful save', async () => {
    dataApiAll
      .mockResolvedValueOnce(structuredClone(baseData)) // initial mount fetch
      .mockResolvedValueOnce({ ...structuredClone(baseData), notes: { dn1: 'saved note' } }); // syncUserData after success
    notesApiSet.mockResolvedValueOnce({ ok: true });
    const { result } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.submitNote('dn1', 'saved note');
    });

    expect(result.current.notes.dn1).toBe('saved note');
    expect(dataApiAll).toHaveBeenCalledTimes(2);
  });

  it('setHighlightRanges resyncs and rethrows when the save fails, so its caller sees the error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    dataApiAll.mockResolvedValue(structuredClone(baseData));
    highlightsApiSetRanges.mockRejectedValueOnce(new Error('network down'));
    const { result } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));

    await expect(
      act(async () => {
        await result.current.setHighlightRanges('dn1', [{ i: 0, s: 0, e: 5 }], 'yellow');
      })
    ).rejects.toThrow('network down');

    expect(errorSpy).toHaveBeenCalledWith('set highlight ranges failed', expect.any(Error));
    // Mount fetch + resync-after-failure.
    expect(dataApiAll).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });

  it('markVisited is a no-op on `lists` when the sutta is already at the front of Recent', async () => {
    dataApiAll.mockResolvedValue({
      ...structuredClone(baseData),
      lists: [...structuredClone(baseData.lists), { id: RECENT_AUTO_LIST_ID, label: 'Recent', parentId: null, kind: 'list', items: ['dn1'], auto: true }],
      visited: { dn1: '2024-01-01T00:00:00.000Z' },
    });
    const { result } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));

    const listsBefore = result.current.lists;
    act(() => {
      result.current.markVisited('dn1');
    });

    // `visited[dn1]` is already set, so that bail-out is exercised too — but the point of this
    // test is that `lists` (already correctly ordered) keeps the same reference, not just the
    // same content, so consumers keyed on it (useListTreeIndex, ListPane's flatLists) don't
    // rebuild for nothing.
    expect(result.current.lists).toBe(listsBefore);
  });
});
