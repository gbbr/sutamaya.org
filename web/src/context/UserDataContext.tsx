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
  setListParentRecord,
  setNoteRecord,
  syncCounts,
  writeHighlightRecord,
  type MirrorState,
} from '../lib/mirror';
import { deriveUserData } from '../lib/mirrorView';
import { isLocalUserId } from '../lib/localAccount';
import { deleteMirror, loadMirror, saveMirror } from '../lib/mirrorDb';
import { flushWithLock } from '../lib/sync';
import { randomId } from '../lib/ids';
import { LIST_NAME_MAX_LENGTH, NOTE_MAX_LENGTH } from '../lib/textLimits';
import { useAuth } from './AuthContext';

// The user's lists, notes, highlights and visits, as a view over the offline mirror
// (lib/mirror.ts) rather than over the server. Every mutator writes to the mirror and returns —
// the local write *is* the durable write, so nothing here has an optimistic edit to roll back and
// nothing is lost when the network is down. A flush (lib/sync.ts) pushes what the server hasn't
// seen and folds the merged result back in, on the triggers below.
//
// **Signing in is deferred, not required.** A reader who has never signed in gets a local id
// (lib/localAccount.ts) and writes to a mirror of their own, so highlighting a sentence highlights
// it instead of raising a sign-in wall. The only thing that changes on sign-in is that there is
// now somewhere to push to: the local mirror is adopted onto the account (adoptMirror) and the
// ordinary flush carries it up. Everything between those two points — the mutators below, the
// derived view, the auto-lists — is identical either way.

// A mutation is followed by a flush after this long, so a burst of edits (dragging a list through
// several positions, filing a sutta into three lists) becomes one flush rather than several. Note
// editing already commits on Enter/blur (NoteEditor), so this is never per-keystroke.
const FLUSH_DEBOUNCE_MS = 2000;
// Backstop for everything the event triggers miss — a tab left open on a flaky connection, or a
// device that came back online without firing `online`.
const FLUSH_POLL_MS = 5 * 60 * 1000;

// What the sync indicator (TreePane, beside the account badge) shows. 'offline' takes priority
// over everything else — the browser itself says there's no network, which already explains why
// nothing is draining. 'stuck' is next: a queue the server has permanently refused is a different
// problem than one merely waiting its turn, and silently retrying it forever is the exact failure
// mode offline sync exists to fix (see docs/offline-sync.md's "Sync state"). Otherwise it's 'pending' (queued,
// still expected to land) or 'synced' (nothing owed).
export type SyncStatus = 'synced' | 'pending' | 'offline' | 'stuck';

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
  // Set when a flush hit a 401 — the queue is intact, but the session has lapsed and the automatic
  // triggers have stood down. Deliberately doesn't navigate anywhere on its own (interrupting
  // someone mid-sutta with a forced trip to Settings is what this replaces); the sync indicator
  // surfaces it, and a click calls promptGoogleSignIn(), which is the right time for that
  // navigation because it is now a direct response to the user's own action.
  needsReauth: boolean;
  listMembers: (listId: string) => string[];
  createList: (label: string, parentId?: string | null, kind?: ListKind) => Promise<ListDef>;
  renameList: (id: string, label: string) => Promise<void>;
  removeList: (id: string) => Promise<void>;
  setListParent: (id: string, parentId: string | null) => Promise<void>;
  reorderLists: (parentId: string | null, order: string[]) => Promise<void>;
  reorderListItems: (id: string, order: string[]) => Promise<void>;
  toggleMembership: (suttaId: string, listId: string) => Promise<void>;
  addToList: (suttaId: string, list: ListDef) => Promise<void>;
  submitNote: (suttaId: string, text: string) => Promise<void>;
  setHighlightRanges: (suttaId: string, ranges: { i: number; s: number; e: number }[], color: string | null) => Promise<void>;
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
  setListParent: async () => {},
  reorderLists: async () => {},
  reorderListItems: async () => {},
  toggleMembership: async () => {},
  addToList: async () => {},
  submitNote: async () => {},
  setHighlightRanges: async () => {},
  markVisited: () => {},
};

export function UserDataProvider({ children }: { children: ReactNode }) {
  const { user, isSignedIn, dataUserId, localUserId } = useAuth();
  const [state, setState] = useState<MirrorState>(emptyMirror);
  const [ready, setReady] = useState(false);
  // Set when the session has lapsed (a 401 during a flush). The queue is intact — nothing is
  // dropped — but the automatic triggers stand down until the user signs back in, since retrying
  // an expired cookie every couple of minutes achieves nothing. Exposed as `needsReauth`.
  const [paused, setPaused] = useState(false);
  // Display-only: when the last flush actually reached the network and pulled a fresh snapshot.
  // Not persisted — it's a "how stale might this be" cue, not data worth surviving a reload for.
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  // The browser's own online/offline signal, tracked independently of the flush triggers below (see
  // that effect's own `online` listener, which exists to *schedule a flush* — this one exists only
  // to *display* connectivity, so it runs unconditionally rather than standing down while paused).
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

  // The flush reads the mirror at the moment it runs, not at the moment its trigger was set up,
  // so it goes through a ref rather than through the callback's own closure.
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

  // Keyed on the *id*, not the `user` object — AuthContext seeds `user` synchronously from
  // localStorage and then replaces it with a fresh object once GET /api/auth/me answers, so an
  // object-identity dependency re-ran everything below for what is the same account: `ready` went
  // back to false and the mirror was re-read from IndexedDB a few hundred milliseconds in, blanking
  // and restoring every chip, note preview and highlight — often with the reader already open — and
  // firing a second, redundant flush behind it.
  //
  // Never null: signed out, this is the device's local id, so there is always a mirror to write to.
  const userId = dataUserId;

  // Clearing the pause is keyed on the `user` object instead, not its id: signing back in after a
  // 401 hands back a new object carrying the *same* id, and that's precisely the event that means
  // the cookie is good again. Setting it to a value it already holds doesn't re-render, so the
  // boot-time /api/auth/me resolution passing through here costs nothing.
  useEffect(() => {
    setPaused(false);
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    // Signing out has to blank the departing account's data on this render, not whenever the
    // IndexedDB read lands. Signing *in* deliberately doesn't: the outgoing mirror there is the
    // local one, and it is about to be adopted onto the account below — blanking it would flash
    // the user's own notes and highlights out of existence at the moment they signed in to keep
    // them.
    setState((s) => (s.userId === userId || isLocalUserId(s.userId) ? s : emptyMirror(userId)));
    (async () => {
      let loaded = await loadMirror(userId);
      // Signing in adopts whatever this device made signed-out. Runs on every load of an account
      // mirror rather than on a sign-in transition, because there is no reliable transition to
      // watch: `user` is seeded from localStorage before the session is confirmed, and a reload
      // mid-adoption has to finish the job. It costs one IndexedDB read, and `hasContent` makes it
      // a no-op for a device that has never been used signed out.
      if (!isLocalUserId(userId)) {
        const local = await loadMirror(localUserId);
        if (hasContent(local)) {
          loaded = adoptMirror(loaded, local);
          // Persisted before the local copy is dropped, so a crash between the two leaves a
          // duplicate rather than a hole.
          await saveMirror(loaded);
          await deleteMirror(localUserId);
        }
      }
      if (cancelled) return;
      setState(loaded);
      // `ready` means "the local dataset is known" — a question the mirror answers without a
      // network, which is the point. Nothing downstream (see useSuttaReading's scroll restore)
      // waits on the server any more.
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

  // Persist on every change, including the ones a flush folds back in. Guarded on the mirror's own
  // userId, so the window between an account switch (or a sign-in) and its load resolving can't
  // write one identity's records under the other's key.
  useEffect(() => {
    if (state.userId !== userId) return;
    saveMirror(state).catch((e) => console.error('mirror save failed', e));
  }, [state, userId]);

  const flush = useCallback(async () => {
    const current = stateRef.current;
    // A local mirror has nowhere to go: there is no account behind it, so every request would 401.
    // It becomes flushable the moment sign-in adopts it onto a real one.
    if (!current.userId || isLocalUserId(current.userId) || flushing.current) return;
    flushing.current = true;
    // Before the first request goes out, not after the last one comes back: from here on the server
    // may already hold these rows, so a delete or erase made while the flush is out has to be
    // pushed as a tombstone rather than collapsed away locally (see markDispatched).
    setState((s) => (s.userId === current.userId ? markDispatched(s, current) : s));
    try {
      const outcome = await flushWithLock(current);
      // Another tab is flushing this same mirror — it will apply the result for both of us.
      if (outcome.status === 'blocked') return;
      // Applied to the mirror as it is *now*, not as the flush found it: the user goes on editing
      // while a flush is out, and applyFlushOutcome only clears what was actually acknowledged.
      setState((s) => (s.userId === current.userId ? applyFlushOutcome(s, outcome) : s));
      setPaused(outcome.status === 'unauthorized');
      // A genuine 401 pause is surfaced through `needsReauth` (see the sync indicator in TreePane)
      // rather than by calling promptGoogleSignIn() here directly — that navigates to Settings, and
      // firing it from a background flush would yank the reader away from whatever they were doing
      // for a session lapse they haven't even noticed yet. promptGoogleSignIn() is still the right
      // call once *they* act on the indicator.
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

  const { pending: pendingCount, stuck: stuckCount } = useMemo(() => syncCounts(state), [state]);
  // 'offline' first — the browser itself says there's no network, which already explains why
  // nothing is draining, regardless of anything else the queue is carrying. 'stuck' next: a
  // permanently-refused record is a different problem than one merely waiting its turn.
  const syncStatus: SyncStatus = !online ? 'offline' : stuckCount > 0 ? 'stuck' : pendingCount > 0 ? 'pending' : 'synced';

  // Every mutator goes through this: apply to the mirror, then flush shortly after. The guard on
  // `userId` drops a write that lands after sign-out rather than filing it under nobody.
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
      // Trimmed and capped the same way POST /lists does it, so the local label is the one the
      // server will store rather than one a later pull quietly corrects.
      const capped = label.trim().slice(0, LIST_NAME_MAX_LENGTH);
      // Auto-lists are excluded: they share the shape of a top-level list, so a user creating a
      // list genuinely called "Notes" would otherwise be handed the synthesized one back.
      const existing = lists.find((l) => !l.auto && l.label === capped && l.parentId === parentId && l.kind === kind);
      if (existing) return existing;
      // The client names what it creates, so the list can be renamed, moved and filed into before
      // the server has ever heard of it — and so a create whose response was lost is a no-op on
      // retry rather than a second list.
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

  // Tombstoned, not removed — and its contents go with it, which the mirror's own tree repair
  // (lib/listTree.ts) works out on read exactly as the server does.
  const removeList = useCallback(
    async (id: string) => {
      mutate((s) => removeListRecord(s, id));
    },
    [mutate]
  );

  const setListParent = useCallback(
    async (id: string, parentId: string | null) => {
      mutate((s) => setListParentRecord(s, id, parentId));
    },
    [mutate]
  );

  const reorderLists = useCallback(
    async (parentId: string | null, order: string[]) => {
      // Queued as one operation for the whole gesture, not a write per sibling — see
      // queueSiblingOrder. Sets `parentId` on every id in `order` as well as its position, which is
      // what lets useListTreeDrag's commitDrop fold a cross-parent drop into this single call
      // instead of a separate setListParent first (see its own comment).
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

  // Like toggleMembership's "add" branch, but takes the list directly instead of looking it up in
  // `lists` — for adding to a list a caller just created, which won't be in this component's
  // `lists` closure until the next render.
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

  // A highlight group is immutable, so this doesn't edit anything: it mints a new group and names
  // the groups the selection displaces (see lib/mirror.ts's writeHighlightRecord). A recolour is a
  // tombstone plus a new group; an erase (color === null) is a tombstone alone.
  const setHighlightRanges = useCallback(
    async (suttaId: string, ranges: { i: number; s: number; e: number }[], color: string | null) => {
      if (!ranges.length) return;
      mutate((s) => writeHighlightRecord(s, suttaId, ranges, color));
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
      setListParent,
      reorderLists,
      reorderListItems,
      toggleMembership,
      addToList,
      submitNote,
      setHighlightRanges,
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
      setListParent,
      reorderLists,
      reorderListItems,
      toggleMembership,
      addToList,
      submitNote,
      setHighlightRanges,
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
