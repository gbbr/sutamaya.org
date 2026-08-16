import { Hono } from 'hono';
import { requireAuth } from '../auth.js';
import { jsonBody } from '../jsonBody.js';
import { nextPosition } from '../lib/listPositions.js';
import { invalidParentReasonForRow, wouldCreateCycle } from '../lib/listParent.js';
import { shapeList } from '../lib/listShape.js';
import { reconcileItemOrder } from '../lib/listItemOrder.js';
import { LIST_NAME_MAX_LENGTH } from '../lib/textLimits.js';

export const listsRouter = new Hono();
listsRouter.use(requireAuth);

// Every statement in this router is scoped `AND user_id = ?`: D1 is one flat table per entity, so
// unlike Firestore's `users/{uid}/lists` subcollection there is no structural isolation between
// users — the predicate *is* the isolation. A missing scope would leak or overwrite another user's
// list, so it belongs on reads, writes and existence checks alike.

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
  const { results } = await db.prepare('SELECT id, parent_id FROM lists WHERE user_id = ?').bind(userId).all();
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
async function suttaListRow(db, userId, id) {
  const row = await db.prepare('SELECT items, kind FROM lists WHERE id = ? AND user_id = ?').bind(id, userId).first();
  if (!row) return { error: 'not_found', status: 404 };
  if (row.kind === 'group') return { error: 'A group cannot hold suttas.', status: 400 };
  return { row };
}

listsRouter.get('/', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM lists WHERE user_id = ? ORDER BY position')
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
const CREATE_LIST_SQL = `
  INSERT INTO lists (id, user_id, label, parent_id, kind, position, items, created_at)
  SELECT ?1, ?2, ?3, ?4, ?5,
         (SELECT MIN(x, 1) - 1 FROM (
            SELECT COALESCE(MIN(position), 1) AS x
              FROM lists WHERE user_id = ?2 AND parent_id IS ?4)),
         '[]', ?6
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
  const id = crypto.randomUUID();
  await c.env.DB.prepare(CREATE_LIST_SQL).bind(id, userId, label, parentId, kind, new Date().toISOString()).run();
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
    // `meta.changes` counts the rows the UPDATE matched, not the ones whose values actually
    // differed, so 0 is exactly "no such list for this user" — which folds the existence check
    // into the write instead of a separate SELECT beforehand.
    const result = await db
      .prepare(`UPDATE lists SET ${assignments.join(', ')} WHERE id = ? AND user_id = ?`)
      .bind(...values, id, userId)
      .run();
    if (result.meta.changes === 0) return c.json({ error: 'not_found' }, 404);
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
listsRouter.put('/order', async (c) => {
  const db = c.env.DB;
  const userId = c.get('userId');
  const body = await jsonBody(c);
  const parentId = parentIdFromBody(body);
  const order = orderFromBody(body);
  const parentError = await invalidReparentReason(db, userId, parentId, order);
  if (parentError) return c.json({ error: parentError }, 400);
  if (order.length) {
    await db.batch(
      order.map((id, position) =>
        db
          .prepare('UPDATE lists SET position = ?, parent_id = ? WHERE id = ? AND user_id = ?')
          .bind(position, parentId, id, userId)
      )
    );
  }
  return c.json({ ok: true });
});

listsRouter.delete('/:id', async (c) => {
  const db = c.env.DB;
  const userId = c.get('userId');
  const id = c.req.param('id');
  const list = await db.prepare('SELECT parent_id FROM lists WHERE id = ? AND user_id = ?').bind(id, userId).first();
  if (!list) return c.json({ error: 'not_found' }, 404);
  // Re-parent any sub-lists to this list's own parent (bubble them up a level) instead of
  // orphaning them (dangling parentId pointing at a deleted row) or cascade-deleting them, which
  // would silently destroy list membership data the user didn't ask to remove.
  const parentId = list.parent_id ?? null;
  const [children, newSiblings] = await Promise.all([
    db.prepare('SELECT id FROM lists WHERE user_id = ? AND parent_id IS ?').bind(userId, id).all(),
    db.prepare('SELECT position FROM lists WHERE user_id = ? AND parent_id IS ?').bind(userId, parentId).all(),
  ]);
  // Re-parented children keep arriving at their own old positions otherwise, which can collide
  // with the new parent's existing children (both starting at 0) and leave their relative order
  // undefined — append them after the new parent's current siblings instead.
  let position = nextPosition(newSiblings.results.map((row) => row.position));
  const statements = children.results.map((child) =>
    db
      .prepare('UPDATE lists SET parent_id = ?, position = ? WHERE id = ? AND user_id = ?')
      .bind(parentId, position++, child.id, userId)
  );
  statements.push(db.prepare('DELETE FROM lists WHERE id = ? AND user_id = ?').bind(id, userId));
  // Narrower than the Firestore transaction this replaces: D1 has no interactive transactions, so
  // the batch below is atomic but the reads above are not part of it. A create or reorder landing
  // under `parentId` in that window can collide with the positions computed here. Acceptable
  // because both requests would have to come from the same signed-in user within milliseconds,
  // and the worst outcome is two re-parented siblings sharing a position — but it is a real
  // narrowing, not a free translation.
  await db.batch(statements);
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
  // No kind check here, matching the Express original: removing an item from a group is harmless
  // (it has none) and only the list's existence matters, which `meta.changes` already reports.
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
  const order = orderFromBody(await jsonBody(c));
  const reconciled = reconcileItemOrder(parseItems(found.row), order);
  await db
    .prepare('UPDATE lists SET items = ? WHERE id = ? AND user_id = ?')
    .bind(JSON.stringify(reconciled), id, userId)
    .run();
  return c.json({ ok: true });
});
