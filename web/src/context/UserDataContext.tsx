import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { navigate } from '@reach/router';
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
  createList: (label: string) => Promise<ListDef>;
  removeList: (id: string, label: string) => Promise<void>;
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
  removeList: async () => {},
  toggleMembership: async () => {},
  setNote: () => {},
  setHighlightRange: async () => {},
  removeHighlight: async () => {},
  markVisited: () => {},
};

export function UserDataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
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

  const createList = useCallback(async (label: string) => {
    if (!user) {
      navigate('/login');
      throw new Error('not_authenticated');
    }
    const existing = lists.find((l) => l.label === label);
    if (existing) return existing;
    const { list } = await listsApi.create(label);
    const def: ListDef = { id: list.id, label: list.label };
    setLists((ls) => [...ls, def]);
    return def;
  }, [lists, user]);

  const removeList = useCallback(async (id: string, label: string) => {
    setLists((ls) => ls.filter((l) => l.id !== id));
    setMembership((m) => {
      const next: Membership = {};
      for (const [suttaId, labels] of Object.entries(m)) next[suttaId] = labels.filter((l) => l !== label);
      return next;
    });
    await listsApi.remove(id);
  }, []);

  const toggleMembership = useCallback(
    async (suttaId: string, label: string) => {
      if (!user) return navigate('/login');
      const list = lists.find((l) => l.label === label);
      if (!list) return;
      const current = membership[suttaId] || [];
      const on = current.includes(label);
      setMembership((m) => ({ ...m, [suttaId]: on ? current.filter((l) => l !== label) : [...current, label] }));
      if (on) await listsApi.removeItem(list.id, suttaId);
      else await listsApi.addItem(list.id, suttaId);
    },
    [lists, membership, user]
  );

  const setNote = useCallback((suttaId: string, text: string) => {
    if (!user) return navigate('/login');
    setNotes((n) => ({ ...n, [suttaId]: text }));
    notesApi.set(suttaId, text).catch((e) => console.error('note save failed', e));
  }, [user]);

  const setHighlightRange = useCallback(
    async (suttaId: string, i: number, s: number, e: number, color: string | null) => {
      if (!user) return navigate('/login');
      const current = highlights[suttaId] || [];
      const kept = current.filter((h) => !(h.i === i && h.s < e && h.e > s));
      const next = color ? [...kept, { id: `temp-${Date.now()}`, i, s, e, c: color }] : kept;
      setHighlights((hs) => ({ ...hs, [suttaId]: next }));
      await highlightsApi.setRange(suttaId, i, s, e, color);
      const fresh = await dataApi.all();
      setHighlights(fresh.highlights);
    },
    [highlights, user]
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
    () => ({ ready, lists, membership, notes, highlights, visited, listMembers, createList, removeList, toggleMembership, setNote, setHighlightRange, removeHighlight, markVisited }),
    [ready, lists, membership, notes, highlights, visited, listMembers, createList, removeList, toggleMembership, setNote, setHighlightRange, removeHighlight, markVisited]
  );

  return <UserDataContext.Provider value={value}>{children}</UserDataContext.Provider>;
}

export function useUserData() {
  const ctx = useContext(UserDataContext);
  return ctx || EMPTY;
}

export type { Highlight };
