import type { Highlight, ListDef, ListKind, Membership, HighlightsMap, VisitedMap, User } from './types';

// A backstop for a dead connection, not a latency budget: /api/data carries the user's whole
// dataset, so a slow mobile connection can legitimately take a while.
const REQUEST_TIMEOUT_MS = 30_000;

// Carries the HTTP status alongside the message, so retryWithBackoff can tell a permanent rejection
// (400, 404) from one worth retrying (429, 5xx). Thrown only for a non-ok response; a network
// failure or timeout has no status, which isRetryable() treats as retryable.
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    const res = await fetch(`/api${path}`, {
      credentials: 'include',
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
      ...init,
      // After the spread, so the timeout always applies rather than being replaced by init's signal.
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
      throw new ApiError(error, res.status);
    }
    if (res.status === 204) return undefined as T;
    // Awaited inside the try so a body read that aborts is caught below.
    return (await res.json()) as T;
  } catch (err) {
    // The signal aborts the response stream too, not just the connection attempt, so a large
    // payload arriving at the deadline rejects on the body read rather than at fetch().
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new Error(`Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  }
}

export const authApi = {
  me: () => request<{ user: User | null }>('/auth/me'),
  requestEmailCode: (email: string) =>
    request<{ ok: true }>('/auth/email/request', { method: 'POST', body: JSON.stringify({ email }) }),
  verifyEmailCode: (email: string, code: string) =>
    request<{ user: User }>('/auth/email/verify', { method: 'POST', body: JSON.stringify({ email, code }) }),
  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),
};

export interface UserData {
  lists: ListDef[];
  membership: Membership;
  // Not `NotesMap`: the wire carries each note's mtime alongside its text, which the mirror orders
  // the Notes auto-list by (see applySnapshot). NotesMap is the shape the UI renders.
  notes: Record<string, { text: string; m: string }>;
  highlights: HighlightsMap;
  visited: VisitedMap;
}

export const dataApi = {
  all: () => request<UserData>('/data'),
  exportUrl: '/api/data/export',
};

// Every mutating call carries the `mtime` its record was stamped with when the user acted (see
// lib/mtime.ts); the server stores the write only if that beats what it already has. The mirror's
// flush (lib/sync.ts) is the only caller — it pushes a dirty record's desired state, not the
// gesture that produced it.
export const listsApi = {
  // `id` is minted by the client, so a list created offline can be renamed, filed into and moved
  // before it reaches the server. The insert is ON CONFLICT DO NOTHING, so replaying a create is a
  // no-op — unless the id belongs to another account, which answers 409 `id_collision` and is the
  // flush's cue to mint a fresh one.
  create: (list: { id: string; label: string; parentId: string | null; kind: ListKind; mtime: string }) =>
    request<{ list: ListDef }>('/lists', { method: 'POST', body: JSON.stringify(list) }),
  // Carries a list's whole mutable row — label and parent. Sibling order is not part of it: that
  // travels as one `reorder` call per gesture.
  update: (id: string, patch: { label?: string; parentId?: string | null; mtime: string }) =>
    request<{ ok: true }>(`/lists/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  // One parent's children, in order. The server reconciles the posted order against the rows that
  // actually exist, so this is safe to replay from an offline queue.
  reorder: (parentId: string | null, order: string[], mtime: string) =>
    request<{ ok: true }>('/lists/order', { method: 'PUT', body: JSON.stringify({ parentId, order, mtime }) }),
  remove: (id: string, mtime: string) =>
    request<{ ok: true }>(`/lists/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ mtime }) }),
  addItem: (id: string, suttaId: string) => request<{ ok: true }>(`/lists/${encodeURIComponent(id)}/items`, { method: 'POST', body: JSON.stringify({ suttaId }) }),
  removeItem: (id: string, suttaId: string) => request<{ ok: true }>(`/lists/${encodeURIComponent(id)}/items/${encodeURIComponent(suttaId)}`, { method: 'DELETE' }),
  reorderItems: (id: string, order: string[], mtime: string) =>
    request<{ ok: true }>(`/lists/${encodeURIComponent(id)}/items/order`, { method: 'PUT', body: JSON.stringify({ order, mtime }) }),
};

export const notesApi = {
  set: (suttaId: string, text: string, mtime: string) =>
    request<{ ok: true }>(`/notes/${encodeURIComponent(suttaId)}`, { method: 'PUT', body: JSON.stringify({ text, mtime }) }),
};

export const highlightsApi = {
  // `group` makes the write replayable: `g` names the group being created, `erase` the groups this
  // selection displaces, `mtime` when the user acted. See worker/src/routes/annotations.js.
  setRanges: (
    suttaId: string,
    ranges: { i: number; s: number; e: number }[],
    color: string | null,
    group: { g: string; mtime: string; erase: string[] }
  ) => request<{ ok: true }>('/highlights/ranges', { method: 'PUT', body: JSON.stringify({ suttaId, ranges, color, ...group }) }),
};

export const visitedApi = {
  // `visited` has no separate mtime column: visited_at is both the value stored and the guard the
  // write is conditional on.
  mark: (suttaId: string, visitedAt: string) =>
    request<{ ok: true }>(`/visited/${encodeURIComponent(suttaId)}`, { method: 'POST', body: JSON.stringify({ visitedAt }) }),
};

export type { Highlight };
