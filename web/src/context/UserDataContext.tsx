import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { dataApi, highlightsApi, listsApi, notesApi, visitedApi } from '../lib/api';
import type { Highlight, HighlightsMap, ListDef, ListKind, Membership, NotesMap, VisitedMap } from '../lib/types';
import { RECENT_AUTO_LIST_CAP, RECENT_AUTO_LIST_ID } from '../lib/autoLists';
import { applyListReorder } from '../lib/lists';
import { LIST_NAME_MAX_LENGTH, NOTE_MAX_LENGTH } from '../lib/textLimits';
import { useAuth } from './AuthContext';

interface UserDataState {
  ready: boolean;
  lists: ListDef[];
  membership: Membership;
  notes: NotesMap;
  highlights: HighlightsMap;
  visited: VisitedMap;
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
  removeHighlights: (suttaId: string, ids: string[]) => Promise<void>;
  markVisited: (suttaId: string) => void;
  syncUserData: () => Promise<void>;
}

const UserDataContext = createContext<UserDataState | null>(null);

const EMPTY: UserDataState = {
  ready: false,
  lists: [],
  membership: {},
  notes: {},
  highlights: {},
  visited: {},
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
  removeHighlights: async () => {},
  markVisited: () => {},
  syncUserData: async () => {},
};

export function UserDataProvider({ children }: { children: ReactNode }) {
  const { user, promptGoogleSignIn } = useAuth();
  const [ready, setReady] = useState(false);
  const [lists, setLists] = useState<ListDef[]>([]);
  const [membership, setMembership] = useState<Membership>({});
  const [notes, setNotes] = useState<NotesMap>({});
  const [highlights, setHighlights] = useState<HighlightsMap>({});
  const [visited, setVisited] = useState<VisitedMap>({});

  useEffect(() => {
    if (!user) {
      // `ready` means "we know the final state of user data for this session" — true
      // immediately for a signed-out user, since there's nothing to fetch (see
      // useSuttaReading's own use of this to gate the reader's scroll restore on knowing
      // notes/highlights/membership have settled one way or the other, not just on a signed-in
      // fetch actually completing).
      setReady(true);
      setLists([]);
      setMembership({});
      setNotes({});
      setHighlights({});
      setVisited({});
      return;
    }
    let cancelled = false;
    setReady(false);
    dataApi
      .all()
      .then((d) => {
        if (cancelled) return;
        setLists(d.lists);
        setMembership(d.membership);
        setNotes(d.notes);
        setHighlights(d.highlights);
        setVisited(d.visited);
        setReady(true);
      })
      .catch((e) => {
        if (cancelled) return;
        // A failed fetch is still a *settled* final state (no data, but nothing left pending) —
        // without this, one transient failure (401 from a lapsed session, a rate limit, a Cloud
        // Run cold start) would leave `ready` stuck false for the rest of the signed-in session,
        // permanently disabling anything gated on it (see readyToRestore in useSuttaReading.ts).
        console.error('initial user-data fetch failed', e);
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const listMembers = useCallback(
    (listId: string) => Object.entries(membership).filter(([, ids]) => ids.includes(listId)).map(([id]) => id),
    [membership]
  );

  // Re-fetches everything from the server and applies it verbatim — the single source of truth
  // every mutator below reconciles against, both on success (to pick up server-derived state an
  // optimistic local edit can't express, e.g. the auto "Highlights"/"Notes" lists) and on
  // failure (to discard an optimistic edit that never actually made it to the server).
  const syncUserData = useCallback(async () => {
    const fresh = await dataApi.all();
    setLists(fresh.lists);
    setMembership(fresh.membership);
    setNotes(fresh.notes);
    setHighlights(fresh.highlights);
  }, []);

  // Every mutator applies its change optimistically before the network call settles, then
  // relies on this to correct course if the call fails — since there's no offline write queue
  // (see CLAUDE.md), a rejected request otherwise leaves the optimistic edit stranded with no
  // indication it was never saved. Logs unconditionally so a failure is never silent even when
  // the caller doesn't await/catch the mutator itself (most UI call sites don't).
  const resyncAfterFailure = useCallback(
    async (context: string, error: unknown) => {
      console.error(`${context} failed`, error);
      try {
        await syncUserData();
      } catch (e) {
        console.error('resync after failure also failed', e);
      }
    },
    [syncUserData]
  );

  // Shared shape for the mutators below that need a full server resync on success (not just an
  // optimistic local edit) — see submitNote's comment on why. `rethrow` defaults to off since
  // most call sites (per CLAUDE.md) don't await/catch the mutator themselves; setHighlightRanges
  // opts in because its own caller (useHighlightPopup's `pick`) does catch it.
  const mutateThenSync = useCallback(
    async (context: string, apiCall: () => Promise<unknown>, options: { rethrow?: boolean } = {}) => {
      try {
        await apiCall();
        await syncUserData();
      } catch (e) {
        await resyncAfterFailure(context, e);
        if (options.rethrow) throw e;
      }
    },
    [syncUserData, resyncAfterFailure]
  );

  const createList = useCallback(
    async (label: string, parentId: string | null = null, kind: ListKind = 'list') => {
      if (!user) {
        promptGoogleSignIn();
        throw new Error('not_authenticated');
      }
      const capped = label.slice(0, LIST_NAME_MAX_LENGTH);
      const existing = lists.find((l) => l.label === capped && l.parentId === parentId && l.kind === kind);
      if (existing) return existing;
      try {
        const { list } = await listsApi.create(capped, parentId, kind);
        const def: ListDef = { id: list.id, label: list.label, parentId: list.parentId, kind: list.kind, items: list.items };
        setLists((ls) => [def, ...ls]);
        return def;
      } catch (e) {
        console.error('create list failed', e);
        throw e;
      }
    },
    [lists, user, promptGoogleSignIn]
  );

  const renameList = useCallback(
    async (id: string, label: string) => {
      const trimmed = label.trim().slice(0, LIST_NAME_MAX_LENGTH);
      if (!trimmed) return;
      const old = lists.find((l) => l.id === id);
      if (!old || old.label === trimmed) return;
      setLists((ls) => ls.map((l) => (l.id === id ? { ...l, label: trimmed } : l)));
      // membership is keyed by list id (see routes/data.js), which doesn't change on rename, so
      // there's nothing to rewrite there.
      try {
        await listsApi.rename(id, trimmed);
      } catch (e) {
        await resyncAfterFailure('rename list', e);
      }
    },
    [lists, resyncAfterFailure]
  );

  const removeList = useCallback(
    async (id: string) => {
      setLists((ls) => ls.filter((l) => l.id !== id));
      setMembership((m) => {
        const next: Membership = {};
        for (const [suttaId, ids] of Object.entries(m)) next[suttaId] = ids.filter((x) => x !== id);
        return next;
      });
      try {
        await listsApi.remove(id);
        // The server re-parents any sub-lists of the deleted list to its own parent (see
        // routes/lists.js) instead of orphaning them — sync to pick that up, since it can't be
        // expressed as a local optimistic edit without duplicating that logic here.
        await syncUserData();
      } catch (e) {
        await resyncAfterFailure('remove list', e);
      }
    },
    [syncUserData, resyncAfterFailure]
  );

  const setListParent = useCallback(
    async (id: string, parentId: string | null) => {
      setLists((ls) => ls.map((l) => (l.id === id ? { ...l, parentId } : l)));
      try {
        await listsApi.setParent(id, parentId);
      } catch (e) {
        await resyncAfterFailure('set list parent', e);
      }
    },
    [resyncAfterFailure]
  );

  const reorderLists = useCallback(
    async (parentId: string | null, order: string[]) => {
      // Mirrors the server's own PUT /order handler (routes/lists.js), which sets `parentId` on
      // every id in `order` unconditionally, not just position — so this one optimistic update
      // also re-parents a dragged item that's crossing into `parentId` for the first time, not
      // just ones already there. That's what lets useListTreeDrag's commitDrop fold a
      // cross-parent drop into this single call instead of a separate setListParent first (see
      // its own comment) — one network round trip and one re-render instead of two sequential
      // ones, which is what was producing a visible two-step "jump" on drop.
      setLists((ls) => applyListReorder(ls, parentId, order));
      try {
        await listsApi.reorder(parentId, order);
      } catch (e) {
        await resyncAfterFailure('reorder lists', e);
      }
    },
    [resyncAfterFailure]
  );

  const reorderListItems = useCallback(
    async (id: string, order: string[]) => {
      setLists((ls) => ls.map((l) => (l.id === id ? { ...l, items: order } : l)));
      try {
        await listsApi.reorderItems(id, order);
      } catch (e) {
        await resyncAfterFailure('reorder list items', e);
      }
    },
    [resyncAfterFailure]
  );

  const toggleMembership = useCallback(
    async (suttaId: string, listId: string) => {
      if (!user) return promptGoogleSignIn();
      const list = lists.find((l) => l.id === listId);
      if (!list) return;
      const current = membership[suttaId] || [];
      const on = current.includes(listId);
      setMembership((m) => ({ ...m, [suttaId]: on ? current.filter((id) => id !== listId) : [...current, listId] }));
      setLists((ls) =>
        ls.map((l) => (l.id === listId ? { ...l, items: on ? l.items.filter((s) => s !== suttaId) : [...l.items, suttaId] } : l))
      );
      try {
        if (on) await listsApi.removeItem(listId, suttaId);
        else await listsApi.addItem(listId, suttaId);
      } catch (e) {
        await resyncAfterFailure('toggle list membership', e);
      }
    },
    [lists, membership, user, promptGoogleSignIn, resyncAfterFailure]
  );

  // Like toggleMembership's "add" branch, but takes the list directly instead of looking it up
  // in `lists` — for adding to a list a caller just created: createList's own setLists call
  // won't be reflected in this component's `lists` closure until the next render, so looking it
  // up by id right after creating it would silently find nothing.
  const addToList = useCallback(
    async (suttaId: string, list: ListDef) => {
      if (!user) return promptGoogleSignIn();
      if ((membership[suttaId] || []).includes(list.id)) return;
      setMembership((m) => ({ ...m, [suttaId]: [...(m[suttaId] || []), list.id] }));
      setLists((ls) => ls.map((l) => (l.id === list.id ? { ...l, items: [...l.items, suttaId] } : l)));
      try {
        await listsApi.addItem(list.id, suttaId);
      } catch (e) {
        await resyncAfterFailure('add to list', e);
        throw e;
      }
    },
    [membership, user, promptGoogleSignIn, resyncAfterFailure]
  );

  // Notes are a discrete, infrequent action (submit on Enter/blur/button — see NoteEditor), not
  // a per-keystroke stream, so — like highlights below — this can afford a full sync after
  // every call instead of an optimistic local sync: `lists`/`membership` include the derived
  // "Highlights"/"Notes" auto-lists computed server-side in buildUserData() (see
  // server/src/routes/data.js), and a sync is the only way to pick up that derived state.
  const submitNote = useCallback(
    async (suttaId: string, text: string) => {
      if (!user) return promptGoogleSignIn();
      const capped = text.slice(0, NOTE_MAX_LENGTH);
      setNotes((n) => ({ ...n, [suttaId]: capped }));
      await mutateThenSync('submit note', () => notesApi.set(suttaId, capped));
    },
    [user, promptGoogleSignIn, mutateThenSync]
  );

  const setHighlightRanges = useCallback(
    async (suttaId: string, ranges: { i: number; s: number; e: number }[], color: string | null) => {
      if (!user) return promptGoogleSignIn();
      if (!ranges.length) return;
      setHighlights((hs) => {
        const current = hs[suttaId] || [];
        const kept = current.filter((h) => !ranges.some((r) => h.i === r.i && h.s < r.e && h.e > r.s));
        const tempGroupId = `temp-${Date.now()}`;
        const added = color
          ? ranges.map((r) => ({ id: `${tempGroupId}-${r.i}`, i: r.i, s: r.s, e: r.e, c: color, g: tempGroupId }))
          : [];
        return { ...hs, [suttaId]: [...kept, ...added] };
      });
      await mutateThenSync('set highlight ranges', () => highlightsApi.setRanges(suttaId, ranges, color), { rethrow: true });
    },
    [user, promptGoogleSignIn, mutateThenSync]
  );

  const removeHighlights = useCallback(
    async (suttaId: string, ids: string[]) => {
      const idSet = new Set(ids);
      setHighlights((hs) => ({ ...hs, [suttaId]: (hs[suttaId] || []).filter((h) => !idSet.has(h.id)) }));
      await mutateThenSync('remove highlights', () => Promise.all(ids.map((id) => highlightsApi.remove(id))));
    },
    [mutateThenSync]
  );

  // The server bumps visitedAt (and so "Recent"'s order) on every call, not just the first visit
  // (see PUT /api/visited/:suttaId), so the optimistic update mirrors that here too — otherwise
  // "Recent" only reflects a mark taken this session after the next unrelated syncUserData call,
  // rather than immediately, and a page that never triggers one (e.g. reading straight through
  // Prev/Next and back out) would show it stale until a manual refresh.
  const markVisited = useCallback(
    (suttaId: string) => {
      if (!user) return;
      setVisited((v) => (v[suttaId] ? v : { ...v, [suttaId]: new Date().toISOString() }));
      setLists((ls) => {
        const recent = ls.find((l) => l.id === RECENT_AUTO_LIST_ID);
        // Already at the front — no-op, so a revisit of the same (already most-recent) sutta
        // doesn't churn `lists`' reference and force every consumer keyed on it (the My Lists
        // tree's own lookup tables, ListPane's flatLists) to rebuild for nothing.
        if (recent && recent.items[0] === suttaId) return ls;
        const items = [suttaId, ...(recent?.items || []).filter((id) => id !== suttaId)].slice(0, RECENT_AUTO_LIST_CAP);
        return recent
          ? ls.map((l) => (l.id === RECENT_AUTO_LIST_ID ? { ...l, items } : l))
          : [...ls, { id: RECENT_AUTO_LIST_ID, label: 'Recent', parentId: null, kind: 'list', items, auto: true }];
      });
      setMembership((m) =>
        (m[suttaId] || []).includes(RECENT_AUTO_LIST_ID) ? m : { ...m, [suttaId]: [...(m[suttaId] || []), RECENT_AUTO_LIST_ID] }
      );
      visitedApi.mark(suttaId).catch((e) => console.error('visited save failed', e));
    },
    [user]
  );

  const value = useMemo<UserDataState>(
    () => ({
      ready,
      lists,
      membership,
      notes,
      highlights,
      visited,
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
      removeHighlights,
      markVisited,
      syncUserData,
    }),
    [
      ready,
      lists,
      membership,
      notes,
      highlights,
      visited,
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
      removeHighlights,
      markVisited,
      syncUserData,
    ]
  );

  return <UserDataContext.Provider value={value}>{children}</UserDataContext.Provider>;
}

export function useUserData() {
  const ctx = useContext(UserDataContext);
  return ctx || EMPTY;
}

export type { Highlight };
