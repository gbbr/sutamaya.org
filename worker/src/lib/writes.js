import { invalidParentReasonForRow, wouldCreateCycle } from './listParent.js';
import { reconcileItemOrder } from './listItemOrder.js';
import { reconcileSiblingOrder } from './listSiblingOrder.js';
import { LIST_NAME_MAX_LENGTH, NOTE_MAX_LENGTH } from './textLimits.js';
import { resolveMtime } from './mtime.js';
import { HIGHLIGHTS_AUTO_LIST_ID, NOTES_AUTO_LIST_ID, RECENT_AUTO_LIST_ID } from './userData.js';

// Every write the app can make, as one function per kind behind `applyWrite`. `POST /api/data/push`
// (routes/data.js) is the only caller and the only write endpoint — see docs/offline-sync.md.
//
// Each handler answers with data rather than a response: `{ok: true}`, or `{error, status}` for a
// refusal, since a push is not atomic and each item's outcome is reported on its own.
//
// Every statement is scoped `AND user_id = ?` — reads, writes and existence checks alike.

const OK = { ok: true };

// The auto-list ids, which a stored list may not claim.
const RESERVED_LIST_IDS = new Set([RECENT_AUTO_LIST_ID, HIGHLIGHTS_AUTO_LIST_ID, NOTES_AUTO_LIST_ID]);

function parentIdOf(item) {
  return typeof item?.parentId === 'string' ? item.parentId : null;
}

function orderOf(item) {
  return Array.isArray(item?.order) ? item.order : [];
}

// Returns why `parentId` can't hold a list, or null if it can. Unfiltered on `deleted`: a parent
// tombstoned elsewhere is accepted, and lib/listTree.js re-homes the child on read.
async function invalidParentReason(db, userId, parentId) {
  if (!parentId) return null;
  const row = await db.prepare('SELECT kind FROM lists WHERE id = ? AND user_id = ?').bind(parentId, userId).first();
  return invalidParentReasonForRow(row);
}

// Returns why `movingId` can't be moved under `parentId`, or null if it can: invalidParentReason's
// check plus a cycle check.
async function invalidReparentReason(db, userId, parentId, movingId) {
  const kindError = await invalidParentReason(db, userId, parentId);
  if (kindError) return kindError;
  if (!parentId) return null;
  // Live rows only; a cycle through a tombstone is one no read path renders.
  const { results } = await db.prepare('SELECT id, parent_id FROM lists WHERE user_id = ? AND deleted = 0').bind(userId).all();
  const allLists = results.map((row) => ({ id: row.id, parentId: row.parent_id ?? null }));
  return wouldCreateCycle(movingId, parentId, allLists) ? 'parent_is_descendant' : null;
}

// Returns `{row}` with a list's `items` and `kind` if it can hold suttas, else `{error, status}` —
// 404 for no such list under this user, 400 for a group. Unfiltered on `deleted`, so a membership
// operation queued before the list's delete still lands, harmlessly, on the tombstoned row.
async function suttaListRow(db, userId, id) {
  const row = await db.prepare('SELECT items, kind FROM lists WHERE id = ? AND user_id = ?').bind(id, userId).first();
  if (!row) return { error: 'not_found', status: 404 };
  if (row.kind === 'group') return { error: 'group_cannot_hold_suttas', status: 400 };
  return { row };
}

// Inserts a list at the front of its parent's children, in one statement. The position expression
// is lib/listPositions.js's `firstPosition` in SQL — the aggregate MIN and the scalar MIN sit at
// separate query levels so the two-argument form parses unambiguously. ON CONFLICT(id) DO NOTHING
// makes a retried create a no-op.
const CREATE_LIST_SQL = `
  INSERT INTO lists (id, user_id, label, parent_id, kind, position, items, created_at, mtime)
  SELECT ?1, ?2, ?3, ?4, ?5,
         (SELECT MIN(x, 1) - 1 FROM (
            SELECT COALESCE(MIN(position), 1) AS x
              FROM lists WHERE user_id = ?2 AND parent_id IS ?4)),
         '[]', ?6, ?7
  ON CONFLICT(id) DO NOTHING
`;

// Creates a list or group under the client-chosen id `item.id`.
async function createList(db, userId, item) {
  const label = (item?.label || '').trim().slice(0, LIST_NAME_MAX_LENGTH);
  if (!label) return { error: 'label_required', status: 400 };
  const id = typeof item?.id === 'string' && item.id ? item.id : null;
  if (!id) return { error: 'id_required', status: 400 };
  if (RESERVED_LIST_IDS.has(id)) return { error: 'reserved_id', status: 400 };
  const kind = item?.kind === 'group' ? 'group' : 'list';
  const parentId = parentIdOf(item);
  const parentError = await invalidParentReason(db, userId, parentId);
  if (parentError) return { error: parentError, status: 400 };
  const created = await db
    .prepare(CREATE_LIST_SQL)
    .bind(id, userId, label, parentId, kind, new Date().toISOString(), resolveMtime(item?.mtime))
    .run();
  // `lists.id` is a global primary key, so a skipped insert is either this user's own retry or
  // another account holding the id; only a user-scoped read tells them apart.
  if (created.meta?.changes === 0) {
    const mine = await db.prepare('SELECT id FROM lists WHERE id = ? AND user_id = ?').bind(id, userId).first();
    if (!mine) return { error: 'id_collision', status: 409 };
  }
  return OK;
}

// Updates a list's label and parent. Position is not part of it — sibling order is its own
// operation.
async function updateList(db, userId, item) {
  const id = item?.id;
  const assignments = [];
  const values = [];
  if (typeof item?.label === 'string' && item.label.trim()) {
    assignments.push('label = ?');
    values.push(item.label.trim().slice(0, LIST_NAME_MAX_LENGTH));
  }
  // Key presence, not truthiness: null is a move to the top level.
  if (item && 'parentId' in item) {
    const parentId = parentIdOf(item);
    const parentError = await invalidReparentReason(db, userId, parentId, id);
    if (parentError) return { error: parentError, status: 400 };
    assignments.push('parent_id = ?');
    values.push(parentId);
  }
  if (!assignments.length) {
    // Nothing to write, so an existence check decides between success and 404.
    const row = await db.prepare('SELECT id FROM lists WHERE id = ? AND user_id = ?').bind(id, userId).first();
    return row ? OK : { error: 'not_found', status: 404 };
  }
  // Conditional on mtime, so `meta.changes === 0` covers both no such list and a stale write the
  // row won; only the first is a 404.
  const mtime = resolveMtime(item?.mtime);
  assignments.push('mtime = ?');
  values.push(mtime);
  const result = await db
    .prepare(`UPDATE lists SET ${assignments.join(', ')} WHERE id = ? AND user_id = ? AND mtime < ?`)
    .bind(...values, id, userId, mtime)
    .run();
  if (result.meta.changes === 0) {
    const exists = await db.prepare('SELECT id FROM lists WHERE id = ? AND user_id = ?').bind(id, userId).first();
    if (!exists) return { error: 'not_found', status: 404 };
  }
  return OK;
}

// Tombstones a list, conditional on mtime. A deleted group's children keep pointing at the dead
// row; lib/listTree.js cascades them out at read time.
async function deleteList(db, userId, item) {
  const id = item?.id;
  const mtime = resolveMtime(item?.mtime);
  const result = await db
    .prepare('UPDATE lists SET deleted = 1, mtime = ? WHERE id = ? AND user_id = ? AND mtime < ?')
    .bind(mtime, id, userId, mtime)
    .run();
  if (result.meta.changes === 0) {
    const exists = await db.prepare('SELECT id FROM lists WHERE id = ? AND user_id = ?').bind(id, userId).first();
    if (!exists) return { error: 'not_found', status: 404 };
  }
  return OK;
}

// Reorders one parent's direct children in a single operation — `parentId` null for the top level.
// Positions are only meaningful among siblings, so no other parent's lists are touched.
async function reorderSiblings(db, userId, item) {
  const parentId = parentIdOf(item);
  const posted = orderOf(item);
  // The parent row, read once and asked both questions, rather than through
  // invalidReparentReason's wrappers, which would read it and the live-list set twice. A parent
  // with no row at all is 404 rather than 400, so lib/sync.ts retires the queued op instead of
  // re-refusing it on every flush.
  if (parentId) {
    const parent = await db.prepare('SELECT kind FROM lists WHERE id = ? AND user_id = ?').bind(parentId, userId).first();
    if (!parent) return { error: 'not_found', status: 404 };
    const kindError = invalidParentReasonForRow(parent);
    if (kindError) return { error: kindError, status: 400 };
  }
  // The live tree, read once for the id set, this parent's current children and the cycle walk.
  const { results } = await db.prepare('SELECT id, parent_id FROM lists WHERE user_id = ? AND deleted = 0').bind(userId).all();
  // Ids the posted order would move into a cycle are dropped from it, the whole gesture standing —
  // the same treatment reconcileSiblingOrder gives a since-deleted id.
  const allLists = results.map((row) => ({ id: row.id, parentId: row.parent_id ?? null }));
  const acyclic = posted.filter((movingId) => !wouldCreateCycle(movingId, parentId, allLists));
  const liveIds = new Set(results.map((row) => row.id));
  const currentChildIds = results.filter((row) => (row.parent_id ?? null) === parentId).map((row) => row.id);
  const order = reconcileSiblingOrder(acyclic, currentChildIds, liveIds);
  if (order.length) {
    // One gesture, one mtime, every row still guarded on its own stored one.
    const mtime = resolveMtime(item?.mtime);
    await db.batch(
      order.map((id, position) =>
        db
          .prepare('UPDATE lists SET position = ?, parent_id = ?, mtime = ? WHERE id = ? AND user_id = ? AND mtime < ?')
          .bind(position, parentId, mtime, id, userId, mtime)
      )
    );
  }
  return OK;
}

// Appends one sutta id to `items`, in one statement, the EXISTS guard making a re-add a no-op.
const ADD_ITEM_SQL = `
  UPDATE lists SET items = CASE
      WHEN EXISTS (SELECT 1 FROM json_each(items) WHERE value = ?3) THEN items
      ELSE json_insert(items, '$[#]', ?3)
    END
  WHERE id = ?1 AND user_id = ?2
`;

async function addItem(db, userId, item) {
  const suttaId = item?.suttaId;
  if (!suttaId) return { error: 'sutta_id_required', status: 400 };
  const found = await suttaListRow(db, userId, item?.listId);
  if (found.error) return found;
  await db.prepare(ADD_ITEM_SQL).bind(item.listId, userId, suttaId).run();
  return OK;
}

// Removes one sutta id, rebuilding `items` without it. COALESCE covers the empty result.
const REMOVE_ITEM_SQL = `
  UPDATE lists SET items = COALESCE(
      (SELECT json_group_array(j.value) FROM json_each(lists.items) AS j WHERE j.value <> ?3),
      '[]')
  WHERE id = ?1 AND user_id = ?2
`;

async function removeItem(db, userId, item) {
  // No kind check: a group holds no items, so only the row's existence matters.
  const result = await db.prepare(REMOVE_ITEM_SQL).bind(item?.listId, userId, item?.suttaId).run();
  if (result.meta.changes === 0) return { error: 'not_found', status: 404 };
  return OK;
}

// Reorders one list's suttas.
async function reorderItems(db, userId, item) {
  const found = await suttaListRow(db, userId, item?.listId);
  if (found.error) return found;
  const current = JSON.parse(found.row.items || '[]');
  const reconciled = reconcileItemOrder(current, orderOf(item));
  // Item order moves as a unit on the list's own mtime, same as sibling order.
  const mtime = resolveMtime(item?.mtime);
  await db
    .prepare('UPDATE lists SET items = ?, mtime = ? WHERE id = ? AND user_id = ? AND mtime < ?')
    .bind(JSON.stringify(reconciled), mtime, item.listId, userId, mtime)
    .run();
  return OK;
}

// Writes a note, conditional on mtime. Setting and clearing are the same statement, differing only
// in `deleted` — blank text tombstones the row rather than removing it.
const UPSERT_NOTE_SQL = `
  INSERT INTO notes (user_id, sutta_id, text, updated_at, mtime, deleted) VALUES (?1, ?2, ?3, ?4, ?4, ?5)
    ON CONFLICT(user_id, sutta_id) DO UPDATE SET text = ?3, updated_at = ?4, mtime = ?4, deleted = ?5
    WHERE ?4 > notes.mtime
`;

// Sets or clears one sutta's note.
async function setNote(db, userId, item) {
  const suttaId = item?.suttaId;
  if (!suttaId) return { error: 'sutta_id_required', status: 400 };
  const text = (item?.text || '').slice(0, NOTE_MAX_LENGTH);
  const cleared = text.trim() === '';
  // `updated_at` takes the same client instant as `mtime`, so the Notes auto-list orders by when
  // the note was written rather than when it arrived.
  const mtime = resolveMtime(item?.mtime);
  await db.prepare(UPSERT_NOTE_SQL).bind(userId, suttaId, cleared ? '' : text, mtime, cleared ? 1 : 0).run();
  return OK;
}

// Inserts one highlight — the span's two endpoints — and never updates it again: a recolour is a
// tombstone plus a new row. OR IGNORE on (user_id, id) makes a re-push a no-op.
const INSERT_HIGHLIGHT_SQL = `
  INSERT OR IGNORE INTO highlights (id, user_id, sutta_id, i0, o0, i1, o1, color, created_at, mtime)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

// Retires one highlight, conditional on mtime.
const TOMBSTONE_HIGHLIGHT_SQL = `
  UPDATE highlights SET deleted = 1, mtime = ?3 WHERE user_id = ?1 AND id = ?2 AND mtime < ?3
`;

// Applies one highlight gesture over `span` — from (i0, o0) up to but not including (i1, o1), in
// segment indices and character offsets (web/src/lib/types.ts's Highlight) — as one batch.
//   g      – the id of the highlight to create; required unless this is an erase
//   erase  – the ids this gesture displaces, tombstoned before the insert
//   color  – null for a plain erase, where `span` only records what the user selected
// Both ids come from the client and are never inferred from live rows, so the write means the same
// thing whenever it is replayed.
async function setHighlight(db, userId, item) {
  const { suttaId, span, color, g, erase } = item || {};
  if (!suttaId || !span) return { error: 'span_required', status: 400 };
  const { i0, o0, i1, o1 } = span;
  if (![i0, o0, i1, o1].every(Number.isInteger) || i0 < 0 || o0 < 0 || o1 < 0 || i1 < i0 || (i1 === i0 && o1 <= o0)) {
    return { error: 'invalid_span', status: 400 };
  }
  if (!Array.isArray(erase) || erase.some((id) => typeof id !== 'string' || !id)) {
    return { error: 'invalid_erase', status: 400 };
  }
  if (color && (typeof g !== 'string' || !g)) return { error: 'group_id_required', status: 400 };
  // `created_at` takes the client instant too, so the Highlights auto-list orders by when the user
  // highlighted rather than when the write arrived.
  const mtime = resolveMtime(item?.mtime);
  const statements = erase.map((id) => db.prepare(TOMBSTONE_HIGHLIGHT_SQL).bind(userId, id, mtime));
  if (color) {
    statements.push(db.prepare(INSERT_HIGHLIGHT_SQL).bind(g, userId, suttaId, i0, o0, i1, o1, color, mtime, mtime));
  }
  // D1 rejects an empty batch, which an erase displacing nothing would produce.
  if (statements.length) await db.batch(statements);
  return OK;
}

// Records a visit to one sutta.
async function markVisited(db, userId, item) {
  const suttaId = item?.suttaId;
  if (!suttaId) return { error: 'sutta_id_required', status: 400 };
  // `visited` has no mtime column: visited_at is the clock the conditional write compares against.
  const visitedAt = resolveMtime(item?.visitedAt);
  await db
    .prepare(
      `INSERT INTO visited (user_id, sutta_id, visited_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(user_id, sutta_id) DO UPDATE SET visited_at = ?3
         WHERE ?3 > visited.visited_at`
    )
    .bind(userId, suttaId, visitedAt)
    .run();
  return OK;
}

// The wire names a push may carry. `list.*` and the annotations are records — a desired state;
// `item.*` and `sibling.order` are operations (docs/offline-sync.md, mechanism 4).
const HANDLERS = {
  'list.create': createList,
  'list.update': updateList,
  'list.delete': deleteList,
  'item.add': addItem,
  'item.remove': removeItem,
  'item.order': reorderItems,
  'sibling.order': reorderSiblings,
  note: setNote,
  highlight: setHighlight,
  visited: markVisited,
};

// Applies one pushed item, returning `{ok: true}` or `{error, status}`.
export async function applyWrite(db, userId, item) {
  const handler = HANDLERS[item?.type];
  if (!handler) return { error: 'unknown_type', status: 400 };
  return handler(db, userId, item);
}
