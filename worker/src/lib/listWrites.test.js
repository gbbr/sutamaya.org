import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import app from '../index.js';
import { createSessionCookie } from '../session.js';

// The list half of lib/writes.js, driven through the endpoint that dispatches to it
// (POST /api/data/push). Assertions read `lists` rows straight out of env.DB, and a signed-in
// caller is a real signed session cookie (see session.js). D1 rows need no explicit cleanup —
// vitest-pool-workers rolls back each test's storage writes (isolatedStorage, on by default).

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

const OK = { ok: true };

// A push answers per item rather than per request, so a single write is one item in and one result
// out: `{ok: true}`, or `{error, status}` for a refusal. Anything that fails the request as a whole
// is a bug in the test rather than an outcome under test, so it throws rather than being returned.
async function write(cookie, item) {
  const res = await api('/api/data/push', { method: 'POST', cookie, body: { items: [item] } });
  if (!res.ok) throw new Error(`push itself failed: ${res.status} ${await res.text()}`);
  return (await res.json()).results[0];
}

// Ids are minted by the client, so the test mints them too — and gets the list's identity back
// without having to read a response.
let nextId = 0;

async function createList(cookie, { label, kind = 'list', parentId = null, id, mtime } = {}) {
  const listId = id ?? `list-${(nextId += 1)}`;
  const result = await write(cookie, { type: 'list.create', id: listId, label, parentId, kind, mtime });
  return { id: listId, label, parentId, kind, result };
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

describe('lib/writes.js — lists (D1)', () => {
  it('requires authentication', async () => {
    const res = await api('/api/data/push', { method: 'POST', body: { items: [] } });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'not_authenticated' });
  });

  it('creates a top-level list under the id the client chose', async () => {
    const { userId, cookie } = await signIn();
    const list = await createList(cookie, { label: 'My favorites', id: 'client-chosen-id' });
    expect(list.result).toEqual(OK);
    expect(await siblingIds(userId, null)).toEqual(['client-chosen-id']);
    expect(await listRow('client-chosen-id')).toMatchObject({ label: 'My favorites', parent_id: null, kind: 'list', items: '[]' });
  });

  it('refuses a create with no label', async () => {
    const { cookie } = await signIn();
    expect(await write(cookie, { type: 'list.create', id: 'x', label: '  ', parentId: null, kind: 'list' })).toEqual({
      error: 'label_required',
      status: 400,
    });
  });

  // A create whose response was lost and got retried must be a no-op, not a duplicate row or an
  // error — that's what makes client-generated ids safe to retry.
  it('re-sending a create with the same client id is a no-op rather than a duplicate or an error', async () => {
    const { userId, cookie } = await signIn();
    expect((await createList(cookie, { label: 'First label', id: 'dupe-id' })).result).toEqual(OK);
    expect((await createList(cookie, { label: 'Second label', id: 'dupe-id' })).result).toEqual(OK);

    expect(await siblingIds(userId, null)).toEqual(['dupe-id']);
    expect((await listRow('dupe-id')).label).toBe('First label');
  });

  // The same skipped insert as above, but from a second account: `lists.id` is a global primary
  // key, so the conflict clause absorbs another user's row just as readily as a retry. Reporting
  // success here would hand the client an id it doesn't own and every later write against it would
  // be refused as not found.
  it('rejects a create whose client id is already held by another user', async () => {
    const owner = await signIn();
    expect((await createList(owner.cookie, { label: 'Theirs', id: 'shared-id' })).result).toEqual(OK);

    const other = await signIn();
    const result = await write(other.cookie, { type: 'list.create', id: 'shared-id', label: 'Mine', parentId: null, kind: 'list' });
    expect(result).toEqual({ error: 'id_collision', status: 409 });

    expect(await siblingIds(other.userId, null)).toEqual([]);
    expect((await listRow('shared-id')).user_id).toBe(owner.userId);
  });

  // A stored row sharing an auto-list's id would be returned alongside the synthesized one, and
  // the client resolves auto-lists by id.
  it.each(['auto-recent', 'auto-highlights', 'auto-notes'])('refuses to store a list under the reserved id %s', async (id) => {
    const { userId, cookie } = await signIn();
    expect((await createList(cookie, { label: 'Impostor', id })).result).toEqual({ error: 'reserved_id', status: 400 });
    expect(await siblingIds(userId, null)).toEqual([]);
  });

  it('rejects a list whose parent is another plain list (not a group)', async () => {
    const { cookie } = await signIn();
    const plain = await createList(cookie, { label: 'Plain' });
    const child = await createList(cookie, { label: 'Child', parentId: plain.id });
    expect(child.result.status).toBe(400);
  });

  it('nests a list under a group', async () => {
    const { cookie } = await signIn();
    const group = await createList(cookie, { label: 'Group', kind: 'group' });
    const child = await createList(cookie, { label: 'Child', parentId: group.id });
    expect(child.result).toEqual(OK);
    expect((await listRow(child.id)).parent_id).toBe(group.id);
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
  // UPDATE means no matching row. What's pinned here is the refusal contract.
  it('updating a nonexistent list is refused as not found', async () => {
    const { cookie } = await signIn();
    const result = await write(cookie, { type: 'list.update', id: 'does-not-exist', label: 'x', parentId: null });
    expect(result).toEqual({ error: 'not_found', status: 404 });
  });

  it('removing an item from a nonexistent list is refused as not found', async () => {
    const { cookie } = await signIn();
    expect(await write(cookie, { type: 'item.remove', listId: 'does-not-exist', suttaId: 'sn1.1' })).toEqual({
      error: 'not_found',
      status: 404,
    });
  });

  it('an update naming no recognized field is still refused for a bogus id', async () => {
    const { cookie } = await signIn();
    expect(await write(cookie, { type: 'list.update', id: 'does-not-exist' })).toEqual({ error: 'not_found', status: 404 });
  });

  // The WHERE mtime < ? guard is the entire conflict resolution for a rename/move: a stale
  // offline edit replayed after a newer one must not win. Both mtimes are set well past the
  // real clock so they're guaranteed newer than the row's own server-generated creation mtime.
  it('does not let an older client mtime overwrite a rename made with a newer one', async () => {
    const { cookie } = await signIn();
    const list = await createList(cookie, { label: 'Original' });
    await write(cookie, { type: 'list.update', id: list.id, label: 'Newer', parentId: null, mtime: '2030-01-02T00:00:00.000Z|a' });
    const result = await write(cookie, {
      type: 'list.update',
      id: list.id,
      label: 'Older',
      parentId: null,
      mtime: '2030-01-01T00:00:00.000Z|a',
    });

    // A rejected stale write is not an error — the loser of last-writer-wins is dropped silently.
    expect(result).toEqual(OK);
    expect((await listRow(list.id)).label).toBe('Newer');
  });

  it('does not let an equal client mtime overwrite a rename either', async () => {
    const { cookie } = await signIn();
    const list = await createList(cookie, { label: 'Original' });
    const mtime = '2030-01-01T00:00:00.000Z|a';
    await write(cookie, { type: 'list.update', id: list.id, label: 'First', parentId: null, mtime });
    await write(cookie, { type: 'list.update', id: list.id, label: 'Second', parentId: null, mtime });
    expect((await listRow(list.id)).label).toBe('First');
  });

  // Tombstoned, not removed: the row has to stay behind so a device that was offline when the
  // delete happened can't push its still-live copy back as an apparently-new list.
  it('deleting a list tombstones the row and hides it from GET /api/data', async () => {
    const { cookie } = await signIn();
    const list = await createList(cookie, { label: 'Doomed' });
    await write(cookie, { type: 'item.add', listId: list.id, suttaId: 'sn1.1' });

    expect(await write(cookie, { type: 'list.delete', id: list.id })).toEqual(OK);

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
    await write(cookie, { type: 'item.add', listId: leaf.id, suttaId: 'sn1.1' });
    const survivor = await createList(cookie, { label: 'Survivor' });

    expect(await write(cookie, { type: 'list.delete', id: group.id })).toEqual(OK);

    // Only the group itself was written to; the descendants keep their rows and their parents.
    expect((await listRow(group.id)).deleted).toBe(1);
    expect((await listRow(inner.id)).deleted).toBe(0);
    expect((await listRow(leaf.id)).parent_id).toBe(inner.id);

    const data = await (await api('/api/data', { cookie })).json();
    expect(data.lists.map((l) => l.id)).toEqual([survivor.id]);
    // ...and the buried list stops contributing membership chips.
    expect(data.membership['sn1.1']).toBeUndefined();
  });

  // A queued delete replayed after it already landed must not start being refused as not found —
  // that would look like a permanently-rejected record to a flushing client.
  it('re-deleting an already-tombstoned list is a no-op success, not a refusal', async () => {
    const { cookie } = await signIn();
    const list = await createList(cookie, { label: 'Doomed' });
    expect(await write(cookie, { type: 'list.delete', id: list.id })).toEqual(OK);
    expect(await write(cookie, { type: 'list.delete', id: list.id })).toEqual(OK);
    expect((await listRow(list.id)).deleted).toBe(1);
  });

  it('does not let a stale delete take out a list renamed more recently', async () => {
    const { cookie } = await signIn();
    const list = await createList(cookie, { label: 'Keep me' });
    await write(cookie, { type: 'list.update', id: list.id, label: 'Renamed', parentId: null, mtime: '2030-01-02T00:00:00.000Z|a' });
    const result = await write(cookie, { type: 'list.delete', id: list.id, mtime: '2030-01-01T00:00:00.000Z|a' });
    expect(result).toEqual(OK);
    expect((await listRow(list.id)).deleted).toBe(0);
  });

  it('deleting a nonexistent list is refused as not found', async () => {
    const { cookie } = await signIn();
    expect(await write(cookie, { type: 'list.delete', id: 'does-not-exist' })).toEqual({ error: 'not_found', status: 404 });
  });

  // Membership stays operation-based, so an add queued offline can arrive after the list's own
  // delete. It has to land on the dead row rather than be refused — dropping it is the silent loss
  // the whole offline-sync design exists to prevent.
  it('an add targeting a tombstoned list still lands on the dead row', async () => {
    const { cookie } = await signIn();
    const list = await createList(cookie, { label: 'Doomed' });
    await write(cookie, { type: 'list.delete', id: list.id });

    expect(await write(cookie, { type: 'item.add', listId: list.id, suttaId: 'sn1.1' })).toEqual(OK);
    expect(await itemsOf(list.id)).toEqual(['sn1.1']);

    // Still invisible, since the row is tombstoned.
    const data = await (await api('/api/data', { cookie })).json();
    expect(data.membership['sn1.1']).toBeUndefined();
  });

  // Nesting under a group deleted elsewhere is accepted rather than refused: the write lands
  // instead of being thrown away, and the cascade then hides it along with the rest of that group's
  // subtree — the user deleted the group, so nothing inside it should come back.
  it('accepts nesting a new list under a tombstoned group, then cascades it out on read', async () => {
    const { cookie } = await signIn();
    const group = await createList(cookie, { label: 'Group', kind: 'group' });
    await write(cookie, { type: 'list.delete', id: group.id });

    const child = await createList(cookie, { label: 'Child', parentId: group.id });
    expect(child.result).toEqual(OK);
    expect((await listRow(child.id)).parent_id).toBe(group.id);

    const data = await (await api('/api/data', { cookie })).json();
    expect(data.lists.find((l) => l.id === child.id)).toBeUndefined();
  });

  it('adds and removes a sutta from a list', async () => {
    const { cookie } = await signIn();
    const list = await createList(cookie, { label: 'L' });
    expect(await write(cookie, { type: 'item.add', listId: list.id, suttaId: 'sn1.1' })).toEqual(OK);
    expect(await itemsOf(list.id)).toEqual(['sn1.1']);

    expect(await write(cookie, { type: 'item.remove', listId: list.id, suttaId: 'sn1.1' })).toEqual(OK);
    expect(await itemsOf(list.id)).toEqual([]);
  });

  // FieldValue.arrayUnion was idempotent for free; ADD_ITEM_SQL's EXISTS guard is what reproduces
  // that, so it gets its own assertion.
  it('adding the same sutta twice does not duplicate it', async () => {
    const { cookie } = await signIn();
    const list = await createList(cookie, { label: 'L' });
    await write(cookie, { type: 'item.add', listId: list.id, suttaId: 'sn1.1' });
    await write(cookie, { type: 'item.add', listId: list.id, suttaId: 'sn1.1' });
    expect(await itemsOf(list.id)).toEqual(['sn1.1']);
  });

  it('rejects adding a sutta to a group', async () => {
    const { cookie } = await signIn();
    const group = await createList(cookie, { label: 'Group', kind: 'group' });
    expect(await write(cookie, { type: 'item.add', listId: group.id, suttaId: 'sn1.1' })).toEqual({
      error: 'group_cannot_hold_suttas',
      status: 400,
    });
  });

  it('rejects reparenting a list into its own descendant (cycle check)', async () => {
    const { cookie } = await signIn();
    const grandparent = await createList(cookie, { label: 'A', kind: 'group' });
    const parent = await createList(cookie, { label: 'B', kind: 'group', parentId: grandparent.id });

    const result = await write(cookie, { type: 'list.update', id: grandparent.id, label: 'A', parentId: parent.id });
    expect(result).toEqual({ error: 'parent_is_descendant', status: 400 });
  });

  it("item.order reorders a list's own items", async () => {
    const { cookie } = await signIn();
    const list = await createList(cookie, { label: 'L' });
    for (const suttaId of ['sn1.1', 'sn1.2', 'sn1.3']) {
      await write(cookie, { type: 'item.add', listId: list.id, suttaId });
    }

    expect(await write(cookie, { type: 'item.order', listId: list.id, order: ['sn1.3', 'sn1.1', 'sn1.2'] })).toEqual(OK);
    expect(await itemsOf(list.id)).toEqual(['sn1.3', 'sn1.1', 'sn1.2']);
  });

  it('item.order appends an item present in stored items but missing from the posted order', async () => {
    const { cookie } = await signIn();
    const list = await createList(cookie, { label: 'L' });
    await write(cookie, { type: 'item.add', listId: list.id, suttaId: 'sn1.1' });
    await write(cookie, { type: 'item.add', listId: list.id, suttaId: 'sn1.2' });

    // Simulates another tab adding sn1.2 after this client already snapshotted an order of just ['sn1.1'].
    expect(await write(cookie, { type: 'item.order', listId: list.id, order: ['sn1.1'] })).toEqual(OK);
    expect(await itemsOf(list.id)).toEqual(['sn1.1', 'sn1.2']);
  });

  // Item order moves as a unit on the list's own mtime — a stale offline reorder replayed after
  // a newer one must not win.
  it('does not let an older client mtime overwrite an item order set with a newer one', async () => {
    const { cookie } = await signIn();
    const list = await createList(cookie, { label: 'L' });
    for (const suttaId of ['sn1.1', 'sn1.2', 'sn1.3']) {
      await write(cookie, { type: 'item.add', listId: list.id, suttaId });
    }

    await write(cookie, {
      type: 'item.order',
      listId: list.id,
      order: ['sn1.3', 'sn1.1', 'sn1.2'],
      mtime: '2030-01-02T00:00:00.000Z|a',
    });
    const result = await write(cookie, {
      type: 'item.order',
      listId: list.id,
      order: ['sn1.2', 'sn1.1', 'sn1.3'],
      mtime: '2030-01-01T00:00:00.000Z|a',
    });

    expect(result).toEqual(OK);
    expect(await itemsOf(list.id)).toEqual(['sn1.3', 'sn1.1', 'sn1.2']);
  });

  it('item.order is refused as not found for a nonexistent list, and rejected for a group', async () => {
    const { cookie } = await signIn();
    expect(await write(cookie, { type: 'item.order', listId: 'does-not-exist', order: [] })).toEqual({
      error: 'not_found',
      status: 404,
    });

    const group = await createList(cookie, { label: 'Group', kind: 'group' });
    expect(await write(cookie, { type: 'item.order', listId: group.id, order: [] })).toEqual({
      error: 'group_cannot_hold_suttas',
      status: 400,
    });
  });

  it('sibling.order bulk-reorders sibling lists', async () => {
    const { cookie } = await signIn();
    const a = await createList(cookie, { label: 'A' });
    const b = await createList(cookie, { label: 'B' });
    const c = await createList(cookie, { label: 'C' });

    expect(await write(cookie, { type: 'sibling.order', parentId: null, order: [c.id, a.id, b.id] })).toEqual(OK);

    const positions = await Promise.all([c, a, b].map(async (created) => (await listRow(created.id)).position));
    expect(positions).toEqual([0, 1, 2]);
  });

  // This is the client's whole reorder path and it replays from an offline queue, so a posted order
  // taken before another device's changes must not undo them — the sibling counterpart of
  // item.order's own reconcile.
  it('sibling.order appends a sibling created after the posted order was snapshotted', async () => {
    const { cookie } = await signIn();
    const a = await createList(cookie, { label: 'A' });
    const b = await createList(cookie, { label: 'B' });
    // Simulates another device creating C after this client snapshotted an order of just [B, A].
    const c = await createList(cookie, { label: 'C' });

    expect(await write(cookie, { type: 'sibling.order', parentId: null, order: [b.id, a.id] })).toEqual(OK);

    // C keeps a position among its siblings rather than being left behind on a stale one shared
    // with a row the reorder renumbered.
    const positions = await Promise.all([b, a, c].map(async (created) => (await listRow(created.id)).position));
    expect(positions).toEqual([0, 1, 2]);
  });

  it('sibling.order ignores an id in the posted order that has since been deleted', async () => {
    const { cookie } = await signIn();
    const a = await createList(cookie, { label: 'A' });
    const b = await createList(cookie, { label: 'B' });
    await write(cookie, { type: 'list.delete', id: b.id });

    expect(await write(cookie, { type: 'sibling.order', parentId: null, order: [b.id, a.id] })).toEqual(OK);

    // A takes the only live position. Writing one back onto the tombstone would resurrect its place
    // in the tree if it were ever un-deleted.
    expect((await listRow(a.id)).position).toBe(0);
  });

  it('sibling.order is refused as not found, not rejected, for a parent this account has no row for', async () => {
    const { cookie } = await signIn();
    const a = await createList(cookie, { label: 'A' });

    const result = await write(cookie, { type: 'sibling.order', parentId: 'never-created', order: [a.id] });

    // The group was created and deleted offline before it ever reached the server, leaving no
    // tombstone. The client retires a not-found as moot; any other refusal would keep the queued op
    // being re-refused on every flush forever.
    expect(result).toEqual({ error: 'not_found', status: 404 });
  });

  // The one branch reorderSiblings answers off its own parent read rather than through
  // invalidReparentReason, so nothing else here would notice it going missing. Distinct from the
  // not-found case above: the row exists, so the gesture is invalid rather than moot.
  it('sibling.order rejects a parent that is a plain list rather than a group', async () => {
    const { cookie } = await signIn();
    const plain = await createList(cookie, { label: 'Not a group' });
    const a = await createList(cookie, { label: 'A' });

    const result = await write(cookie, { type: 'sibling.order', parentId: plain.id, order: [a.id] });

    expect(result).toEqual({ error: 'parent_not_a_group', status: 400 });
  });

  // Sibling order moves as a unit on each row's own mtime — a stale offline reorder replayed
  // after a newer one must not win.
  it('does not let an older client mtime overwrite a sibling order set with a newer one', async () => {
    const { cookie } = await signIn();
    const a = await createList(cookie, { label: 'A' });
    const b = await createList(cookie, { label: 'B' });
    const c = await createList(cookie, { label: 'C' });

    await write(cookie, { type: 'sibling.order', parentId: null, order: [c.id, a.id, b.id], mtime: '2030-01-02T00:00:00.000Z|a' });
    const result = await write(cookie, {
      type: 'sibling.order',
      parentId: null,
      order: [a.id, b.id, c.id],
      mtime: '2030-01-01T00:00:00.000Z|a',
    });
    expect(result).toEqual(OK);

    const positions = await Promise.all([c, a, b].map(async (created) => (await listRow(created.id)).position));
    expect(positions).toEqual([0, 1, 2]);
  });

  it('sibling.order rejects reparenting into a cycle the same way an update does', async () => {
    const { cookie } = await signIn();
    const grandparent = await createList(cookie, { label: 'A', kind: 'group' });
    const parent = await createList(cookie, { label: 'B', kind: 'group', parentId: grandparent.id });

    const result = await write(cookie, { type: 'sibling.order', parentId: parent.id, order: [grandparent.id] });
    expect(result).toEqual({ error: 'parent_is_descendant', status: 400 });
  });

  // The `AND user_id = ?` predicate on every statement is the only thing isolating one user's
  // lists from another's, which makes this a central correctness property rather than a nicety.
  it("never reads or writes another user's list", async () => {
    const owner = await signIn();
    const other = await signIn();
    const list = await createList(owner.cookie, { label: 'Private' });
    await write(owner.cookie, { type: 'item.add', listId: list.id, suttaId: 'sn1.1' });

    const visible = await api('/api/lists', { cookie: other.cookie });
    expect((await visible.json()).lists).toEqual([]);

    const notFound = { error: 'not_found', status: 404 };
    expect(await write(other.cookie, { type: 'list.update', id: list.id, label: 'Mine now', parentId: null })).toEqual(notFound);
    expect(await write(other.cookie, { type: 'item.add', listId: list.id, suttaId: 'sn1.2' })).toEqual(notFound);
    expect(await write(other.cookie, { type: 'item.remove', listId: list.id, suttaId: 'sn1.1' })).toEqual(notFound);
    expect(await write(other.cookie, { type: 'item.order', listId: list.id, order: [] })).toEqual(notFound);
    expect(await write(other.cookie, { type: 'list.delete', id: list.id })).toEqual(notFound);

    // Untouched throughout — the owner's row still has its original label and items.
    const row = await listRow(list.id);
    expect(row.label).toBe('Private');
    expect(JSON.parse(row.items)).toEqual(['sn1.1']);
  });
});
