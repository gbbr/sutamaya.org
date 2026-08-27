import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../index.js';
import { createSessionCookie } from '../session.js';
import {
  applyFlushOutcome,
  createListRecord,
  emptyMirror,
  markDispatched,
  markVisitedRecord,
  queueMembership,
  queueSiblingOrder,
  renameListRecord,
  setNoteRecord,
  syncCounts,
  writeHighlightRecord,
  type MirrorState,
} from '../../../web/src/lib/mirror';
import { flushMirror } from '../../../web/src/lib/sync';
import { deriveUserData } from '../../../web/src/lib/mirrorView';
import { PUSH_MAX_ITEMS } from './data.js';

// The one test that crosses the client/server seam. Everywhere else the two halves are verified
// against their own idea of the other: the web suite mocks lib/api.ts wholesale, and the worker
// suite starts from a hand-built Request. Both stay green through a renamed field, a changed path
// or a drifted response shape — which is exactly what changing the notes payload to `{text, m}`
// did once already.
//
// So this runs the *real* client stack — lib/mirror.ts, lib/sync.ts and lib/api.ts, unmocked —
// against the real Worker and real D1, by routing `fetch` into `app.request`. A "device" is a
// MirrorState plus the flush cycle UserDataContext performs around it (markDispatched, flush,
// applyFlushOutcome); two devices sharing one account are two MirrorStates and one cookie.

async function signIn() {
  const userId = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO users (id, email, google_id, created_at) VALUES (?, ?, ?, ?)')
    .bind(userId, `${userId}@example.com`, `google-${userId}`, new Date().toISOString())
    .run();
  const setCookie = await createSessionCookie(userId, env.SESSION_SECRET);
  return { userId, cookie: setCookie.split(';')[0] };
}

// api.ts fetches same-origin relative paths with a cookie the browser attaches for it. Here the
// stub supplies both: an origin to resolve `/api/...` against, and the session cookie. Everything
// else about the request — method, body, headers, the abort signal — is whatever api.ts built,
// which is the whole point of going through it rather than around it.
//
// Returns the item count of every push the device sends, in order, for the one test that cares how
// a flush was split rather than only what it landed.
function asDevice(cookie: string) {
  const pushSizes: number[] = [];
  vi.stubGlobal('fetch', (path: string, init: RequestInit = {}) => {
    if (path === '/api/data/push' && typeof init.body === 'string') {
      pushSizes.push(JSON.parse(init.body).items.length);
    }
    return app.request(
      `https://sutamaya.test${path}`,
      { ...init, headers: { ...(init.headers as Record<string, string>), Cookie: cookie } },
      env
    );
  });
  return pushSizes;
}

// What UserDataContext does around every flush. markDispatched *before* the first request is
// load-bearing (docs/offline-sync.md, invariant 8), so the harness reproduces it rather than
// calling flushMirror bare.
async function flush(state: MirrorState) {
  const dispatched = markDispatched(state, state);
  const outcome = await flushMirror(dispatched);
  return { state: applyFlushOutcome(dispatched, outcome), outcome };
}

// The server's own view, fetched outside the client stack so an assertion about what was actually
// stored can't be satisfied by the mirror agreeing with itself.
async function serverData(cookie: string) {
  const res = await app.request('https://sutamaya.test/api/data', { headers: { Cookie: cookie } }, env);
  expect(res.status).toBe(200);
  return res.json() as Promise<{
    lists: { id: string; label: string; parentId: string | null; kind: string; items: string[]; auto?: boolean }[];
    membership: Record<string, string[]>;
    notes: Record<string, { text: string; m: string }>;
    highlights: Record<string, { id: string; i: number; s: number; e: number; c: string; g: string; m: string }[]>;
    visited: Record<string, string>;
  }>;
}

const userLists = (data: Awaited<ReturnType<typeof serverData>>) => data.lists.filter((l) => !l.auto);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('client mirror against the real Worker', () => {
  it('lands every kind of offline write in one flush, and leaves nothing dirty', async () => {
    const { cookie } = await signIn();
    asDevice(cookie);

    // Everything a device can accumulate with no network: a list, a sutta filed into it (an op
    // against a list the server has never heard of), a note, a highlight, a visit.
    let state = createListRecord(emptyMirror('u'), { id: crypto.randomUUID(), label: 'Favorites', parentId: null, kind: 'list' });
    const listId = Object.keys(state.lists)[0];
    state = queueMembership(state, listId, 'dn1', true);
    state = setNoteRecord(state, 'dn1', 'on virtue');
    state = writeHighlightRecord(state, 'mn10', [{ i: 3, s: 0, e: 12 }], 'yellow');
    state = markVisitedRecord(state, 'dn2');

    const { state: synced, outcome } = await flush(state);

    expect(outcome.status).toBe('ok');
    expect(syncCounts(synced)).toEqual({ pending: 0 });

    const data = await serverData(cookie);
    expect(userLists(data)).toEqual([{ id: listId, label: 'Favorites', parentId: null, kind: 'list', items: ['dn1'] }]);
    expect(data.notes.dn1.text).toBe('on virtue');
    expect(data.highlights.mn10).toMatchObject([{ i: 3, s: 0, e: 12, c: 'yellow' }]);
    expect(data.visited.dn2).toBeTruthy();

    // And the pull the flush ends with leaves the client rendering the same thing, rather than a
    // shape it happens to have kept locally.
    const view = deriveUserData(synced);
    expect(view.notes.dn1).toBe('on virtue');
    expect(view.membership.dn1).toContain(listId);
    expect(view.highlights.mn10).toHaveLength(1);
  });

  it('splits a queue past the server’s limit into chunks, and lands every one of them', async () => {
    const { cookie } = await signIn();
    const pushSizes = asDevice(cookie);

    // A first sign-in after a long signed-out session: more queued writes than one push may carry.
    // The client's CHUNK_SIZE is a second copy of PUSH_MAX_ITEMS living in a workspace that shares
    // no module with this one, so nothing but this test notices the two drifting apart. Chunking
    // too large is the half that hurts — the server refuses the whole request as `too_many_items`,
    // the flush halts, and everything stays pending — and it fails here without needing its own
    // assertion, because the queue would not drain.
    const total = PUSH_MAX_ITEMS + 50;
    let state = emptyMirror('u');
    for (let i = 0; i < total; i += 1) state = markVisitedRecord(state, `dn${i}`);

    const { state: synced, outcome } = await flush(state);

    expect(outcome.status).toBe('ok');
    expect(pushSizes).toEqual([PUSH_MAX_ITEMS, total - PUSH_MAX_ITEMS]);
    expect(syncCounts(synced)).toEqual({ pending: 0 });
    expect(Object.keys((await serverData(cookie)).visited)).toHaveLength(total);
  });

  it('keeps a reorder queued before a rename, which the row’s own mtime would otherwise drop', async () => {
    const { cookie } = await signIn();
    asDevice(cookie);

    let state = emptyMirror('u');
    const [a, b] = [crypto.randomUUID(), crypto.randomUUID()];
    state = createListRecord(state, { id: a, label: 'A', parentId: null, kind: 'list' });
    state = createListRecord(state, { id: b, label: 'B', parentId: null, kind: 'list' });
    state = (await flush(state)).state;

    // Both order endpoints are conditional on the row's mtime — the same column a rename writes —
    // and answer 200 for a guarded update that matched nothing. Without restampOrderOps the flush
    // would retire this op as landed and the pull would hand back the old order.
    state = queueSiblingOrder(state, null, [b, a]);
    state = renameListRecord(state, a, 'A renamed');
    const { state: synced } = await flush(state);

    expect(userLists(await serverData(cookie)).map((l) => [l.id, l.label])).toEqual([
      [b, 'B'],
      [a, 'A renamed'],
    ]);
    expect(deriveUserData(synced).lists.filter((l) => !l.auto).map((l) => l.id)).toEqual([b, a]);
  });

  it('resolves two devices’ conflicting notes by mtime, and converges the loser on the winner', async () => {
    const { cookie } = await signIn();
    asDevice(cookie);

    // Both devices write while offline, unaware of each other. The stale one flushes second, so
    // arrival order and mtime order disagree — which is the case the conditional write exists for.
    const older = setNoteRecord(emptyMirror('u'), 'dn1', 'written first');
    await new Promise((resolve) => setTimeout(resolve, 2));
    const newer = setNoteRecord(emptyMirror('u'), 'dn1', 'written second');

    await flush(newer);
    const { state: staleAfterPull } = await flush(older);

    expect((await serverData(cookie)).notes.dn1.text).toBe('written second');
    // The losing device doesn't just fail to overwrite — the pull at the end of its own flush
    // replaces what it was showing, so both devices end up reading the same note.
    expect(deriveUserData(staleAfterPull).notes.dn1).toBe('written second');
  });

  it('re-mints a list id that belongs to another account, and takes its queued items along', async () => {
    const other = await signIn();
    const { cookie } = await signIn();
    const taken = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO lists (id, user_id, label, parent_id, kind, position, items, created_at, mtime, deleted) VALUES (?, ?, 'Theirs', NULL, 'list', 0, '[]', ?, ?, 0)"
    )
      .bind(taken, other.userId, new Date().toISOString(), new Date().toISOString())
      .run();
    asDevice(cookie);

    let state = createListRecord(emptyMirror('u'), { id: taken, label: 'Mine', parentId: null, kind: 'list' });
    state = queueMembership(state, taken, 'dn1', true);
    const { state: synced, outcome } = await flush(state);

    expect(outcome.remaps).toHaveLength(1);
    expect(outcome.remaps[0].from).toBe(taken);
    // The op was queued against the old id; it has to have followed the record to the new one, or
    // the list arrives empty and the sutta the user filed is silently gone.
    const lists = userLists(await serverData(cookie));
    expect(lists).toEqual([{ id: outcome.remaps[0].to, label: 'Mine', parentId: null, kind: 'list', items: ['dn1'] }]);
    expect(syncCounts(synced)).toEqual({ pending: 0 });
    // The other account's row is untouched.
    const theirs = userLists(await serverData(other.cookie));
    expect(theirs.map((l) => l.label)).toEqual(['Theirs']);
  });

  it('does not let the pull undo a highlight erased after it had already synced', async () => {
    const { cookie } = await signIn();
    asDevice(cookie);

    let state = writeHighlightRecord(emptyMirror('u'), 'mn10', [{ i: 1, s: 0, e: 5 }], 'yellow');
    state = (await flush(state)).state;
    expect((await serverData(cookie)).highlights.mn10).toHaveLength(1);

    // A recolour is a tombstone plus a brand new group; the erase that follows tombstones that one
    // in turn. Both travel as `erase` lists the client works out, so this is also the check that
    // the server never had to infer what a selection displaced.
    state = writeHighlightRecord(state, 'mn10', [{ i: 1, s: 0, e: 5 }], 'green');
    state = (await flush(state)).state;
    state = writeHighlightRecord(state, 'mn10', [{ i: 1, s: 0, e: 5 }], null);
    const { state: synced } = await flush(state);

    expect((await serverData(cookie)).highlights.mn10 ?? []).toEqual([]);
    expect(deriveUserData(synced).highlights.mn10 ?? []).toEqual([]);
  });
});
