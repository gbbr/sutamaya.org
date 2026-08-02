import type { Highlight, ListDef, Membership, NotesMap, HighlightsMap, VisitedMap, User } from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  if (!res.ok) {
    let error = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) error = body.error;
    } catch {
      // ignore
    }
    throw new Error(error);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const authApi = {
  me: () => request<{ user: User | null }>('/auth/me'),
  register: (email: string, password: string) =>
    request<{ user: User }>('/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) }),
  login: (email: string, password: string) =>
    request<{ user: User }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),
};

export interface UserData {
  lists: ListDef[];
  membership: Membership;
  notes: NotesMap;
  highlights: HighlightsMap;
  visited: VisitedMap;
}

export const dataApi = {
  all: () => request<UserData>('/data'),
  exportUrl: '/api/data/export',
};

export const listsApi = {
  create: (label: string) => request<{ list: ListDef & { items: string[] } }>('/lists', { method: 'POST', body: JSON.stringify({ label }) }),
  rename: (id: string, label: string) => request<{ ok: true }>(`/lists/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ label }) }),
  remove: (id: string) => request<{ ok: true }>(`/lists/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  addItem: (id: string, suttaId: string) => request<{ ok: true }>(`/lists/${encodeURIComponent(id)}/items`, { method: 'POST', body: JSON.stringify({ suttaId }) }),
  removeItem: (id: string, suttaId: string) => request<{ ok: true }>(`/lists/${encodeURIComponent(id)}/items/${encodeURIComponent(suttaId)}`, { method: 'DELETE' }),
};

export const notesApi = {
  set: (suttaId: string, text: string) => request<{ ok: true }>(`/notes/${encodeURIComponent(suttaId)}`, { method: 'PUT', body: JSON.stringify({ text }) }),
};

export const highlightsApi = {
  setRange: (suttaId: string, i: number, s: number, e: number, color: string | null) =>
    request<{ ok: true }>('/highlights/range', { method: 'PUT', body: JSON.stringify({ suttaId, i, s, e, color }) }),
  remove: (id: string) => request<{ ok: true }>(`/highlights/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

export const visitedApi = {
  mark: (suttaId: string) => request<{ ok: true }>(`/visited/${encodeURIComponent(suttaId)}`, { method: 'POST' }),
};

export type { Highlight };
