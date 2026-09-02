import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Highlight, HighlightsMap, ListDef, ListKind, Membership, NotesMap, VisitedMap } from '../lib/types';
import {
  adoptMirror,
  applyFlushOutcome,
  createListRecord,
  emptyMirror,
  hasContent,
  markDispatched,
  markVisitedRecord,
  queueItemOrder,
  queueMembership,
  removeListRecord,
  renameListRecord,
  queueSiblingOrder,
  setNoteRecord,
  syncCounts,
  writeHighlightRecord,
  type MirrorState,
} from '../lib/mirror';
import { deriveUserData } from '../lib/mirrorView';
import type { HlSpan } from '../lib/highlights';
import { isLocalUserId } from '../lib/localAccount';
import { deleteMirror, loadMirror, saveMirror } from '../lib/mirrorDb';
import { flushWithLock } from '../lib/sync';
import { randomId } from '../lib/ids';
import { LIST_NAME_MAX_LENGTH, NOTE_MAX_LENGTH } from '../lib/textLimits';
import { useAuth } from './AuthContext';

// The user's lists, notes, highlights and visits, as a view over the offline mirror
// (lib/mirror.ts). Every mutator writes to the mirror and returns; a flush (lib/sync.ts) pushes
// what the server hasn't seen and folds the merged result back in, on the triggers below. A reader
// who hasn't signed in has a mirror of their own under a local id (lib/localAccount.ts), which
// sign-in adopts onto the account (adoptMirror); everything else is identical either way.

// How long after a mutation the flush runs, so a burst of edits becomes one flush.
const FLUSH_DEBOUNCE_MS = 2000;
// How often the flush runs anyway, as a backstop for what the event triggers miss.
const FLUSH_POLL_MS = 5 * 60 * 1000;

// How far the flush queue has got (docs/offline-sync.md's "Sync state").
//   offline – the browser reports no network, which explains the rest
//   pending – queued and still expected to land
//   synced  – nothing queued
export type SyncStatus = 'synced' | 'pending' | 'offline';

interface UserDataState {
  ready: boolean;
  lists: ListDef[];
  membership: Membership;
  notes: NotesMap;
  highlights: HighlightsMap;
  visited: VisitedMap;
  // Sync state for the persistent-chrome indicator — see SyncStatus above.
  syncStatus: SyncStatus;
  pendingCount: number;
  lastSyncedAt: string | null;
  // Set when a flush hit a 401: the queue is intact, but the session has lapsed and the automatic
  // triggers have stood down. Surfaced by the sync indicator rather than navigating anywhere.
  needsReauth: boolean;
  listMembers: (listId: string) => string[];
  createList: (label: string, parentId?: string | null, kind?: ListKind) => Promise<ListDef>;
  renameList: (id: string, label: string) => Promise<void>;
  removeList: (id: string) => Promise<void>;
  reorderLists: (parentId: string | null, order: string[]) => Promise<void>;
  reorderListItems: (id: string, order: string[]) => Promise<void>;
  toggleMembership: (suttaId: string, listId: string) => Promise<void>;
  addToList: (suttaId: string, list: ListDef) => Promise<void>;
  submitNote: (suttaId: string, text: string) => Promise<void>;
  setHighlightSpan: (suttaId: string, span: HlSpan, color: string | null) => Promise<void>;
  markVisited: (suttaId: string) => void;
}

const UserDataContext = createContext<UserDataState | null>(null);

const EMPTY: UserDataState = {
  ready: false,
  lists: [],
  membership: {},
  notes: {},
  highlights: {},
  visited: {},
  syncStatus: 'synced',
  pendingCount: 0,
  lastSyncedAt: null,
  needsReauth: false,
  listMembers: () => [],
  createList: async () => {
    throw new Error('not ready');
  },
  renameList: async () => {},
  removeList: async () => {},
  reorderLists: async () => {},
  reorderListItems: async () => {},
  toggleMembership: async () => {},
  addToList: async () => {},
  submitNote: async () => {},
  setHighlightSpan: async () => {},
  markVisited: () => {},
};

export function UserDataProvider({ children }: { children: ReactNode }) {
  const { user, isSignedIn, dataUserId, localUserId } = useAuth();
  const [state, setState] = useState<MirrorState>(emptyMirror);
  const [ready, setReady] = useState(false);
  // Whether the flush triggers have stood down after a 401. Exposed as `needsReauth`.
  const [paused, setPaused] = useState(false);
  // When the last flush reached the network, for display. Not persisted.
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  // The browser's connectivity, for display. Tracked separately from the flush triggers below,
  // which stand down while paused where this does not.
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // The mirror as the flush reads it when it runs, rather than as its trigger's closure saw it.
  const stateRef = useRef(state);
  const pausedRef = useRef(paused);
  const flushing = useRef(false);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  // Whose mirror is in use. An id rather than the `user` object, which AuthContext replaces with a
  // fresh one for the same account once /api/auth/me answers. Never null.
  const userId = dataUserId;

  // Clears the pause on a new `user` object, which is what signing back in after a 401 produces.
  useEffect(() => {
    setPaused(false);
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    // Blanks a departing account's data on this render rather than when the read lands. Not a
    // departing local mirror, which is about to be adopted onto the account below.
    setState((s) => (s.userId === userId || isLocalUserId(s.userId) ? s : emptyMirror(userId)));
    (async () => {
      let loaded = await loadMirror(userId);
      // Adopts whatever this device made signed out. Runs on every load of an account mirror
      // rather than on a sign-in transition, since a reload mid-adoption has to finish the job;
      // `hasContent` makes it a no-op for a device never used signed out.
      if (!isLocalUserId(userId)) {
        const local = await loadMirror(localUserId);
        if (hasContent(local)) {
          loaded = adoptMirror(loaded, local);
          // Saved before the local copy is dropped, so a crash between the two leaves a duplicate
          // rather than a hole.
          await saveMirror(loaded);
          await deleteMirror(localUserId);
        }
      }
      if (cancelled) return;
      setState(loaded);
      // `ready` means the local dataset is known, which needs no network.
      setReady(true);
    })().catch((e) => {
      console.error('mirror load failed', e);
      if (cancelled) return;
      setState(emptyMirror(userId));
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, localUserId]);

  // Persists every change, including what a flush folds back in. Both guards keep an identity
  // change's window from writing under the wrong key: `userId` catches records from the outgoing
  // identity, and `ready` catches the empty placeholder above, which carries the incoming one and
  // would otherwise overwrite the mirror the load is still reading.
  useEffect(() => {
    if (!ready || state.userId !== userId) return;
    saveMirror(state).catch((e) => console.error('mirror save failed', e));
  }, [ready, state, userId]);

  const flush = useCallback(async () => {
    const current = stateRef.current;
    // A local mirror has no account behind it, so nothing to push to until sign-in adopts it.
    if (!current.userId || isLocalUserId(current.userId) || flushing.current) return;
    flushing.current = true;
    // Marked before the first request goes out: from here on the server may hold these rows, so a
    // delete made while the flush is out has to travel as a tombstone (markDispatched).
    setState((s) => (s.userId === current.userId ? markDispatched(s, current) : s));
    try {
      const outcome = await flushWithLock(current);
      // Another tab is flushing this same mirror — it will apply the result for both of us.
      if (outcome.status === 'blocked') return;
      // Applied to the mirror as it is now, not as the flush found it: editing continues while a
      // flush is out, and applyFlushOutcome only clears what was acknowledged.
      setState((s) => (s.userId === current.userId ? applyFlushOutcome(s, outcome) : s));
      // A 401 pause surfaces through `needsReauth` (DataLocationRow, HeaderBanner); nothing here
      // navigates, which would pull the reader out of a sutta for a lapse they haven't noticed.
      setPaused(outcome.status === 'unauthorized');
      if (outcome.status === 'ok') setLastSyncedAt(new Date().toISOString());
    } catch (e) {
      console.error('sync flush failed', e);
    } finally {
      flushing.current = false;
    }
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => {
      flushTimer.current = null;
      if (!pausedRef.current) flush();
    }, FLUSH_DEBOUNCE_MS);
  }, [flush]);

  useEffect(
    () => () => {
      if (flushTimer.current) clearTimeout(flushTimer.current);
    },
    []
  );

  useEffect(() => {
    if (!ready || !isSignedIn || paused) return;
    flush();
    const onOnline = () => flush();
    const onVisible = () => {
      if (document.visibilityState === 'visible') flush();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    const poll = setInterval(flush, FLUSH_POLL_MS);
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(poll);
    };
  }, [ready, isSignedIn, userId, paused, flush]);

  const { lists, membership, notes, highlights, visited } = useMemo(() => deriveUserData(state), [state]);

  const { pending: pendingCount } = useMemo(() => syncCounts(state), [state]);
  // Returns what the sync indicator says. Each case explains away the ones below it, so the first
  // that holds is the one shown.
  function currentSyncStatus(): SyncStatus {
    // No network, which explains anything the queue is carrying.
    if (!online) return 'offline';
    // Work in the queue, online and draining.
    if (pendingCount > 0) return 'pending';
    // Nothing queued: everything local is on the server.
    return 'synced';
  }
  const syncStatus: SyncStatus = currentSyncStatus();

  // Applies one change to the mirror and schedules a flush; every mutator below goes through it.
  // The guard drops a write landing after sign-out rather than filing it under nobody.
  const mutate = useCallback(
    (change: (s: MirrorState) => MirrorState) => {
      setState((s) => (s.userId ? change(s) : s));
      scheduleFlush();
    },
    [scheduleFlush]
  );

  const listMembers = useCallback(
    (listId: string) => Object.entries(membership).filter(([, ids]) => ids.includes(listId)).map(([id]) => id),
    [membership]
  );

  const createList = useCallback(
    async (label: string, parentId: string | null = null, kind: ListKind = 'list') => {
      // Trimmed and capped as a `list.create` does, so a later pull doesn't correct the label.
      const capped = label.trim().slice(0, LIST_NAME_MAX_LENGTH);
      // An existing list of the same name is returned instead. Auto-lists are excluded, so a list
      // genuinely called "Notes" isn't answered with the synthesized one.
      const existing = lists.find((l) => !l.auto && l.label === capped && l.parentId === parentId && l.kind === kind);
      if (existing) return existing;
      // The client mints the id, so the list can be renamed, moved and filed into before the
      // server has heard of it, and a create whose response was lost retries as a no-op.
      const id = randomId();
      mutate((s) => createListRecord(s, { id, label: capped, parentId, kind }));
      return { id, label: capped, parentId, kind, items: [] };
    },
    [lists, mutate]
  );

  const renameList = useCallback(
    async (id: string, label: string) => {
      const trimmed = label.trim().slice(0, LIST_NAME_MAX_LENGTH);
      if (!trimmed) return;
      const old = lists.find((l) => l.id === id);
      if (!old || old.label === trimmed) return;
      mutate((s) => renameListRecord(s, id, trimmed));
    },
    [lists, mutate]
  );

  // Tombstoned rather than removed, and its contents go with it — which the mirror's tree repair
  // (lib/listTree.ts) works out on read, exactly as the server does.
  const removeList = useCallback(
    async (id: string) => {
      mutate((s) => removeListRecord(s, id));
    },
    [mutate]
  );

  const reorderLists = useCallback(
    async (parentId: string | null, order: string[]) => {
      // One operation for the whole gesture rather than a write per sibling (queueSiblingOrder). It
      // sets `parentId` on every id in `order` as well as its position, which is what lets
      // useListTreeDrag's commitDrop fold a cross-parent drop into this single call.
      mutate((s) => queueSiblingOrder(s, parentId, order));
    },
    [mutate]
  );

  const reorderListItems = useCallback(
    async (id: string, order: string[]) => {
      mutate((s) => queueItemOrder(s, id, order));
    },
    [mutate]
  );

  const toggleMembership = useCallback(
    async (suttaId: string, listId: string) => {
      const list = lists.find((l) => l.id === listId);
      if (!list || list.auto) return;
      const on = (membership[suttaId] || []).includes(listId);
      mutate((s) => queueMembership(s, listId, suttaId, !on));
    },
    [lists, membership, mutate]
  );

  // toggleMembership's "add" branch, but taking the list directly rather than looking it up in
  // `lists` — for a list the caller just created, which isn't in this component's `lists` closure
  // until the next render.
  const addToList = useCallback(
    async (suttaId: string, list: ListDef) => {
      mutate((s) => queueMembership(s, list.id, suttaId, true));
    },
    [mutate]
  );

  const submitNote = useCallback(
    async (suttaId: string, text: string) => {
      mutate((s) => setNoteRecord(s, suttaId, text.slice(0, NOTE_MAX_LENGTH)));
    },
    [mutate]
  );

  // A highlight is immutable, so this doesn't edit anything: it mints a new one and names those the
  // selection displaces (see lib/mirror.ts's writeHighlightRecord). A recolour is a tombstone plus a
  // new highlight; an erase (color === null) is a tombstone alone.
  const setHighlightSpan = useCallback(
    async (suttaId: string, span: HlSpan, color: string | null) => {
      mutate((s) => writeHighlightRecord(s, suttaId, span, color));
    },
    [mutate]
  );

  const markVisited = useCallback(
    (suttaId: string) => {
      mutate((s) => markVisitedRecord(s, suttaId));
    },
    [mutate]
  );

  const value = useMemo<UserDataState>(
    () => ({
      ready,
      lists,
      membership,
      notes,
      highlights,
      visited,
      syncStatus,
      pendingCount,
      lastSyncedAt,
      needsReauth: paused,
      listMembers,
      createList,
      renameList,
      removeList,
      reorderLists,
      reorderListItems,
      toggleMembership,
      addToList,
      submitNote,
      setHighlightSpan,
      markVisited,
    }),
    [
      ready,
      lists,
      membership,
      notes,
      highlights,
      visited,
      syncStatus,
      pendingCount,
      lastSyncedAt,
      paused,
      listMembers,
      createList,
      renameList,
      removeList,
      reorderLists,
      reorderListItems,
      toggleMembership,
      addToList,
      submitNote,
      setHighlightSpan,
      markVisited,
    ]
  );

  return <UserDataContext.Provider value={value}>{children}</UserDataContext.Provider>;
}

export function useUserData() {
  const ctx = useContext(UserDataContext);
  return ctx || EMPTY;
}

export type { Highlight };
