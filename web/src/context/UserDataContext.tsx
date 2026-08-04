import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { dataApi, highlightsApi, listsApi, notesApi, visitedApi } from '../lib/api';
import type { Highlight, HighlightsMap, ListDef, Membership, NotesMap, VisitedMap } from '../lib/types';
import { useAuth } from './AuthContext';

interface UserDataState {
  ready: boolean;
  lists: ListDef[];
  membership: Membership;
  notes: NotesMap;
  highlights: HighlightsMap;
  visited: VisitedMap;
  listMembers: (label: string) => string[];
  createList: (label: string, parentId?: string | null) => Promise<ListDef>;
  renameList: (id: string, label: string) => Promise<void>;
  removeList: (id: string, label: string) => Promise<void>;
  setListParent: (id: string, parentId: string | null) => Promise<void>;
  reorderLists: (parentId: string | null, order: string[]) => Promise<void>;
  reorderListItems: (id: string, order: string[]) => Promise<void>;
  toggleMembership: (suttaId: string, label: string) => Promise<void>;
  setNote: (suttaId: string, text: string) => void;
  setHighlightRange: (suttaId: string, i: number, s: number, e: number, color: string | null) => Promise<void>;
  removeHighlight: (suttaId: string, id: string) => Promise<void>;
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
  setNote: () => {},
  setHighlightRange: async () => {},
  removeHighlight: async () => {},
  markVisited: () => {},
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
    (label: string) => Object.entries(membership).filter(([, labels]) => labels.includes(label)).map(([id]) => id),
    [membership]
  );

  const createList = useCallback(
    async (label: string, parentId: string | null = null) => {
      if (!user) {
        promptGoogleSignIn();
        throw new Error('not_authenticated');
      }
      const existing = lists.find((l) => l.label === label && l.parentId === parentId);
      if (existing) return existing;
      const { list } = await listsApi.create(label, parentId);
      const def: ListDef = { id: list.id, label: list.label, parentId: list.parentId, items: list.items };
      setLists((ls) => [...ls, def]);
      return def;
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
      // Membership chips are keyed by label, not list id (see routes/data.js) — rewrite them
      // everywhere they appear so the sidebar and any "in lists" chips stay correct without
      // waiting on a refetch.
      setMembership((m) => {
        const next: Membership = {};
        for (const [suttaId, labels] of Object.entries(m)) {
          next[suttaId] = labels.map((l) => (l === old.label ? trimmed : l));
        }
        return next;
      });
      await listsApi.rename(id, trimmed);
    },
    [lists]
  );

  const removeList = useCallback(async (id: string, label: string) => {
    setLists((ls) => ls.filter((l) => l.id !== id));
    setMembership((m) => {
      const next: Membership = {};
      for (const [suttaId, labels] of Object.entries(m)) next[suttaId] = labels.filter((l) => l !== label);
      return next;
    });
    await listsApi.remove(id);
    // The server re-parents any sub-lists of the deleted list to its own parent (see
    // routes/lists.js) instead of orphaning them — refetch to pick that up, since it can't be
    // expressed as a local optimistic edit without duplicating that logic here.
    const fresh = await dataApi.all();
    setLists(fresh.lists);
  }, []);

  const setListParent = useCallback(async (id: string, parentId: string | null) => {
    setLists((ls) => ls.map((l) => (l.id === id ? { ...l, parentId } : l)));
    await listsApi.setParent(id, parentId);
  }, []);

  const reorderLists = useCallback(async (parentId: string | null, order: string[]) => {
    setLists((ls) => {
      const orderIndex = new Map(order.map((id, idx) => [id, idx]));
      const siblings = ls.filter((l) => l.parentId === parentId).sort((a, b) => (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0));
      const others = ls.filter((l) => l.parentId !== parentId);
      return [...others, ...siblings];
    });
    await listsApi.reorder(parentId, order);
  }, []);

  const reorderListItems = useCallback(async (id: string, order: string[]) => {
    setLists((ls) => ls.map((l) => (l.id === id ? { ...l, items: order } : l)));
    await listsApi.reorderItems(id, order);
  }, []);

  const toggleMembership = useCallback(
    async (suttaId: string, label: string) => {
      if (!user) return promptGoogleSignIn();
      const list = lists.find((l) => l.label === label);
      if (!list) return;
      const current = membership[suttaId] || [];
      const on = current.includes(label);
      setMembership((m) => ({ ...m, [suttaId]: on ? current.filter((l) => l !== label) : [...current, label] }));
      setLists((ls) =>
        ls.map((l) => (l.id === list.id ? { ...l, items: on ? l.items.filter((s) => s !== suttaId) : [...l.items, suttaId] } : l))
      );
      if (on) await listsApi.removeItem(list.id, suttaId);
      else await listsApi.addItem(list.id, suttaId);
    },
    [lists, membership, user, promptGoogleSignIn]
  );

  const setNote = useCallback((suttaId: string, text: string) => {
    if (!user) return promptGoogleSignIn();
    setNotes((n) => ({ ...n, [suttaId]: text }));
    notesApi.set(suttaId, text).catch((e) => console.error('note save failed', e));
  }, [user, promptGoogleSignIn]);

  const setHighlightRange = useCallback(
    async (suttaId: string, i: number, s: number, e: number, color: string | null) => {
      if (!user) return promptGoogleSignIn();
      // Functional update (not `highlights[suttaId]` from the outer closure) — a cross-segment
      // highlight calls this once per segment in a row (see useHighlightPopup's `pick`), and
      // each call needs to see the previous call's optimistic write, not the state from when
      // this whole batch started.
      setHighlights((hs) => {
        const current = hs[suttaId] || [];
        const kept = current.filter((h) => !(h.i === i && h.s < e && h.e > s));
        const next = color ? [...kept, { id: `temp-${Date.now()}-${i}`, i, s, e, c: color }] : kept;
        return { ...hs, [suttaId]: next };
      });
      await highlightsApi.setRange(suttaId, i, s, e, color);
      const fresh = await dataApi.all();
      setHighlights(fresh.highlights);
    },
    [user, promptGoogleSignIn]
  );

  const removeHighlight = useCallback(async (suttaId: string, id: string) => {
    setHighlights((hs) => ({ ...hs, [suttaId]: (hs[suttaId] || []).filter((h) => h.id !== id) }));
    await highlightsApi.remove(id);
  }, []);

  const markVisited = useCallback((suttaId: string) => {
    if (!user) return;
    setVisited((v) => (v[suttaId] ? v : { ...v, [suttaId]: new Date().toISOString() }));
    visitedApi.mark(suttaId).catch((e) => console.error('visited save failed', e));
  }, [user]);

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
      setNote,
      setHighlightRange,
      removeHighlight,
      markVisited,
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
      setNote,
      setHighlightRange,
      removeHighlight,
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
