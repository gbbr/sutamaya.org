import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import app from '../index.js';
import { createSessionCookie } from '../session.js';

// Assertions read `lists` rows straight out of env.DB, and a signed-in caller is a real signed
// session cookie (see session.js). D1 rows need no explicit cleanup — vitest-pool-workers rolls
// back each test's storage writes (isolatedStorage, on by default).

// requireAuth never reads the database (see its comment in auth.js), but `lists.user_id` is a real
// foreign key into `users`, so a signed-in caller needs an actual user row behind the cookie.
async function signIn() {
  const userId = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO users (id, email, google_id, created_at) VALUES (?, ?, ?, ?)')
    .bind(userId, `${userId}@example.com`, `google-${userId}`, new Date().toISOString())
    .run();
  const setCookie = await createSessionCookie(userId, env.SESSION_SECRET);
  return { userId, cookie: setCookie.split(';')[0] };
}

function api(path, { method = 'GET', body, cookie } = {}) {
  return app.request(
    path,
    {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env
  );
}

async function createList(cookie, body) {
  const res = await api('/api/lists', { method: 'POST', cookie, body });
  return (await res.json()).list;
}

function listRow(id) {
  return env.DB.prepare('SELECT * FROM lists WHERE id = ?').bind(id).first();
}

async function itemsOf(id) {
  return JSON.parse((await listRow(id)).items);
}

async function siblingIds(userId, parentId) {
  const { results } = await env.DB.prepare(
    'SELECT id FROM lists WHERE user_id = ? AND parent_id IS ? ORDER BY position'
  )
    .bind(userId, parentId)
    .all();
  return results.map((row) => row.id);
}

describe('routes/lists.js (D1)', () => {
  it('requires authentication', async () => {
    const res = await api('/api/lists');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'not_authenticated' });
  });

  it('creates a top-level list', async () => {
    const { cookie } = await signIn();
    const res = await api('/api/lists', { method: 'POST', cookie, body: { label: 'My favorites' } });
    expect(res.status).toBe(201);
    expect((await res.json()).list).toMatchObject({ label: 'My favorites', parentId: null, kind: 'list', items: [] });
  });

  it('creates a list with a client-supplied id', async () => {
    const { userId, cookie } = await signIn();
    const res = await api('/api/lists', { method: 'POST', cookie, body: { label: 'Mine', id: 'client-chosen-id' } });
    expect(res.status).toBe(201);
    expect((await res.json()).list.id).toBe('client-chosen-id');
    expect(await siblingIds(userId, null)).toEqual(['client-chosen-id']);
  });

  // A create whose response was lost and got retried must be a no-op, not a duplicate row or an
  // error — that's what makes client-generated ids safe to retry.
  it('re-sending a create with the same client id is a no-op rather than a duplicate or an error', async () => {
    const { userId, cookie } = await signIn();
    const first = await api('/api/lists', { method: 'POST', cookie, body: { label: 'First label', id: 'dupe-id' } });
    expect(first.status).toBe(201);
    const second = await api('/api/lists', { method: 'POST', cookie, body: { label: 'Second label', id: 'dupe-id' } });
    expect(second.status).toBe(201);

    expect(await siblingIds(userId, null)).toEqual(['dupe-id']);
    expect((await listRow('dupe-id')).label).toBe('First label');
  });

  // The same skipped insert as above, but from a second account: `lists.id` is a global primary
  // key, so the conflict clause absorbs another user's row just as readily as a retry. Answering
  // 201 here would hand the client an id it doesn't own and every later write against it would 404.
  it('rejects a create whose client id is already held by another user', async () => {
    const owner = await signIn();
    expect((await api('/api/lists', { method: 'POST', cookie: owner.cookie, body: { label: 'Theirs', id: 'shared-id' } })).status).toBe(201);

    const other = await signIn();
    const res = await api('/api/lists', { method: 'POST', cookie: other.cookie, body: { label: 'Mine', id: 'shared-id' } });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'id_collision' });

    expect(await siblingIds(other.userId, null)).toEqual([]);
    expect((await listRow('shared-id')).user_id).toBe(owner.userId);
  });

  // A stored row sharing an auto-list's id would be returned alongside the synthesized one, and
  // the client resolves auto-lists by id.
  it.each(['auto-recent', 'auto-highlights', 'auto-notes'])('refuses to store a list under the reserved id %s', async (id) => {
    const { userId, cookie } = await signIn();
    const res = await api('/api/lists', { method: 'POST', cookie, body: { label: 'Impostor', id } });
    expect(res.status).toBe(400);
    expect(await siblingIds(userId, null)).toEqual([]);
  });

  it('rejects a list whose parent is another plain list (not a group)', async () => {
    const { cookie } = await signIn();
    const plain = await createList(cookie, { label: 'Plain' });
    const res = await api('/api/lists', { method: 'POST', cookie, body: { label: 'Child', parentId: plain.id } });
    expect(res.status).toBe(400);
  });

  it('nests a list under a group', async () => {
    const { cookie } = await signIn();
    const group = await createList(cookie, { label: 'Group', kind: 'group' });
    const res = await api('/api/lists', { method: 'POST', cookie, body: { label: 'Child', parentId: group.id } });
    expect(res.status).toBe(201);
    expect((await res.json()).list.parentId).toBe(group.id);
  });

  // New lists/groups are meant to appear at the front of their parent's children, not the back —
  // per product decision on the "+" button next to My Lists.
  it('puts a newly-created list first among its top-level siblings', async () => {
    const { userId, cookie } = await signIn();
    const first = await createList(cookie, { label: 'First' });
    const second = await createList(cookie, { label: 'Second' });
    expect(await siblingIds(userId, null)).toEqual([second.id, first.id]);
  });

  it('puts a newly-created list first among its siblings under the same group', async () => {
    const { userId, cookie } = await signIn();
    const group = await createList(cookie, { label: 'Group', kind: 'group' });
    const first = await createList(cookie, { label: 'First', parentId: group.id });
    const second = await createList(cookie, { label: 'Second', parentId: group.id });
    expect(await siblingIds(userId, group.id)).toEqual([second.id, first.id]);
  });

  // The create statement computes its position in SQL (CREATE_LIST_SQL) rather than through
  // lib/listPositions.js's firstPosition(), so this pins the one non-obvious bit of that reduce:
  // seeded at 1, an empty sibling set yields 0 and not -1.
  it('positions the first list in an empty parent at 0 and the next at -1', async () => {
    const { cookie } = await signIn();
    const first = await createList(cookie, { label: 'First' });
    const second = await createList(cookie, { label: 'Second' });
    expect((await listRow(first.id)).position).toBe(0);
    expect((await listRow(second.id)).position).toBe(-1);
  });

  // "Does this list exist" is folded into the write itself — `meta.changes === 0` off the
  // UPDATE means no matching row. What's pinned here is the 404 response contract.
  it('PATCH on a nonexistent list 404s', async () => {
    const { cookie } = await signIn();
    const res = await api('/api/lists/does-not-exist', { method: 'PATCH', cookie, body: { label: 'x' } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('DELETE item from a nonexistent list 404s', async () => {
    const { cookie } = await signIn();
    const res = await api('/api/lists/does-not-exist/items/sn1.1', { method: 'DELETE', cookie });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('PATCH on a real list with no recognized fields still 404s for a bogus id', async () => {
    const { cookie } = await signIn();
    const res = await api('/api/lists/does-not-exist', { method: 'PATCH', cookie, body: {} });
    expect(res.status).toBe(404);
  });

  // The WHERE mtime < ? guard is the entire conflict resolution for a rename/move: a stale
  // offline edit replayed after a newer one must not win. Both mtimes are set well past the
  // real clock so they're guaranteed newer than the row's own server-generated creation mtime.
  it('does not let an older client mtime overwrite a rename made with a newer one', async () => {
    const { cookie } = await signIn();
    const list = await createList(cookie, { label: 'Original' });
    await api(`/api/lists/${list.id}`, { method: 'PATCH', cookie, body: { label: 'Newer', mtime: '2030-01-02T00:00:00.000Z|a' } });
    const res = await api(`/api/lists/${list.id}`, { method: 'PATCH', cookie, body: { label: 'Older', mtime: '2030-01-01T00:00:00.000Z|a' } });

    // A rejected stale write is not an error — the loser of last-writer-wins is dropped silently.
    expect(res.status).toBe(200);
    expect((await listRow(list.id)).label).toBe('Newer');
  });

  it('does not let an equal client mtime overwrite a rename either', async () => {
    const { cookie } = await signIn();
    const list = await createList(cookie, { label: 'Original' });
    const mtime = '2030-01-01T00:00:00.000Z|a';
    await api(`/api/lists/${list.id}`, { method: 'PATCH', cookie, body: { label: 'First', mtime } });
    await api(`/api/lists/${list.id}`, { method: 'PATCH', cookie, body: { label: 'Second', mtime } });
    expect((await listRow(list.id)).label).toBe('First');
  });

  // Tombstoned, not removed: the row has to stay behind so a device that was offline when the
  // delete happened can't push its still-live copy back as an apparently-new list.
  it('deleting a list tombstones the row and hides it from GET /api/data', async () => {
    const { cookie } = await signIn();
    const list = await createList(cookie, { label: 'Doomed' });
    await api(`/api/lists/${list.id}/items`, { method: 'POST', cookie, body: { suttaId: 'sn1.1' } });

    const del = await api(`/api/lists/${list.id}`, { method: 'DELETE', cookie });
    expect(del.status).toBe(200);

    const row = await listRow(list.id);
    expect(row).toBeTruthy();
    expect(row.deleted).toBe(1);
    // `items` is untouched, so the list returns intact if it is ever resurrected.
    expect(JSON.parse(row.items)).toEqual(['sn1.1']);

    const data = await (await api('/api/data', { cookie })).json();
    expect(data.lists.find((l) => l.id === list.id)).toBeUndefined();
    // ...and it stops contributing membership chips for the suttas it held.
    expect(data.membership['sn1.1']).toBeUndefined();
  });

  // Deleting a group takes everything inside it, the way deleting a folder does. The write side is
  // one tombstone on the group — the descendants' own rows are untouched, and lib/listTree.js
  // cascades them out on read, so a nested list added on another device while this one was offline
  // gets hidden too instead of surfacing as a stray at the top level.
  it('cascades a deleted group’s whole subtree out of GET /api/data with one tombstone', async () => {
    const { cookie } = await signIn();
    const group = await createList(cookie, { label: 'Group', kind: 'group' });
    const inner = await createList(cookie, { label: 'Inner', kind: 'group', parentId: group.id });
    const leaf = await createList(cookie, { label: 'Leaf', parentId: inner.id });
    await api(`/api/lists/${leaf.id}/items`, { method: 'POST', cookie, body: { suttaId: 'sn1.1' } });
    const survivor = await createList(cookie, { label: 'Survivor' });

    const del = await api(`/api/lists/${group.id}`, { method: 'DELETE', cookie });
    expect(del.status).toBe(200);

    // Only the group itself was written to; the descendants keep their rows and their parents.
    expect((await listRow(group.id)).deleted).toBe(1);
    expect((await listRow(inner.id)).deleted).toBe(0);
    expect((await listRow(leaf.id)).parent_id).toBe(inner.id);

    const data = await (await api('/api/data', { cookie })).json();
    expect(data.lists.map((l) => l.id)).toEqual([survivor.id]);
    // ...and the buried list stops contributing membership chips.
    expect(data.membership['sn1.1']).toBeUndefined();
  });

  // A queued delete replayed after it already landed must not start 404ing — that would look like
  // a permanently-rejected record to a flushing client.
  it('re-deleting an already-tombstoned list is a no-op success, not a 404', async () => {
    const { cookie } = await signIn();
    const list = await createList(cookie, { label: 'Doomed' });
    expect((await api(`/api/lists/${list.id}`, { method: 'DELETE', cookie })).status).toBe(200);
    expect((await api(`/api/lists/${list.id}`, { method: 'DELETE', cookie })).status).toBe(200);
    expect((await listRow(list.id)).deleted).toBe(1);
  });

  it('does not let a stale delete take out a list renamed more recently', async () => {
    const { cookie } = await signIn();
    const list = await createList(cookie, { label: 'Keep me' });
    await api(`/api/lists/${list.id}`, { method: 'PATCH', cookie, body: { label: 'Renamed', mtime: '2030-01-02T00:00:00.000Z|a' } });
    const del = await api(`/api/lists/${list.id}`, { method: 'DELETE', cookie, body: { mtime: '2030-01-01T00:00:00.000Z|a' } });
    expect(del.status).toBe(200);
    expect((await listRow(list.id)).deleted).toBe(0);
  });

  it('deleting a nonexistent list 404s', async () => {
    const { cookie } = await signIn();
    const res = await api('/api/lists/does-not-exist', { method: 'DELETE', cookie });
    expect(res.status).toBe(404);
  });

  // Membership stays operation-based, so an add queued offline can arrive after the list's own
  // delete. It has to land on the dead row rather than 404 — dropping it is the silent loss the
  // whole offline-sync design exists to prevent.
  it('an add targeting a tombstoned list still lands on the dead row', async () => {
    const { cookie } = await signIn();
    const list = await createList(cookie, { label: 'Doomed' });
    await api(`/api/lists/${list.id}`, { method: 'DELETE', cookie });

    const add = await api(`/api/lists/${list.id}/items`, { method: 'POST', cookie, body: { suttaId: 'sn1.1' } });
    expect(add.status).toBe(201);
    expect(await itemsOf(list.id)).toEqual(['sn1.1']);

    // Still invisible, since the row is tombstoned.
    const data = await (await api('/api/data', { cookie })).json();
    expect(data.membership['sn1.1']).toBeUndefined();
  });

  // Nesting under a group deleted elsewhere is accepted rather than rejected 400: the write lands
  // instead of being thrown away, and the cascade then hides it along with the rest of that group's
  // subtree — the user deleted the group, so nothing inside it should come back.
  it('accepts nesting a new list under a tombstoned group, then cascades it out on read', async () => {
    const { cookie } = await signIn();
    const group = await createList(cookie, { label: 'Group', kind: 'group' });
    await api(`/api/lists/${group.id}`, { method: 'DELETE', cookie });

    const res = await api('/api/lists', { method: 'POST', cookie, body: { label: 'Child', parentId: group.id } });
    expect(res.status).toBe(201);
    const child = (await res.json()).list;
    expect((await listRow(child.id)).parent_id).toBe(group.id);

    const data = await (await api('/api/data', { cookie })).json();
    expect(data.lists.find((l) => l.id === child.id)).toBeUndefined();
  });

  it('adds and removes a sutta from a list', async () => {
    const { cookie } = await signIn();
    const list = await createList(cookie, { label: 'L' });
    const add = await api(`/api/lists/${list.id}/items`, { method: 'POST', cookie, body: { suttaId: 'sn1.1' } });
    expect(add.status).toBe(201);
    expect(await itemsOf(list.id)).toEqual(['sn1.1']);

    const remove = await api(`/api/lists/${list.id}/items/sn1.1`, { method: 'DELETE', cookie });
    expect(remove.status).toBe(200);
    expect(await itemsOf(list.id)).toEqual([]);
  });

  // FieldValue.arrayUnion was idempotent for free; ADD_ITEM_SQL's EXISTS guard is what reproduces
  // that, so it gets its own assertion.
  it('adding the same sutta twice does not duplicate it', async () => {
    const { cookie } = await signIn();
    const list = await createList(cookie, { label: 'L' });
    await api(`/api/lists/${list.id}/items`, { method: 'POST', cookie, body: { suttaId: 'sn1.1' } });
    await api(`/api/lists/${list.id}/items`, { method: 'POST', cookie, body: { suttaId: 'sn1.1' } });
    expect(await itemsOf(list.id)).toEqual(['sn1.1']);
  });

  it('rejects adding a sutta to a group', async () => {
    const { cookie } = await signIn();
    const group = await createList(cookie, { label: 'Group', kind: 'group' });
    const res = await api(`/api/lists/${group.id}/items`, { method: 'POST', cookie, body: { suttaId: 'sn1.1' } });
    expect(res.status).toBe(400);
  });

  it('rejects reparenting a list into its own descendant (cycle check)', async () => {
    const { cookie } = await signIn();
    const grandparent = await createList(cookie, { label: 'A', kind: 'group' });
    const parent = await createList(cookie, { label: 'B', kind: 'group', parentId: grandparent.id });

    const res = await api(`/api/lists/${grandparent.id}`, { method: 'PATCH', cookie, body: { parentId: parent.id } });
    expect(res.status).toBe(400);
  });

  it("PUT /:id/items/order reorders a list's own items", async () => {
    const { cookie } = await signIn();
    const list = await createList(cookie, { label: 'L' });
    for (const suttaId of ['sn1.1', 'sn1.2', 'sn1.3']) {
      await api(`/api/lists/${list.id}/items`, { method: 'POST', cookie, body: { suttaId } });
    }

    const res = await api(`/api/lists/${list.id}/items/order`, {
      method: 'PUT',
      cookie,
      body: { order: ['sn1.3', 'sn1.1', 'sn1.2'] },
    });
    expect(res.status).toBe(200);
    expect(await itemsOf(list.id)).toEqual(['sn1.3', 'sn1.1', 'sn1.2']);
  });

  it('PUT /:id/items/order appends an item present in stored items but missing from the posted order', async () => {
    const { cookie } = await signIn();
    const list = await createList(cookie, { label: 'L' });
    await api(`/api/lists/${list.id}/items`, { method: 'POST', cookie, body: { suttaId: 'sn1.1' } });
    await api(`/api/lists/${list.id}/items`, { method: 'POST', cookie, body: { suttaId: 'sn1.2' } });

    // Simulates another tab adding sn1.2 after this client already snapshotted an order of just ['sn1.1'].
    const res = await api(`/api/lists/${list.id}/items/order`, { method: 'PUT', cookie, body: { order: ['sn1.1'] } });
    expect(res.status).toBe(200);
    expect(await itemsOf(list.id)).toEqual(['sn1.1', 'sn1.2']);
  });

  // Item order moves as a unit on the list's own mtime — a stale offline reorder replayed after
  // a newer one must not win.
  it('does not let an older client mtime overwrite an item order set with a newer one', async () => {
    const { cookie } = await signIn();
    const list = await createList(cookie, { label: 'L' });
    for (const suttaId of ['sn1.1', 'sn1.2', 'sn1.3']) {
      await api(`/api/lists/${list.id}/items`, { method: 'POST', cookie, body: { suttaId } });
    }

    await api(`/api/lists/${list.id}/items/order`, {
      method: 'PUT',
      cookie,
      body: { order: ['sn1.3', 'sn1.1', 'sn1.2'], mtime: '2030-01-02T00:00:00.000Z|a' },
    });
    const res = await api(`/api/lists/${list.id}/items/order`, {
      method: 'PUT',
      cookie,
      body: { order: ['sn1.2', 'sn1.1', 'sn1.3'], mtime: '2030-01-01T00:00:00.000Z|a' },
    });

    expect(res.status).toBe(200);
    expect(await itemsOf(list.id)).toEqual(['sn1.3', 'sn1.1', 'sn1.2']);
  });

  it('PUT /:id/items/order 404s for a nonexistent list and 400s for a group', async () => {
    const { cookie } = await signIn();
    const missing = await api('/api/lists/does-not-exist/items/order', { method: 'PUT', cookie, body: { order: [] } });
    expect(missing.status).toBe(404);

    const group = await createList(cookie, { label: 'Group', kind: 'group' });
    const onGroup = await api(`/api/lists/${group.id}/items/order`, { method: 'PUT', cookie, body: { order: [] } });
    expect(onGroup.status).toBe(400);
  });

  it('PUT /order bulk-reorders sibling lists', async () => {
    const { cookie } = await signIn();
    const a = await createList(cookie, { label: 'A' });
    const b = await createList(cookie, { label: 'B' });
    const c = await createList(cookie, { label: 'C' });

    const res = await api('/api/lists/order', {
      method: 'PUT',
      cookie,
      body: { parentId: null, order: [c.id, a.id, b.id] },
    });
    expect(res.status).toBe(200);

    const positions = await Promise.all([c, a, b].map(async (created) => (await listRow(created.id)).position));
    expect(positions).toEqual([0, 1, 2]);
  });

  // Sibling order moves as a unit on each row's own mtime — a stale offline reorder replayed
  // after a newer one must not win.
  it('does not let an older client mtime overwrite a sibling order set with a newer one', async () => {
    const { cookie } = await signIn();
    const a = await createList(cookie, { label: 'A' });
    const b = await createList(cookie, { label: 'B' });
    const c = await createList(cookie, { label: 'C' });

    await api('/api/lists/order', {
      method: 'PUT',
      cookie,
      body: { parentId: null, order: [c.id, a.id, b.id], mtime: '2030-01-02T00:00:00.000Z|a' },
    });
    const res = await api('/api/lists/order', {
      method: 'PUT',
      cookie,
      body: { parentId: null, order: [a.id, b.id, c.id], mtime: '2030-01-01T00:00:00.000Z|a' },
    });
    expect(res.status).toBe(200);

    const positions = await Promise.all([c, a, b].map(async (created) => (await listRow(created.id)).position));
    expect(positions).toEqual([0, 1, 2]);
  });

  it('PUT /order rejects reparenting into a cycle the same way PATCH does', async () => {
    const { cookie } = await signIn();
    const grandparent = await createList(cookie, { label: 'A', kind: 'group' });
    const parent = await createList(cookie, { label: 'B', kind: 'group', parentId: grandparent.id });

    const res = await api('/api/lists/order', {
      method: 'PUT',
      cookie,
      body: { parentId: parent.id, order: [grandparent.id] },
    });
    expect(res.status).toBe(400);
  });

  // The `AND user_id = ?` predicate on every statement is the only thing isolating one user's
  // lists from another's, which makes this a central correctness property rather than a nicety.
  it("never reads or writes another user's list", async () => {
    const owner = await signIn();
    const other = await signIn();
    const list = await createList(owner.cookie, { label: 'Private' });
    await api(`/api/lists/${list.id}/items`, { method: 'POST', cookie: owner.cookie, body: { suttaId: 'sn1.1' } });

    const visible = await api('/api/lists', { cookie: other.cookie });
    expect((await visible.json()).lists).toEqual([]);

    const patch = await api(`/api/lists/${list.id}`, { method: 'PATCH', cookie: other.cookie, body: { label: 'Mine now' } });
    expect(patch.status).toBe(404);

    const addItem = await api(`/api/lists/${list.id}/items`, {
      method: 'POST',
      cookie: other.cookie,
      body: { suttaId: 'sn1.2' },
    });
    expect(addItem.status).toBe(404);

    const removeItem = await api(`/api/lists/${list.id}/items/sn1.1`, { method: 'DELETE', cookie: other.cookie });
    expect(removeItem.status).toBe(404);

    const reorder = await api(`/api/lists/${list.id}/items/order`, {
      method: 'PUT',
      cookie: other.cookie,
      body: { order: [] },
    });
    expect(reorder.status).toBe(404);

    const del = await api(`/api/lists/${list.id}`, { method: 'DELETE', cookie: other.cookie });
    expect(del.status).toBe(404);

    // Untouched throughout — the owner's row still has its original label and items.
    const row = await listRow(list.id);
    expect(row.label).toBe('Private');
    expect(JSON.parse(row.items)).toEqual(['sn1.1']);
  });
});
