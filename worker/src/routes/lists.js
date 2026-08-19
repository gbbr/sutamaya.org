import { Hono } from 'hono';
import { requireAuth } from '../auth.js';
import { jsonBody } from '../jsonBody.js';
import { invalidParentReasonForRow, wouldCreateCycle } from '../lib/listParent.js';
import { shapeList } from '../lib/listShape.js';
import { reconcileItemOrder } from '../lib/listItemOrder.js';
import { reconcileSiblingOrder } from '../lib/listSiblingOrder.js';
import { LIST_NAME_MAX_LENGTH } from '../lib/textLimits.js';
import { resolveMtime } from '../lib/mtime.js';
import { HIGHLIGHTS_AUTO_LIST_ID, NOTES_AUTO_LIST_ID, RECENT_AUTO_LIST_ID } from '../lib/userData.js';

export const listsRouter = new Hono();
listsRouter.use(requireAuth);

// assembleUserData synthesizes the three auto-lists into its response by these ids without
// consulting the `lists` table, so a stored row sharing one would be returned alongside its
// synthetic twin — same id, twice, the stored one first. The client resolves auto-lists with
// `lists.find(...)` and would render the impostor in the "Automatic" section.
const RESERVED_LIST_IDS = new Set([RECENT_AUTO_LIST_ID, HIGHLIGHTS_AUTO_LIST_ID, NOTES_AUTO_LIST_ID]);

// Every statement in this router is scoped `AND user_id = ?`: D1 is one flat table per entity,
// with no structural isolation between users — the predicate *is* the isolation. A missing scope
// would leak or overwrite another user's list, so it belongs on reads, writes and existence
// checks alike.

function parseItems(row) {
  return JSON.parse(row.items || '[]');
}

// Adapts a `lists` row (snake_case columns, `items` stored as a JSON string) into the camelCase
// field names shapeList — shared with lib/userData.js — and the client both expect.
function serializeList(row) {
  return shapeList(row.id, { label: row.label, parentId: row.parent_id, kind: row.kind, items: parseItems(row) });
}

function parentIdFromBody(body) {
  return typeof body?.parentId === 'string' ? body.parentId : null;
}

function orderFromBody(body) {
  return Array.isArray(body?.order) ? body.order : [];
}

// Fetches the candidate parent and checks it via invalidParentReasonForRow (see that function's
// own comment for the actual validity rule) — the top-level `null` case short-circuits before ever
// hitting D1. Used for creating a new list, which can never be its own ancestor, so no cycle check
// is needed here — see invalidReparentReason below for moving an *existing* list.
//
// Deliberately unfiltered on `deleted`: nesting under a group deleted elsewhere is accepted rather
// than rejected 400, because rejecting throws the user's move away, and lib/listTree.js re-homes the
// child to the root on read anyway. Only the kind check still rejects.
async function invalidParentReason(db, userId, parentId) {
  if (!parentId) return null;
  const row = await db.prepare('SELECT kind FROM lists WHERE id = ? AND user_id = ?').bind(parentId, userId).first();
  return invalidParentReasonForRow(row);
}

// Same parent-existence/kind check as invalidParentReason (delegated to it directly, so the two
// can't drift apart), plus a cycle check for each id in `movingIds` being reparented to `parentId`
// (see wouldCreateCycle's own comment) — used wherever an *existing* list's parentId is being
// changed, unlike a fresh create.
async function invalidReparentReason(db, userId, parentId, movingIds) {
  const kindError = await invalidParentReason(db, userId, parentId);
  if (kindError) return kindError;
  if (!parentId) return null;
  // Live rows only: a tombstoned list is no longer part of the tree, so counting it here could
  // manufacture a cycle out of a chain that no read path ever renders. The cycles that survive
  // this check — two devices each making a locally-valid move — are broken at read time by
  // lib/listTree.js instead, which is the only place both devices can agree on the outcome.
  const { results } = await db.prepare('SELECT id, parent_id FROM lists WHERE user_id = ? AND deleted = 0').bind(userId).all();
  const allLists = results.map((row) => ({ id: row.id, parentId: row.parent_id ?? null }));
  for (const movingId of movingIds) {
    if (wouldCreateCycle(movingId, parentId, allLists)) return 'Cannot move a list into its own descendant.';
  }
  return null;
}

// The existence+kind check the two "add/reorder this list's items" routes below both need, as one
// query. Returns `{row}` for a plain list that can hold suttas, or `{error, status}` for the two
// rejections — 404 for a list that doesn't exist (for this user), 400 for a group. Reported as
// data rather than written as a response, since a Hono handler owns its own return value.
//
// Deliberately unfiltered on `deleted`, and load-bearingly so: membership travels as operations
// rather than as record state (see docs/offline-sync.md), so an add queued offline can arrive
// after the list's own delete. Treating the tombstone as not-found would 404 and discard the add —
// the exact silent loss this all exists to prevent. It lands on the dead row instead, invisible to
// every read path, and returns with the list if that is ever un-deleted.
async function suttaListRow(db, userId, id) {
  const row = await db.prepare('SELECT items, kind FROM lists WHERE id = ? AND user_id = ?').bind(id, userId).first();
  if (!row) return { error: 'not_found', status: 404 };
  if (row.kind === 'group') return { error: 'A group cannot hold suttas.', status: 400 };
  return { row };
}

// A flat list of this user's live lists. The client reads its tree from GET /api/data instead
// (which additionally applies lib/listTree.js's repair), so this stays a plain filtered read.
listsRouter.get('/', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM lists WHERE user_id = ? AND deleted = 0 ORDER BY position')
    .bind(c.get('userId'))
    .all();
  return c.json({ lists: results.map(serializeList) });
});

// Reads the current min position among true siblings and writes the new row in one statement
// (rather than a SELECT then an INSERT) so two near-simultaneous creates can't both compute the
// same `min - 1` and land on colliding positions. A new list/group is meant to appear at the front
// of its parent's children (per product decision), not the back, so the position expression is
// lib/listPositions.js's `firstPosition` in SQL: COALESCE turns an empty sibling set into 1, then
// the two-argument scalar `MIN(x, 1) - 1` reproduces its `Math.min(min, p) - 1` reduce seeded at 1
// — which is why an empty parent yields 0 rather than -1. The aggregate MIN and the scalar MIN sit
// at separate query levels precisely so that parse is unambiguous.
//
// ON CONFLICT(id) DO NOTHING is what makes a client-chosen id idempotent: a create whose response
// was lost and got retried lands on the same id and becomes a no-op instead of a duplicate row or
// a constraint error.
const CREATE_LIST_SQL = `
  INSERT INTO lists (id, user_id, label, parent_id, kind, position, items, created_at, mtime)
  SELECT ?1, ?2, ?3, ?4, ?5,
         (SELECT MIN(x, 1) - 1 FROM (
            SELECT COALESCE(MIN(position), 1) AS x
              FROM lists WHERE user_id = ?2 AND parent_id IS ?4)),
         '[]', ?6, ?7
  ON CONFLICT(id) DO NOTHING
`;

listsRouter.post('/', async (c) => {
  const userId = c.get('userId');
  const body = await jsonBody(c);
  const label = ((body && body.label) || '').trim().slice(0, LIST_NAME_MAX_LENGTH);
  if (!label) return c.json({ error: 'List name is required.' }, 400);
  const kind = body?.kind === 'group' ? 'group' : 'list';
  const parentId = parentIdFromBody(body);
  const parentError = await invalidParentReason(c.env.DB, userId, parentId);
  if (parentError) return c.json({ error: parentError }, 400);
  // A client-chosen id is what lets an offline create be referenced (renamed, filed into, moved)
  // before it has ever reached the server; falling back to a server-minted one keeps a client that
  // doesn't send one working unchanged.
  const id = typeof body?.id === 'string' && body.id ? body.id : crypto.randomUUID();
  if (RESERVED_LIST_IDS.has(id)) return c.json({ error: 'That list id is reserved.' }, 400);
  const mtime = resolveMtime(body?.mtime);
  const created = await c.env.DB.prepare(CREATE_LIST_SQL)
    .bind(id, userId, label, parentId, kind, new Date().toISOString(), mtime)
    .run();
  // `lists.id` is a global PRIMARY KEY, so ON CONFLICT(id) fires on *any* user's row with this id,
  // not just this user's. A skipped insert is therefore two different situations: the retry the
  // conflict clause exists to absorb, or another account having claimed the id first. Only a
  // user-scoped read tells them apart, and getting it wrong would hand the client a 201 for a row
  // that does not exist under it — every later write against that id then 404s.
  if (created.meta?.changes === 0) {
    const mine = await c.env.DB.prepare('SELECT id FROM lists WHERE id = ? AND user_id = ?').bind(id, userId).first();
    if (!mine) return c.json({ error: 'id_collision' }, 409);
  }
  return c.json({ list: { id, label, parentId, kind, items: [] } }, 201);
});

listsRouter.patch('/:id', async (c) => {
  const db = c.env.DB;
  const userId = c.get('userId');
  const id = c.req.param('id');
  const body = await jsonBody(c);
  const assignments = [];
  const values = [];
  if (typeof body?.label === 'string' && body.label.trim()) {
    assignments.push('label = ?');
    values.push(body.label.trim().slice(0, LIST_NAME_MAX_LENGTH));
  }
  if (Number.isInteger(body?.position)) {
    assignments.push('position = ?');
    values.push(body.position);
  }
  // `parentId` is a legitimate value to explicitly set to null (move to top level), so check for
  // the key's presence rather than truthiness.
  if (body && 'parentId' in body) {
    const parentId = parentIdFromBody(body);
    const parentError = await invalidReparentReason(db, userId, parentId, [id]);
    if (parentError) return c.json({ error: parentError }, 400);
    assignments.push('parent_id = ?');
    values.push(parentId);
  }
  if (assignments.length) {
    // Conditional on mtime, same as the annotation writes: a stale offline rename/move can't
    // clobber a fresher edit made elsewhere. That also means `meta.changes === 0` is no longer
    // purely "no such list" — it's also what a rejected stale write looks like — so a miss falls
    // back to an existence check before deciding it's a 404. A rejected stale write is not an
    // error: the loser of last-writer-wins is silently dropped, not surfaced.
    const mtime = resolveMtime(body?.mtime);
    assignments.push('mtime = ?');
    values.push(mtime);
    const result = await db
      .prepare(`UPDATE lists SET ${assignments.join(', ')} WHERE id = ? AND user_id = ? AND mtime < ?`)
      .bind(...values, id, userId, mtime)
      .run();
    if (result.meta.changes === 0) {
      const exists = await db.prepare('SELECT id FROM lists WHERE id = ? AND user_id = ?').bind(id, userId).first();
      if (!exists) return c.json({ error: 'not_found' }, 404);
    }
  } else {
    // Nothing to write — fall back to a plain existence check so a PATCH with no recognized
    // fields still 404s for a bogus id instead of silently succeeding.
    const row = await db.prepare('SELECT id FROM lists WHERE id = ? AND user_id = ?').bind(id, userId).first();
    if (!row) return c.json({ error: 'not_found' }, 404);
  }
  return c.json({ ok: true });
});

// Bulk-reorders one parent's direct children (parentId: null for top-level lists) — mirrors
// PUT /:id/items/order below, just for the lists themselves instead of one list's sutta items.
// `order` positions are only meaningful relative to siblings sharing the same parent (see
// buildUserData in routes/data.js, which the client filters by parentId), so this never needs to
// touch — or even know about — any other parent's lists. Registered ahead of the parameterized
// routes below: Hono matches in registration order, so static segments come first as a matter of
// habit, even though nothing in this router actually collides.
//
// This is the client's whole reorder path, and it is one request per gesture by design: expressing
// a drag as a PATCH per sibling instead meant dragging the 50th list of a group to the top fired 50
// of them, which exhausts the Worker's per-minute rate limit in a couple of gestures and takes
// GET /api/auth/me down with it. Like every other write here it has to survive being replayed from
// an offline queue, which is what reconcileSiblingOrder is for.
listsRouter.put('/order', async (c) => {
  const db = c.env.DB;
  const userId = c.get('userId');
  const body = await jsonBody(c);
  const parentId = parentIdFromBody(body);
  const posted = orderFromBody(body);
  const parentError = await invalidReparentReason(db, userId, parentId, posted);
  if (parentError) return c.json({ error: parentError }, 400);
  // Live rows only: a tombstoned list is out of the tree, and a stale posted order naming one must
  // not write a position back onto it. Fetched together so one round trip answers both "does this
  // id still exist" and "what else lives in this parent that the client never saw".
  const { results } = await db
    .prepare('SELECT id, parent_id FROM lists WHERE user_id = ? AND deleted = 0')
    .bind(userId)
    .all();
  const liveIds = new Set(results.map((row) => row.id));
  const currentChildIds = results.filter((row) => (row.parent_id ?? null) === parentId).map((row) => row.id);
  const order = reconcileSiblingOrder(posted, currentChildIds, liveIds);
  if (order.length) {
    // One reorder gesture, one mtime, applied to every sibling it touches — each row still
    // guarded on its own stored mtime, so a list edited more recently elsewhere (e.g. renamed
    // from another device) keeps that edit instead of being dragged back by a stale reorder.
    const mtime = resolveMtime(body?.mtime);
    await db.batch(
      order.map((id, position) =>
        db
          .prepare('UPDATE lists SET position = ?, parent_id = ?, mtime = ? WHERE id = ? AND user_id = ? AND mtime < ?')
          .bind(position, parentId, mtime, id, userId, mtime)
      )
    );
  }
  return c.json({ ok: true });
});

// Tombstones the list instead of removing it, so a device that was offline when the delete
// happened can't resurrect it on reconnect by pushing its still-live copy — against a hard-deleted
// row that push is indistinguishable from a fresh creation.
//
// A deleted group's children are left pointing at the dead row rather than re-parented here: the
// read-time repair in lib/listTree.js cascades them out, which is the only outcome two devices can
// agree on without talking to each other. It also keeps this handler to a single statement — a
// subtree walk here would need a read-then-write that D1 can't make atomic, having no interactive
// transactions.
//
// Conditional on mtime like every other write, so a stale offline delete can't take out a list
// renamed or refilled more recently elsewhere. `meta.changes === 0` therefore covers both "no such
// list" and "a newer write already won", so a miss falls back to an existence check for the 404 —
// and re-deleting an already-tombstoned list is a no-op success, which is what makes a replayed
// delete safe.
listsRouter.delete('/:id', async (c) => {
  const db = c.env.DB;
  const userId = c.get('userId');
  const id = c.req.param('id');
  const mtime = resolveMtime((await jsonBody(c))?.mtime);
  const result = await db
    .prepare('UPDATE lists SET deleted = 1, mtime = ? WHERE id = ? AND user_id = ? AND mtime < ?')
    .bind(mtime, id, userId, mtime)
    .run();
  if (result.meta.changes === 0) {
    const exists = await db.prepare('SELECT id FROM lists WHERE id = ? AND user_id = ?').bind(id, userId).first();
    if (!exists) return c.json({ error: 'not_found' }, 404);
  }
  return c.json({ ok: true });
});

// json_insert with the '$[#]' append path is a no-op-safe replacement for FieldValue.arrayUnion:
// one atomic statement, no read-modify-write, and the EXISTS guard keeps a re-add from duplicating
// an id that's already in the list.
const ADD_ITEM_SQL = `
  UPDATE lists SET items = CASE
      WHEN EXISTS (SELECT 1 FROM json_each(items) WHERE value = ?3) THEN items
      ELSE json_insert(items, '$[#]', ?3)
    END
  WHERE id = ?1 AND user_id = ?2
`;

listsRouter.post('/:id/items', async (c) => {
  const db = c.env.DB;
  const userId = c.get('userId');
  const id = c.req.param('id');
  const body = await jsonBody(c);
  const suttaId = body && body.suttaId;
  if (!suttaId) return c.json({ error: 'suttaId is required.' }, 400);
  const found = await suttaListRow(db, userId, id);
  if (found.error) return c.json({ error: found.error }, found.status);
  await db.prepare(ADD_ITEM_SQL).bind(id, userId, suttaId).run();
  return c.json({ ok: true }, 201);
});

// FieldValue.arrayRemove's equivalent: rebuild `items` from json_each minus the removed value.
// COALESCE covers the empty result json_group_array yields nothing for.
const REMOVE_ITEM_SQL = `
  UPDATE lists SET items = COALESCE(
      (SELECT json_group_array(j.value) FROM json_each(lists.items) AS j WHERE j.value <> ?3),
      '[]')
  WHERE id = ?1 AND user_id = ?2
`;

listsRouter.delete('/:id/items/:suttaId', async (c) => {
  // No kind check here: removing an item from a group is harmless (it has none) and only the
  // list's existence matters, which `meta.changes` already reports.
  const result = await c.env.DB.prepare(REMOVE_ITEM_SQL)
    .bind(c.req.param('id'), c.get('userId'), c.req.param('suttaId'))
    .run();
  if (result.meta.changes === 0) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true });
});

listsRouter.put('/:id/items/order', async (c) => {
  const db = c.env.DB;
  const userId = c.get('userId');
  const id = c.req.param('id');
  const found = await suttaListRow(db, userId, id);
  if (found.error) return c.json({ error: found.error }, found.status);
  const body = await jsonBody(c);
  const reconciled = reconcileItemOrder(parseItems(found.row), orderFromBody(body));
  // Item order moves as a unit on the list's own mtime, same as sibling order — a stale offline
  // reorder can't overwrite a fresher one made elsewhere.
  const mtime = resolveMtime(body?.mtime);
  await db
    .prepare('UPDATE lists SET items = ?, mtime = ? WHERE id = ? AND user_id = ? AND mtime < ?')
    .bind(JSON.stringify(reconciled), mtime, id, userId, mtime)
    .run();
  return c.json({ ok: true });
});
