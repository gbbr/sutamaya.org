import type { Highlight, ListDef, ListKind, Membership, NotesMap, HighlightsMap, VisitedMap, User } from './types';

// Deliberately generous: this is the "the connection is dead" backstop, not a latency budget.
// /api/data carries the user's whole dataset, so a genuinely slow mobile connection can legitimately
// take a while — timing out early would turn a slow-but-fine request into a failure, which stops the
// rest of that flush and defers it to the next trigger. Without any timeout at all, though, a
// stalled connection hangs for the browser's own default (minutes), holding the flush open with it.
const REQUEST_TIMEOUT_MS = 30_000;

// Carries the HTTP status alongside the message so callers — retryWithBackoff in particular — can
// tell a permanent rejection (400, 404) from one worth retrying (429, 5xx) without parsing text.
// Thrown only for a non-ok response; a network failure or a timeout has no status to attach, which
// retryWithBackoff's isRetryable() treats as retryable rather than as a missing case.
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
      throw new ApiError(error, res.status);
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

// Every mutating call carries the `mtime` its record was stamped with when the user acted (see
// lib/mtime.ts) — the server stores the write only if that beats what it already has. None of
// these are called from the UI directly any more: the mirror's flush (lib/sync.ts) is the only
// caller, pushing a dirty record's desired state rather than the gesture that produced it.
export const listsApi = {
  // `id` is minted by the client, so a list created offline can be renamed, filed into and moved
  // before it has ever reached the server. The insert is ON CONFLICT DO NOTHING, so re-sending a
  // create whose response was lost is a no-op — unless the id belongs to another account, which
  // answers 409 `id_collision` and is the flush's cue to mint a fresh one.
  create: (list: { id: string; label: string; parentId: string | null; kind: ListKind; mtime: string }) =>
    request<{ list: ListDef }>('/lists', { method: 'POST', body: JSON.stringify(list) }),
  // One PATCH carries a list's whole mutable row — label and parent — because the mirror pushes the
  // record's desired state, not the individual edit that changed it. Sibling order is *not* part of
  // it: that travels as one `reorder` call for the whole gesture (see below), so a drag costs one
  // request instead of one per sibling.
  update: (id: string, patch: { label?: string; parentId?: string | null; mtime: string }) =>
    request<{ ok: true }>(`/lists/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  // One parent's children, in order — the whole of one drag or Move-up/down click, whatever the
  // group's size. The server reconciles the posted order against the rows that actually exist, so
  // this is safe to replay from an offline queue.
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
  // `group` is what makes this write replayable: `g` names the group being created (so re-sending
  // it is a no-op rather than a second highlight), `erase` names the groups this selection
  // displaces (so the server never has to infer that from rows that may have changed since), and
  // `mtime` is when the user acted. See worker/src/routes/annotations.js.
  setRanges: (
    suttaId: string,
    ranges: { i: number; s: number; e: number }[],
    color: string | null,
    group: { g: string; mtime: string; erase: string[] }
  ) => request<{ ok: true }>('/highlights/ranges', { method: 'PUT', body: JSON.stringify({ suttaId, ranges, color, ...group }) }),
};

export const visitedApi = {
  // `visited` has no separate mtime column — visited_at is its own clock, so the instant the user
  // opened the sutta is both the value stored and the guard the write is conditional on.
  mark: (suttaId: string, visitedAt: string) =>
    request<{ ok: true }>(`/visited/${encodeURIComponent(suttaId)}`, { method: 'POST', body: JSON.stringify({ visitedAt }) }),
};

export type { Highlight };
