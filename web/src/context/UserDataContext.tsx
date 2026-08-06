import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { dataApi, highlightsApi, listsApi, notesApi, visitedApi } from '../lib/api';
import type { Highlight, HighlightsMap, ListDef, ListKind, Membership, NotesMap, VisitedMap } from '../lib/types';
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
      setReady(false);
      setLists([]);
      setMembership({});
      setNotes({});
      setHighlights({});
      setVisited({});
      return;
    }
    let cancelled = false;
    setReady(false);
    dataApi.all().then((d) => {
      if (cancelled) return;
      setLists(d.lists);
      setMembership(d.membership);
      setNotes(d.notes);
      setHighlights(d.highlights);
      setVisited(d.visited);
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

  const createList = useCallback(
    async (label: string, parentId: string | null = null, kind: ListKind = 'list') => {
      if (!user) {
        promptGoogleSignIn();
        throw new Error('not_authenticated');
      }
      const existing = lists.find((l) => l.label === label && l.parentId === parentId && l.kind === kind);
      if (existing) return existing;
      try {
        const { list } = await listsApi.create(label, parentId, kind);
        const def: ListDef = { id: list.id, label: list.label, parentId: list.parentId, kind: list.kind, items: list.items };
        setLists((ls) => [...ls, def]);
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
      const trimmed = label.trim();
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
      setLists((ls) => {
        const orderIndex = new Map(order.map((id, idx) => [id, idx]));
        const siblings = ls.filter((l) => l.parentId === parentId).sort((a, b) => (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0));
        const others = ls.filter((l) => l.parentId !== parentId);
        return [...others, ...siblings];
      });
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
      setNotes((n) => ({ ...n, [suttaId]: text }));
      try {
        await notesApi.set(suttaId, text);
        await syncUserData();
      } catch (e) {
        await resyncAfterFailure('submit note', e);
      }
    },
    [user, promptGoogleSignIn, syncUserData, resyncAfterFailure]
  );

  const setHighlightRanges = useCallback(
    async (suttaId: string, ranges: { i: number; s: number; e: number }[], color: string | null) => {
      if (!user) return promptGoogleSignIn();
      if (!ranges.length) return;
      setHighlights((hs) => {
        const current = hs[suttaId] || [];
        const kept = current.filter((h) => !ranges.some((r) => h.i === r.i && h.s < r.e && h.e > r.s));
        const added = color ? ranges.map((r) => ({ id: `temp-${Date.now()}-${r.i}`, i: r.i, s: r.s, e: r.e, c: color })) : [];
        return { ...hs, [suttaId]: [...kept, ...added] };
      });
      try {
        await highlightsApi.setRanges(suttaId, ranges, color);
        await syncUserData();
      } catch (err) {
        await resyncAfterFailure('set highlight ranges', err);
        throw err;
      }
    },
    [user, promptGoogleSignIn, syncUserData, resyncAfterFailure]
  );

  const removeHighlights = useCallback(
    async (suttaId: string, ids: string[]) => {
      const idSet = new Set(ids);
      setHighlights((hs) => ({ ...hs, [suttaId]: (hs[suttaId] || []).filter((h) => !idSet.has(h.id)) }));
      try {
        await Promise.all(ids.map((id) => highlightsApi.remove(id)));
        await syncUserData();
      } catch (e) {
        await resyncAfterFailure('remove highlights', e);
      }
    },
    [syncUserData, resyncAfterFailure]
  );

  const markVisited = useCallback(
    (suttaId: string) => {
      if (!user) return;
      setVisited((v) => (v[suttaId] ? v : { ...v, [suttaId]: new Date().toISOString() }));
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
