import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { UserDataProvider, useUserData } from './UserDataContext';
import type { UserData } from '../lib/api';
import { RECENT_AUTO_LIST_ID } from '../lib/autoLists';

// UserDataProvider reads `useAuth()` straight from AuthContext (not injected), so a signed-in
// user is stubbed here rather than wrapping every test in a real AuthProvider (which would need
// its own authApi.me() mock plumbing this hook doesn't otherwise care about).
const signedInUser = { id: 'u1', email: 'a@b.com', name: 'A', picture: '' };
// Mutable so a test can sign out mid-flight (the useAuth stub reads it per call, not once at
// mock-factory time); reset in beforeEach.
let mockUser: typeof signedInUser | null = signedInUser;
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
  highlightsApi: { setRanges: (...args: unknown[]) => highlightsApiSetRanges(...args) },
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
  mockUser = signedInUser;
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

  // The client names the group it is creating and the groups the selection displaces, rather than
  // letting the server work the latter out from whatever overlaps by the time the write lands —
  // that's what makes the write mean the same thing whenever it's replayed.
  it('setHighlightRanges mints the group and names the groups it displaces', async () => {
    const existing = { id: 'h1', i: 0, s: 0, e: 10, c: 'yellow', g: 'g1', m: '2026-01-01T00:00:00.000Z|dev' };
    const untouched = { id: 'h2', i: 4, s: 0, e: 4, c: 'blue', g: 'g2', m: '2026-01-01T00:00:00.000Z|dev' };
    dataApiAll.mockResolvedValue({ ...structuredClone(baseData), highlights: { dn1: [existing, untouched] } });
    highlightsApiSetRanges.mockResolvedValueOnce({ ok: true });
    const { result } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.setHighlightRanges('dn1', [{ i: 0, s: 5, e: 12 }], 'green');
    });

    expect(highlightsApiSetRanges).toHaveBeenCalledWith('dn1', [{ i: 0, s: 5, e: 12 }], 'green', {
      g: expect.any(String),
      mtime: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\|.+$/),
      erase: ['g1'],
    });
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

  it('ignores a whole-dataset sync whose response lands after a newer one started', async () => {
    const stale = { ...structuredClone(baseData), lists: [{ ...baseData.lists[0], label: 'Stale' }] };
    const fresh = { ...structuredClone(baseData), lists: [{ ...baseData.lists[0], label: 'Fresh' }] };
    let releaseStale: (v: UserData) => void = () => {};
    dataApiAll
      .mockResolvedValueOnce(structuredClone(baseData)) // initial mount fetch
      .mockImplementationOnce(() => new Promise<UserData>((resolve) => { releaseStale = resolve; }))
      .mockResolvedValueOnce(fresh);
    const { result } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));

    // Two syncs overlap — the one issued *first* is the one that resolves last, which is the
    // ordinary case on a slow connection when two mutations are made in quick succession.
    let slowSync: Promise<void> = Promise.resolve();
    act(() => {
      slowSync = result.current.syncUserData();
    });
    await act(async () => {
      await result.current.syncUserData();
    });
    expect(result.current.lists[0].label).toBe('Fresh');

    await act(async () => {
      releaseStale(stale);
      await slowSync;
    });

    // Without the generation guard the older snapshot lands last and silently reverts the newer
    // one on screen.
    expect(result.current.lists[0].label).toBe('Fresh');
  });

  it('keeps both membership toggles when two are made on one sutta before a re-render', async () => {
    dataApiAll.mockResolvedValue({
      ...structuredClone(baseData),
      lists: [...structuredClone(baseData.lists), { id: 'l2', label: 'Later', parentId: null, kind: 'list', items: [] }],
    });
    const { result } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await Promise.all([result.current.toggleMembership('dn1', 'l1'), result.current.toggleMembership('dn1', 'l2')]);
    });

    // Both calls see the same (empty) `membership` closure, so deriving the next value from it
    // rather than from the updater's own argument drops whichever chip was added first.
    expect(result.current.membership.dn1).toEqual(['l1', 'l2']);
  });

  it('drops an in-flight sync when the user signs out, instead of repopulating cleared state', async () => {
    let releaseSync: (v: UserData) => void = () => {};
    dataApiAll
      .mockResolvedValueOnce(structuredClone(baseData)) // initial mount fetch
      .mockImplementationOnce(() => new Promise<UserData>((resolve) => { releaseSync = resolve; }));
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));

    let slowSync: Promise<void> = Promise.resolve();
    act(() => {
      slowSync = result.current.syncUserData();
    });

    mockUser = null;
    rerender();
    expect(result.current.lists).toEqual([]);

    await act(async () => {
      releaseSync(structuredClone(baseData));
      await slowSync;
    });

    // The signed-in session's data must not come back after sign-out just because its fetch was
    // still in flight when the user logged out.
    expect(result.current.lists).toEqual([]);
    expect(result.current.notes).toEqual({});
  });

  it('syncUserData reconciles `visited` along with the rest of the dataset', async () => {
    dataApiAll
      .mockResolvedValueOnce(structuredClone(baseData)) // initial mount fetch
      .mockResolvedValueOnce({ ...structuredClone(baseData), visited: { dn1: '2024-05-05T00:00:00.000Z' } });
    const { result } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.visited).toEqual({});

    await act(async () => {
      await result.current.syncUserData();
    });

    // Left out of the sync, `visited` would be write-once at load — a failed visitedApi.mark would
    // leave its optimistic read-marker standing forever, and another device's reads never appear.
    expect(result.current.visited).toEqual({ dn1: '2024-05-05T00:00:00.000Z' });
  });

  it('retries the initial fetch after a transient failure rather than settling on empty data', async () => {
    vi.useFakeTimers();
    try {
      dataApiAll
        .mockRejectedValueOnce(new Error('network blip'))
        .mockResolvedValueOnce(structuredClone(baseData));
      const { result } = setup();

      // First attempt has failed; still not ready, and nothing applied yet.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.ready).toBe(false);
      expect(result.current.lists).toEqual([]);

      // Past the first backoff step (RETRY_DELAYS_MS[0] = 500ms) the retry succeeds.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      expect(dataApiAll).toHaveBeenCalledTimes(2);
      expect(result.current.lists).toEqual(baseData.lists);
      expect(result.current.ready).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
