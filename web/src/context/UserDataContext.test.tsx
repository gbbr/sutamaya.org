// The mirror is real IndexedDB, so the suite gets a real (in-memory) implementation of it rather
// than a hand-written stub — "survives a reload" only means anything against a store that actually
// persists between mounts.
import 'fake-indexeddb/auto';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { UserDataProvider, useUserData } from './UserDataContext';
import type { UserData } from '../lib/api';
import type { ListDef } from '../lib/types';
import { RECENT_AUTO_LIST_ID } from '../lib/autoLists';

// UserDataProvider reads `useAuth()` straight from AuthContext (not injected), so a signed-in
// user is stubbed here rather than wrapping every test in a real AuthProvider (which would need
// its own authApi.me() mock plumbing this hook doesn't otherwise care about).
// Mutable so a test can sign out mid-flight (the useAuth stub reads it per call, not once at
// mock-factory time); given a fresh id per test in beforeEach, since the mirror is keyed by user
// id and fake-indexeddb keeps its contents for the whole file.
let mockUser: { id: string; email: string; name: string; picture: string } | null = null;
// The id the provider files data under while signed out (see lib/localAccount.ts). Given a fresh
// value per test alongside `mockUser`, for the same reason: fake-indexeddb keeps its contents for
// the whole file, and a shared local id would leak one test's signed-out mirror into the next.
let mockLocalId = 'local-test';
const promptGoogleSignIn = vi.fn();
vi.mock('./AuthContext', () => ({
  useAuth: () => ({
    user: mockUser,
    isSignedIn: !!mockUser,
    dataUserId: mockUser?.id ?? mockLocalId,
    localUserId: mockLocalId,
    promptGoogleSignIn,
  }),
}));

// Every network call the flush can make, plus the order they were made in — "records before
// operations" is a correctness rule (an op naming a list the server has never seen is dropped), so
// it is asserted rather than assumed.
const calls: string[] = [];
const dataApiAll = vi.fn();
const listsApiCreate = vi.fn();
const listsApiUpdate = vi.fn();
const listsApiRemove = vi.fn();
const listsApiAddItem = vi.fn();
const listsApiRemoveItem = vi.fn();
const listsApiReorderItems = vi.fn();
const notesApiSet = vi.fn();
const highlightsApiSetRanges = vi.fn();
const visitedApiMark = vi.fn();

function record<T extends (...args: never[]) => unknown>(name: string, fn: T) {
  return (...args: Parameters<T>) => {
    calls.push(name);
    return fn(...args);
  };
}

vi.mock('../lib/api', () => ({
  dataApi: { all: (...args: unknown[]) => dataApiAll(...args) },
  listsApi: {
    create: (...args: unknown[]) => listsApiCreate(...args),
    update: (...args: unknown[]) => listsApiUpdate(...args),
    remove: (...args: unknown[]) => listsApiRemove(...args),
    addItem: (...args: unknown[]) => listsApiAddItem(...args),
    removeItem: (...args: unknown[]) => listsApiRemoveItem(...args),
    reorderItems: (...args: unknown[]) => listsApiReorderItems(...args),
  },
  notesApi: { set: (...args: unknown[]) => notesApiSet(...args) },
  highlightsApi: { setRanges: (...args: unknown[]) => highlightsApiSetRanges(...args) },
  visitedApi: { mark: (...args: unknown[]) => visitedApiMark(...args) },
}));

// `membership` is derived from each list's own `items` client-side now (the mirror is the source of
// truth, so it has to be derivable with no network), which is why the fixture's two agree.
const baseData: UserData = {
  lists: [{ id: 'l1', label: 'Favorites', parentId: null, kind: 'list', items: ['dn1'] }],
  membership: { dn1: ['l1'] },
  notes: {},
  highlights: {},
  visited: {},
};

// A failure with no HTTP status — what an unreachable network looks like to api.ts, and what the
// flush has to treat as "stop, keep everything, try again later".
function offline() {
  return Promise.reject(new Error('Failed to fetch'));
}

function httpError(status: number) {
  return Promise.reject(Object.assign(new Error(`Request failed (${status})`), { status }));
}

function setup() {
  return renderHook(() => useUserData(), { wrapper: UserDataProvider });
}

// The flush is debounced by a couple of seconds after a mutation; `online` is one of its immediate
// triggers, so a test that wants a flush *now* asks for one the same way a reconnect would.
async function reconnect() {
  await act(async () => {
    window.dispatchEvent(new Event('online'));
    await Promise.resolve();
  });
}

// IndexedDB writes settle on their own turn, so a test that unmounts the provider straight after a
// mutation has to let the save land before the "reload" can find it.
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

let seq = 0;

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  seq += 1;
  mockUser = { id: `u${seq}`, email: 'a@b.com', name: 'A', picture: '' };
  mockLocalId = `local-${seq}`;
  dataApiAll.mockResolvedValue(structuredClone(baseData));
  listsApiCreate.mockImplementation(record('create', async () => ({ list: null })));
  listsApiUpdate.mockImplementation(record('update', async () => ({ ok: true })));
  listsApiRemove.mockImplementation(record('remove', async () => ({ ok: true })));
  listsApiAddItem.mockImplementation(record('addItem', async () => ({ ok: true })));
  listsApiRemoveItem.mockImplementation(record('removeItem', async () => ({ ok: true })));
  listsApiReorderItems.mockImplementation(record('reorderItems', async () => ({ ok: true })));
  notesApiSet.mockImplementation(record('note', async () => ({ ok: true })));
  highlightsApiSetRanges.mockImplementation(record('highlight', async () => ({ ok: true })));
  visitedApiMark.mockImplementation(record('visited', async () => ({ ok: true })));
});

describe('UserDataProvider', () => {
  it('is ready as soon as the local mirror is loaded, then fills in from the first pull', async () => {
    const { result } = setup();
    // Readiness is a question about local data, so it settles without the network — nothing
    // downstream (see useSuttaReading's scroll restore) waits on a server round trip any more.
    await waitFor(() => expect(result.current.ready).toBe(true));
    await waitFor(() => expect(result.current.lists).toEqual(baseData.lists));
    expect(result.current.membership).toEqual(baseData.membership);
  });

  it('does not re-read the mirror when the same account arrives as a fresh user object', async () => {
    // AuthContext seeds `user` synchronously from localStorage and then replaces it with whatever
    // GET /api/auth/me answers — a new object carrying the same id. Reacting to that identity
    // change re-read the mirror mid-session, so `ready` dropped back to false and every chip, note
    // preview and highlight blanked and restored a few hundred milliseconds in, often with the
    // reader already open.
    const seen: boolean[] = [];
    const { result, rerender } = renderHook(
      () => {
        const value = useUserData();
        seen.push(value.ready);
        return value;
      },
      { wrapper: UserDataProvider }
    );
    await waitFor(() => expect(result.current.lists).toEqual(baseData.lists));

    seen.length = 0;
    mockUser = { ...mockUser! };
    await act(async () => {
      rerender();
    });
    await settle();

    expect(seen).not.toContain(false);
    // And no second pull behind it either — the flush effect stands on the same identity.
    expect(dataApiAll).toHaveBeenCalledTimes(1);
  });

  it('keeps a mutation made with the network down, and still has it after a reload', async () => {
    const { result, unmount } = setup();
    await waitFor(() => expect(result.current.lists).toEqual(baseData.lists));

    dataApiAll.mockImplementation(offline);
    notesApiSet.mockImplementation(record('note', offline));

    await act(async () => {
      await result.current.submitNote('dn1', 'written offline');
    });
    // The local write *is* the durable write — there is no optimistic edit waiting to be rolled
    // back by a failed request.
    expect(result.current.notes.dn1).toBe('written offline');
    await reconnect();
    expect(result.current.notes.dn1).toBe('written offline');
    await settle();
    unmount();

    // Same account, fresh provider: the note comes back from IndexedDB, with the network still
    // down and the server never having heard of it.
    const reloaded = setup();
    await waitFor(() => expect(reloaded.result.current.ready).toBe(true));
    expect(reloaded.result.current.notes.dn1).toBe('written offline');
  });

  it('lands every queued change on the next flush, records before operations', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.lists).toEqual(baseData.lists));

    dataApiAll.mockImplementation(offline);
    listsApiCreate.mockImplementation(record('create', offline));
    listsApiAddItem.mockImplementation(record('addItem', offline));
    notesApiSet.mockImplementation(record('note', offline));

    let created: ListDef = { id: '', label: '', parentId: null, kind: 'list', items: [] };
    await act(async () => {
      created = await result.current.createList('Offline list');
      await result.current.addToList('dn2', created);
      await result.current.submitNote('dn2', 'offline note');
    });
    await reconnect();
    calls.length = 0;

    const withList: UserData = {
      ...structuredClone(baseData),
      lists: [...baseData.lists, { id: created.id, label: 'Offline list', parentId: null, kind: 'list', items: ['dn2'] }],
      notes: { dn2: { text: 'offline note', m: '2026-08-01T00:00:00.000Z|server' } },
    };
    dataApiAll.mockResolvedValue(withList);
    listsApiCreate.mockImplementation(record('create', async () => ({ list: null })));
    listsApiAddItem.mockImplementation(record('addItem', async () => ({ ok: true })));
    notesApiSet.mockImplementation(record('note', async () => ({ ok: true })));
    await reconnect();

    expect(listsApiCreate).toHaveBeenCalledWith(expect.objectContaining({ id: created.id, label: 'Offline list' }));
    expect(notesApiSet).toHaveBeenCalledWith('dn2', 'offline note', expect.any(String));
    expect(listsApiAddItem).toHaveBeenCalledWith(created.id, 'dn2');
    // The add names a list the server only learns about in this same flush, so it has to go after
    // the record that creates it or it 404s and the sutta is silently lost.
    expect(calls.indexOf('create')).toBeLessThan(calls.indexOf('addItem'));
    // Nothing is left over to push once the flush has drained.
    calls.length = 0;
    await reconnect();
    expect(calls).toEqual([]);
  });

  it('pauses on a 401 instead of dropping the queue, and resumes once signed back in', async () => {
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.lists).toEqual(baseData.lists));

    notesApiSet.mockImplementation(record('note', () => httpError(401)));
    await act(async () => {
      await result.current.submitNote('dn1', 'still mine');
    });
    await reconnect();

    // Surfaced as state (`needsReauth`, which TreePane renders as a banner) rather than by
    // navigating away on its own: a background flush hitting a 401 shouldn't yank the reader off
    // whatever they were doing for a lapse they haven't even noticed yet.
    expect(promptGoogleSignIn).not.toHaveBeenCalled();
    expect(result.current.needsReauth).toBe(true);
    expect(result.current.notes.dn1).toBe('still mine');

    // Paused: further triggers stand down rather than retrying a cookie that has lapsed.
    notesApiSet.mockImplementation(record('note', async () => ({ ok: true })));
    await reconnect();
    expect(notesApiSet).toHaveBeenCalledTimes(1);

    // Signing back in re-loads the same mirror and clears the pause — the write is still there.
    dataApiAll.mockResolvedValue({
      ...structuredClone(baseData),
      notes: { dn1: { text: 'still mine', m: '2026-08-01T00:00:00.000Z|server' } },
    });
    mockUser = { ...mockUser! };
    await act(async () => {
      rerender();
    });
    await waitFor(() => expect(notesApiSet).toHaveBeenCalledTimes(2));
    expect(notesApiSet).toHaveBeenLastCalledWith('dn1', 'still mine', expect.any(String));
    expect(result.current.notes.dn1).toBe('still mine');
    expect(result.current.needsReauth).toBe(false);
  });

  it('reports pending while a write is queued, and synced once the flush drains it', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.lists).toEqual(baseData.lists));
    // The provider's own mount-time flush already landed by this point (dataApiAll resolves in
    // beforeEach), so `lastSyncedAt` is already set before this test's own mutation.
    await waitFor(() => expect(result.current.syncStatus).toBe('synced'));
    expect(result.current.lastSyncedAt).not.toBeNull();

    dataApiAll.mockImplementation(offline);
    notesApiSet.mockImplementation(record('note', offline));
    await act(async () => {
      await result.current.submitNote('dn1', 'a note');
    });

    // The local write is durable the moment it lands in the mirror, before any request is even
    // attempted — so the status reflects the queue, not any in-flight network call.
    expect(result.current.syncStatus).toBe('pending');
    expect(result.current.pendingCount).toBeGreaterThan(0);

    notesApiSet.mockImplementation(record('note', async () => ({ ok: true })));
    dataApiAll.mockResolvedValue({
      ...structuredClone(baseData),
      notes: { dn1: { text: 'a note', m: '2026-08-01T00:00:00.000Z|server' } },
    });
    await reconnect();

    expect(result.current.syncStatus).toBe('synced');
    expect(result.current.pendingCount).toBe(0);
    expect(result.current.lastSyncedAt).not.toBeNull();
  });

  it('reports offline from the browser, independently of anything queued', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.lists).toEqual(baseData.lists));

    await act(async () => {
      window.dispatchEvent(new Event('offline'));
      await Promise.resolve();
    });
    expect(result.current.syncStatus).toBe('offline');

    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await Promise.resolve();
    });
    expect(result.current.syncStatus).toBe('synced');
  });

  it('reports stuck for a permanently rejected write, and keeps retrying it rather than dropping it', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = setup();
    await waitFor(() => expect(result.current.lists).toEqual(baseData.lists));

    notesApiSet.mockImplementation(record('note', () => httpError(400)));
    await act(async () => {
      await result.current.submitNote('dn1', 'a bad note');
    });
    await reconnect();

    // The server has permanently refused this version, but the compromise this design accepts is
    // last-writer-wins, not "give up" — the write stays queued and keeps being retried; 'stuck' is
    // only about making that visible instead of silent (see docs/offline-sync.md's "Sync state").
    expect(result.current.syncStatus).toBe('stuck');
    calls.length = 0;
    await reconnect();
    expect(calls).toContain('note');
    errorSpy.mockRestore();
  });

  it('re-mints a colliding list id and makes every queued reference follow it', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.lists).toEqual(baseData.lists));

    dataApiAll.mockImplementation(offline);
    let created: ListDef = { id: '', label: '', parentId: null, kind: 'list', items: [] };
    await act(async () => {
      created = await result.current.createList('Mine');
      await result.current.addToList('dn3', created);
    });

    // The first id belongs to another account (lists.id is a global primary key and sign-in is
    // open to any Google account), so no retry under it could ever succeed.
    listsApiCreate.mockImplementationOnce(record('create', () => httpError(409)));
    // The snapshot then comes back with the list under whichever id the create actually landed on.
    dataApiAll.mockImplementation(async () => {
      const landed = listsApiCreate.mock.calls.at(-1)?.[0] as { id: string; label: string } | undefined;
      return {
        ...structuredClone(baseData),
        lists: [
          ...structuredClone(baseData.lists),
          ...(landed ? [{ id: landed.id, label: landed.label, parentId: null, kind: 'list' as const, items: ['dn3'] }] : []),
        ],
      };
    });
    await reconnect();

    const attempted = listsApiCreate.mock.calls.map((c) => (c[0] as { id: string }).id);
    expect(attempted).toHaveLength(2);
    expect(attempted[0]).toBe(created.id);
    expect(attempted[1]).not.toBe(created.id);
    // The op queued against the old id has to follow it, or the add lands on a list that does not
    // exist and the sutta is lost.
    expect(listsApiAddItem).toHaveBeenCalledWith(attempted[1], 'dn3');
    expect(result.current.lists.some((l) => l.id === attempted[1])).toBe(true);
    expect(result.current.lists.some((l) => l.id === created.id)).toBe(false);
  });

  it('deletes a group and everything inside it, with no round trip', async () => {
    dataApiAll.mockResolvedValue({
      ...structuredClone(baseData),
      lists: [
        { id: 'g1', label: 'Group', parentId: null, kind: 'group', items: [] },
        { id: 'c1', label: 'Child', parentId: 'g1', kind: 'list', items: ['dn1'] },
      ],
      membership: { dn1: ['c1'] },
    });
    const { result } = setup();
    await waitFor(() => expect(result.current.lists).toHaveLength(2));

    dataApiAll.mockImplementation(offline);
    await act(async () => {
      await result.current.removeList('g1');
    });

    // Deleting a folder deletes what is in it — expressed as one tombstone plus the read-time
    // cascade, so it holds offline and both devices reach it from the same rows.
    expect(result.current.lists).toEqual([]);
    expect(result.current.membership.dn1 ?? []).toEqual([]);
  });

  it('setHighlightRanges mints the group and names the groups it displaces', async () => {
    const existing = { id: 'h1', i: 0, s: 0, e: 10, c: 'yellow', g: 'g1', m: '2026-01-01T00:00:00.000Z|dev' };
    const untouched = { id: 'h2', i: 4, s: 0, e: 4, c: 'blue', g: 'g2', m: '2026-01-01T00:00:00.000Z|dev' };
    dataApiAll.mockResolvedValue({ ...structuredClone(baseData), highlights: { dn1: [existing, untouched] } });
    const { result } = setup();
    await waitFor(() => expect(result.current.highlights.dn1).toHaveLength(2));

    await act(async () => {
      await result.current.setHighlightRanges('dn1', [{ i: 0, s: 5, e: 12 }], 'green');
    });
    // The displaced group is gone locally at once, and the untouched one is left alone.
    expect(result.current.highlights.dn1).toHaveLength(2);
    expect(result.current.highlights.dn1.some((h) => h.g === 'g1')).toBe(false);
    expect(result.current.highlights.dn1.some((h) => h.g === 'g2')).toBe(true);

    await reconnect();
    expect(highlightsApiSetRanges).toHaveBeenCalledWith('dn1', [{ i: 0, s: 5, e: 12 }], 'green', {
      g: expect.any(String),
      mtime: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\|.+$/),
      erase: ['g1'],
    });
  });

  it('markVisited is a no-op on `lists` when the sutta is already the most recent visit', async () => {
    dataApiAll.mockResolvedValue({ ...structuredClone(baseData), visited: { dn1: '2024-01-01T00:00:00.000Z' } });
    const { result } = setup();
    await waitFor(() => expect(result.current.lists.some((l) => l.id === RECENT_AUTO_LIST_ID)).toBe(true));

    const listsBefore = result.current.lists;
    act(() => {
      result.current.markVisited('dn1');
    });

    // `lists` (already correctly ordered) keeps the same reference, not just the same content, so
    // consumers keyed on it (useListTreeIndex, ListPane's flatLists) don't rebuild for nothing.
    expect(result.current.lists).toBe(listsBefore);
  });

  it('keeps both membership toggles when two are made on one sutta before a re-render', async () => {
    dataApiAll.mockResolvedValue({
      ...structuredClone(baseData),
      lists: [
        { id: 'l1', label: 'Favorites', parentId: null, kind: 'list', items: [] },
        { id: 'l2', label: 'Later', parentId: null, kind: 'list', items: [] },
      ],
      membership: {},
    });
    const { result } = setup();
    await waitFor(() => expect(result.current.lists).toHaveLength(2));

    await act(async () => {
      await Promise.all([result.current.toggleMembership('dn1', 'l1'), result.current.toggleMembership('dn1', 'l2')]);
    });

    // Both toggles derive their next state from the mirror inside the updater rather than from the
    // same stale render closure, so neither drops the other.
    expect(result.current.membership.dn1).toEqual(['l1', 'l2']);
  });

  it('switches to the local mirror on sign-out', async () => {
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.lists).toEqual(baseData.lists));

    // The account's own stored mirror is retired by AuthContext's logout, not here — from this
    // provider's side, signing out is simply a different id to read and write under.
    mockUser = null;
    rerender();
    await waitFor(() => expect(result.current.lists).toEqual([]));
    expect(result.current.notes).toEqual({});
  });

  it('writes without an account and pushes it all once the user signs in', async () => {
    mockUser = null;
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));

    // No sign-in prompt, no thrown error, no request: the local write is the durable write.
    await act(async () => {
      await result.current.submitNote('dn1', 'noted before signing in');
      await result.current.setHighlightRanges('dn1', [{ i: 0, s: 0, e: 4 }], '#ff0');
    });
    expect(result.current.notes.dn1).toBe('noted before signing in');
    expect(promptGoogleSignIn).not.toHaveBeenCalled();
    expect(notesApiSet).not.toHaveBeenCalled();

    // What the server hands back once it has taken the adopted note — the pull at the end of the
    // same flush, so the round trip is exercised rather than stopping at the push.
    dataApiAll.mockResolvedValue({
      ...structuredClone(baseData),
      notes: { dn1: { text: 'noted before signing in', m: '2030-01-01T00:00:00.000Z|server' } },
    });
    mockUser = { id: `u${seq}`, email: 'a@b.com', name: 'A', picture: '' };
    rerender();

    await waitFor(() => expect(notesApiSet).toHaveBeenCalled());
    expect(notesApiSet.mock.calls[0][1]).toBe('noted before signing in');
    await waitFor(() => expect(highlightsApiSetRanges).toHaveBeenCalled());
    await waitFor(() => expect(result.current.notes.dn1).toBe('noted before signing in'));
  });

  // The Google path is a full-page redirect, so the app that comes back is a fresh mount reading
  // the mirror off disk — not the same React tree re-rendering with a new user, which is what the
  // test above covers. Both have to adopt.
  it('adopts signed-out work across the reload that a redirect sign-in ends with', async () => {
    mockUser = null;
    const first = setup();
    await waitFor(() => expect(first.result.current.ready).toBe(true));
    await act(async () => {
      await first.result.current.submitNote('dn1', 'written before the redirect');
    });
    await settle();
    first.unmount();

    dataApiAll.mockResolvedValue({
      ...structuredClone(baseData),
      notes: { dn1: { text: 'written before the redirect', m: '2030-01-01T00:00:00.000Z|server' } },
    });
    mockUser = { id: `u${seq}`, email: 'a@b.com', name: 'A', picture: '' };
    const second = setup();

    await waitFor(() => expect(second.result.current.notes.dn1).toBe('written before the redirect'));
    await waitFor(() => expect(notesApiSet).toHaveBeenCalled());
  });
});
