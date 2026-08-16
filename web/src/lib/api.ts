import type { Highlight, ListDef, ListKind, Membership, NotesMap, HighlightsMap, VisitedMap, User } from './types';

// Deliberately generous: this is the "the connection is dead" backstop, not a latency budget.
// /api/data carries the user's whole dataset, so a genuinely slow mobile connection can legitimately
// take a while — timing out early would turn a slow-but-fine request into a failure, and every
// failed mutation triggers a full resync (see UserDataContext), making things worse rather than
// better. Without any timeout at all, though, a stalled connection hangs for the browser's own
// default (minutes), leaving mutations unsettled and their in-progress UI stuck with them.
const REQUEST_TIMEOUT_MS = 30_000;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    const res = await fetch(`/api${path}`, {
      credentials: 'include',
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
      ...init,
      // After the spread, so the timeout always applies — no call site passes a signal of its own
      // today, and one silently replacing this would reintroduce the unbounded hang.
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
    // Awaited inside the try, not returned as a bare promise, so a body read that aborts is
    // caught below rather than escaping as-is.
    return (await res.json()) as T;
  } catch (err) {
    // The signal aborts the response stream too, not just the connection attempt, so a large
    // payload still arriving at the deadline (/api/data is the one that gets there) rejects on
    // the body read rather than at fetch() — hence the catch around both. Surfaces as a legible
    // message in the failure logs every mutator writes, rather than the bare "signal timed out"
    // DOMException.
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new Error(`Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  }
}

export const authApi = {
  me: () => request<{ user: User | null }>('/auth/me'),
  google: (credential: string) =>
    request<{ user: User }>('/auth/google', { method: 'POST', body: JSON.stringify({ credential }) }),
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
  create: (label: string, parentId: string | null = null, kind: ListKind = 'list') =>
    request<{ list: ListDef }>('/lists', { method: 'POST', body: JSON.stringify({ label, parentId, kind }) }),
  rename: (id: string, label: string) => request<{ ok: true }>(`/lists/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ label }) }),
  setParent: (id: string, parentId: string | null) =>
    request<{ ok: true }>(`/lists/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ parentId }) }),
  remove: (id: string) => request<{ ok: true }>(`/lists/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  reorder: (parentId: string | null, order: string[]) =>
    request<{ ok: true }>('/lists/order', { method: 'PUT', body: JSON.stringify({ parentId, order }) }),
  addItem: (id: string, suttaId: string) => request<{ ok: true }>(`/lists/${encodeURIComponent(id)}/items`, { method: 'POST', body: JSON.stringify({ suttaId }) }),
  removeItem: (id: string, suttaId: string) => request<{ ok: true }>(`/lists/${encodeURIComponent(id)}/items/${encodeURIComponent(suttaId)}`, { method: 'DELETE' }),
  reorderItems: (id: string, order: string[]) =>
    request<{ ok: true }>(`/lists/${encodeURIComponent(id)}/items/order`, { method: 'PUT', body: JSON.stringify({ order }) }),
};

export const notesApi = {
  set: (suttaId: string, text: string) => request<{ ok: true }>(`/notes/${encodeURIComponent(suttaId)}`, { method: 'PUT', body: JSON.stringify({ text }) }),
};

export const highlightsApi = {
  setRanges: (suttaId: string, ranges: { i: number; s: number; e: number }[], color: string | null) =>
    request<{ ok: true }>('/highlights/ranges', { method: 'PUT', body: JSON.stringify({ suttaId, ranges, color }) }),
};

export const visitedApi = {
  mark: (suttaId: string) => request<{ ok: true }>(`/visited/${encodeURIComponent(suttaId)}`, { method: 'POST' }),
};

export type { Highlight };
