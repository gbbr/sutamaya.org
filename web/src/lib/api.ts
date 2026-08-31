import type { HlSpan } from './highlights';
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

// One item of a push — a record's desired state, or an operation. Every one carries the `mtime` its
// record was stamped with when the user acted (see lib/mtime.ts); the server stores the write only
// if that beats what it already has. The mirror's flush (lib/sync.ts) is the only producer.
export type PushItem =
  // `id` is minted by the client, so a list created offline can be renamed, filed into and moved
  // before it reaches the server. The insert is ON CONFLICT DO NOTHING, so replaying a create is a
  // no-op — unless the id belongs to another account, which is refused `id_collision` (409) and is
  // the flush's cue to mint a fresh one.
  | { type: 'list.create'; id: string; label: string; parentId: string | null; kind: ListKind; mtime: string }
  // A list's whole mutable row — label and parent. Sibling order is not part of it: that travels as
  // one `sibling.order` operation per gesture.
  | { type: 'list.update'; id: string; label: string; parentId: string | null; mtime: string }
  | { type: 'list.delete'; id: string; mtime: string }
  | { type: 'item.add'; listId: string; suttaId: string }
  | { type: 'item.remove'; listId: string; suttaId: string }
  | { type: 'item.order'; listId: string; order: string[]; mtime: string }
  // One parent's children, in order (`parentId: null` for the top level). The server reconciles the
  // posted order against the rows that actually exist, so this is safe to replay from an offline
  // queue.
  | { type: 'sibling.order'; parentId: string | null; order: string[]; mtime: string }
  | { type: 'note'; suttaId: string; text: string; mtime: string }
  // Replayable because the client decides identity: `g` names the highlight being created, `erase`
  // the ones this selection displaces. See worker/src/lib/writes.js.
  | { type: 'highlight'; suttaId: string; span: HlSpan; color: string | null; g: string; erase: string[]; mtime: string }
  // `visited` has no separate mtime column: visitedAt is both the value stored and the guard the
  // write is conditional on.
  | { type: 'visited'; suttaId: string; visitedAt: string };

// What the server says about one pushed item. A refusal is permanent by definition, so `status` is
// there to be logged and told apart from a row that has simply gone (404), never to be retried.
export type PushResult = { ok: true } | { error: string; status: number };

export const dataApi = {
  all: () => request<UserData>('/data'),
  // The app's only write. Results come back positionally — `results[i]` answers `items[i]` — and a
  // refused item neither rolls back nor blocks the rest, which is what lets one sync be a couple of
  // requests instead of one per edit. Anything that fails the request as a whole (401, 429, 5xx,
  // no network) throws, leaving the caller's queue intact.
  push: (items: PushItem[]) => request<{ results: PushResult[] }>('/data/push', { method: 'POST', body: JSON.stringify({ items }) }),
  exportUrl: '/api/data/export',
};

export type { Highlight };
