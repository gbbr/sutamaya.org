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

  it('deleting a list re-parents its children to its own parent, not orphaned', async () => {
    const { cookie } = await signIn();
    const group = await createList(cookie, { label: 'Group', kind: 'group' });
    const child = await createList(cookie, { label: 'Child', parentId: group.id });

    const del = await api(`/api/lists/${group.id}`, { method: 'DELETE', cookie });
    expect(del.status).toBe(200);

    expect((await listRow(child.id)).parent_id).toBeNull();
  });

  it('deleting a nonexistent list 404s', async () => {
    const { cookie } = await signIn();
    const res = await api('/api/lists/does-not-exist', { method: 'DELETE', cookie });
    expect(res.status).toBe(404);
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
