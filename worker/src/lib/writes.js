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
// refusal. A push is deliberately **not** atomic, so one refused item has to be reportable on its
// own without disturbing the rest of the batch.
//
// Every statement here is scoped `AND user_id = ?`: D1 is one flat table per entity, with no
// structural isolation between users — the predicate *is* the isolation. A missing scope would leak
// or overwrite another user's row, so it belongs on reads, writes and existence checks alike.

const OK = { ok: true };

// assembleUserData synthesizes the three auto-lists into its response by these ids without
// consulting the `lists` table, so a stored row sharing one would be returned alongside its
// synthetic twin — same id, twice, the stored one first. The client resolves auto-lists with
// `lists.find(...)` and would render the impostor in the "Activity" section.
const RESERVED_LIST_IDS = new Set([RECENT_AUTO_LIST_ID, HIGHLIGHTS_AUTO_LIST_ID, NOTES_AUTO_LIST_ID]);

function parentIdOf(item) {
  return typeof item?.parentId === 'string' ? item.parentId : null;
}

function orderOf(item) {
  return Array.isArray(item?.order) ? item.order : [];
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
// can't drift apart), plus a cycle check for `movingId` being reparented to `parentId` (see
// wouldCreateCycle's own comment) — updateList's check for an *existing* list's parentId changing,
// unlike a fresh create. reorderSiblings makes both checks inline instead, off reads it already
// needs for other reasons.
async function invalidReparentReason(db, userId, parentId, movingId) {
  const kindError = await invalidParentReason(db, userId, parentId);
  if (kindError) return kindError;
  if (!parentId) return null;
  // Live rows only: a tombstoned list is no longer part of the tree, so counting it here could
  // manufacture a cycle out of a chain that no read path ever renders. The cycles that survive
  // this check — two devices each making a locally-valid move — are broken at read time by
  // lib/listTree.js instead, which is the only place both devices can agree on the outcome.
  const { results } = await db.prepare('SELECT id, parent_id FROM lists WHERE user_id = ? AND deleted = 0').bind(userId).all();
  const allLists = results.map((row) => ({ id: row.id, parentId: row.parent_id ?? null }));
  return wouldCreateCycle(movingId, parentId, allLists) ? 'parent_is_descendant' : null;
}

// The existence+kind check the two "this list's items" writes below both need, as one query.
// Returns `{row}` for a plain list that can hold suttas, or `{error, status}` for the two
// rejections — 404 for a list that doesn't exist (for this user), 400 for a group.
//
// Deliberately unfiltered on `deleted`, and load-bearingly so: membership travels as operations
// rather than as record state (see docs/offline-sync.md), so an add queued offline can arrive
// after the list's own delete. Treating the tombstone as not-found would 404 and discard the add —
// the exact silent loss this all exists to prevent. It lands on the dead row instead, invisible to
// every read path, and returns with the list if that is ever un-deleted.
async function suttaListRow(db, userId, id) {
  const row = await db.prepare('SELECT items, kind FROM lists WHERE id = ? AND user_id = ?').bind(id, userId).first();
  if (!row) return { error: 'not_found', status: 404 };
  if (row.kind === 'group') return { error: 'group_cannot_hold_suttas', status: 400 };
  return { row };
}

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

// A client-chosen id is what lets an offline create be referenced (renamed, filed into, moved)
// before it has ever reached the server.
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
  // `lists.id` is a global PRIMARY KEY, so ON CONFLICT(id) fires on *any* user's row with this id,
  // not just this user's. A skipped insert is therefore two different situations: the retry the
  // conflict clause exists to absorb, or another account having claimed the id first. Only a
  // user-scoped read tells them apart, and getting it wrong would report success for a row that
  // does not exist under this account — every later write against that id then 404s.
  if (created.meta?.changes === 0) {
    const mine = await db.prepare('SELECT id FROM lists WHERE id = ? AND user_id = ?').bind(id, userId).first();
    if (!mine) return { error: 'id_collision', status: 409 };
  }
  return OK;
}

// A list's whole mutable row — label and parent. Position is not part of it: sibling order travels
// as its own operation.
async function updateList(db, userId, item) {
  const id = item?.id;
  const assignments = [];
  const values = [];
  if (typeof item?.label === 'string' && item.label.trim()) {
    assignments.push('label = ?');
    values.push(item.label.trim().slice(0, LIST_NAME_MAX_LENGTH));
  }
  // `parentId` is a legitimate value to explicitly set to null (move to top level), so check for
  // the key's presence rather than truthiness.
  if (item && 'parentId' in item) {
    const parentId = parentIdOf(item);
    const parentError = await invalidReparentReason(db, userId, parentId, id);
    if (parentError) return { error: parentError, status: 400 };
    assignments.push('parent_id = ?');
    values.push(parentId);
  }
  if (!assignments.length) {
    // Nothing to write — fall back to a plain existence check so an update naming no recognized
    // field still 404s for a bogus id instead of silently succeeding.
    const row = await db.prepare('SELECT id FROM lists WHERE id = ? AND user_id = ?').bind(id, userId).first();
    return row ? OK : { error: 'not_found', status: 404 };
  }
  // Conditional on mtime, like the annotation writes: a stale offline rename or move can't clobber
  // a fresher edit made elsewhere. That makes `meta.changes === 0` cover both "no such list" and a
  // rejected stale write, so a miss falls back to an existence check before deciding on a 404. A
  // rejected stale write is not an error — the loser of last-writer-wins is dropped silently, not
  // surfaced.
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

// Tombstones the list instead of removing it, so a device that was offline when the delete
// happened can't resurrect it on reconnect by pushing its still-live copy — against a hard-deleted
// row that push is indistinguishable from a fresh creation.
//
// A deleted group's children are left pointing at the dead row rather than re-parented here: the
// read-time repair in lib/listTree.js cascades them out, which is the only outcome two devices can
// agree on without talking to each other. It also keeps this to a single statement — a subtree walk
// would need a read-then-write that D1 can't make atomic, having no interactive transactions.
//
// Conditional on mtime like every other write, so a stale offline delete can't take out a list
// renamed or refilled more recently elsewhere. `meta.changes === 0` therefore covers both "no such
// list" and "a newer write already won", so a miss falls back to an existence check for the 404 —
// and re-deleting an already-tombstoned list is a no-op success, which is what makes a replayed
// delete safe.
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

// Bulk-reorders one parent's direct children (parentId: null for top-level lists) — the sibling
// counterpart to reorderItems below. `order` positions are only meaningful relative to siblings
// sharing the same parent (see buildUserData in routes/data.js, which the client filters by
// parentId), so this never needs to touch — or even know about — any other parent's lists.
//
// One operation per gesture by design: an update per sibling would make dragging the 50th list of a
// group to the top produce 50 of them. Like every other write here it has to survive being replayed
// from an offline queue, which is what reconcileSiblingOrder is for.
async function reorderSiblings(db, userId, item) {
  const parentId = parentIdOf(item);
  const posted = orderOf(item);
  // The parent row, read once and asked both questions, rather than through invalidReparentReason's
  // wrappers — which fetch it a second time, and the whole live-list set a second time after that.
  // Every D1 query counts against the Worker's per-request subrequest budget, and a push carries up
  // to PUSH_MAX_ITEMS of these, so a duplicate read here is multiplied by the chunk size.
  //
  // A parent this account has no row for at all makes the gesture moot rather than invalid — it is
  // a group created and deleted before it ever reached the server, which leaves no tombstone
  // behind (see removeListRecord in web/src/lib/mirror.ts). 404 is what lib/sync.ts reads as
  // "gone", so the queued op retires; the 400 the kind check gives it instead is permanent, and the
  // op would be re-refused on every flush forever. Unfiltered on `deleted` like every other parent
  // check here: a reorder under a tombstoned group still lands harmlessly.
  if (parentId) {
    const parent = await db.prepare('SELECT kind FROM lists WHERE id = ? AND user_id = ?').bind(parentId, userId).first();
    if (!parent) return { error: 'not_found', status: 404 };
    const kindError = invalidParentReasonForRow(parent);
    if (kindError) return { error: kindError, status: 400 };
  }
  // Live rows only: a tombstoned list is out of the tree, and a stale posted order naming one must
  // not write a position back onto it. This one read answers all three of "does this id still
  // exist", "what else lives in this parent that the client never saw", and the cycle walk below —
  // nothing writes in between, so they all see the same snapshot either way.
  const { results } = await db.prepare('SELECT id, parent_id FROM lists WHERE user_id = ? AND deleted = 0').bind(userId).all();
  // Same cycle check invalidReparentReason makes for a single moved list, over every id the posted
  // order would reparent into `parentId`. A null parent can't be anyone's descendant, so
  // wouldCreateCycle answers false without walking.
  const allLists = results.map((row) => ({ id: row.id, parentId: row.parent_id ?? null }));
  for (const movingId of posted) {
    if (wouldCreateCycle(movingId, parentId, allLists)) return { error: 'parent_is_descendant', status: 400 };
  }
  const liveIds = new Set(results.map((row) => row.id));
  const currentChildIds = results.filter((row) => (row.parent_id ?? null) === parentId).map((row) => row.id);
  const order = reconcileSiblingOrder(posted, currentChildIds, liveIds);
  if (order.length) {
    // One reorder gesture, one mtime, applied to every sibling it touches — each row still guarded
    // on its own stored mtime, so a list edited more recently elsewhere (e.g. renamed from another
    // device) keeps that edit instead of being dragged back by a stale reorder.
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

// Appends one sutta id to `items`. json_insert with the '$[#]' path is one atomic statement with no
// read-modify-write, and the EXISTS guard keeps a re-add from duplicating an id already in the list.
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

// Removes one sutta id, rebuilding `items` from json_each minus that value. COALESCE covers the
// empty result json_group_array yields nothing for.
const REMOVE_ITEM_SQL = `
  UPDATE lists SET items = COALESCE(
      (SELECT json_group_array(j.value) FROM json_each(lists.items) AS j WHERE j.value <> ?3),
      '[]')
  WHERE id = ?1 AND user_id = ?2
`;

async function removeItem(db, userId, item) {
  // No kind check here: removing an item from a group is harmless (it has none) and only the
  // list's existence matters, which `meta.changes` already reports.
  const result = await db.prepare(REMOVE_ITEM_SQL).bind(item?.listId, userId, item?.suttaId).run();
  if (result.meta.changes === 0) return { error: 'not_found', status: 404 };
  return OK;
}

async function reorderItems(db, userId, item) {
  const found = await suttaListRow(db, userId, item?.listId);
  if (found.error) return found;
  const current = JSON.parse(found.row.items || '[]');
  const reconciled = reconcileItemOrder(current, orderOf(item));
  // Item order moves as a unit on the list's own mtime, same as sibling order — a stale offline
  // reorder can't overwrite a fresher one made elsewhere.
  const mtime = resolveMtime(item?.mtime);
  await db
    .prepare('UPDATE lists SET items = ?, mtime = ? WHERE id = ? AND user_id = ? AND mtime < ?')
    .bind(JSON.stringify(reconciled), mtime, item.listId, userId, mtime)
    .run();
  return OK;
}

// Blank text tombstones the note (`deleted = 1`, text emptied) rather than storing an empty string
// or removing the row. lib/userData.js's auto-notes list treats "row exists" as "has a note", so an
// empty note left visible would keep showing up there — and a hard delete would let a device that
// was offline when the clear happened push its stale copy back, which against a missing row is
// indistinguishable from writing a brand new note. The tombstone stays behind to lose that merge.
//
// Setting and clearing are the same conditional upsert, differing only in `deleted`: both are just
// a state the note is in at a given mtime, so a stale clear can no more erase a newer edit than a
// stale edit can undo a newer clear.
const UPSERT_NOTE_SQL = `
  INSERT INTO notes (user_id, sutta_id, text, updated_at, mtime, deleted) VALUES (?1, ?2, ?3, ?4, ?4, ?5)
    ON CONFLICT(user_id, sutta_id) DO UPDATE SET text = ?3, updated_at = ?4, mtime = ?4, deleted = ?5
    WHERE ?4 > notes.mtime
`;

async function setNote(db, userId, item) {
  const suttaId = item?.suttaId;
  if (!suttaId) return { error: 'sutta_id_required', status: 400 };
  const text = (item?.text || '').slice(0, NOTE_MAX_LENGTH);
  const cleared = text.trim() === '';
  // Conditional on mtime so a stale offline edit can't overwrite newer work made elsewhere in the
  // meantime — the entire conflict resolution is this WHERE clause. `updated_at` takes the same
  // client-supplied instant as `mtime`, so the Notes auto-list orders by when the user wrote the
  // note rather than by when the write happened to reach the server.
  const mtime = resolveMtime(item?.mtime);
  await db.prepare(UPSERT_NOTE_SQL).bind(userId, suttaId, cleared ? '' : text, mtime, cleared ? 1 : 0).run();
  return OK;
}

// A highlight group is immutable. One selection mints one `g` (groupId) and writes one row per
// segment it spans, and nothing updates those rows again: a recolour is a tombstone plus a brand
// new group, an erase is a tombstone. That is what makes the write safe to replay, where a
// "delete whatever currently overlaps, then insert" would mean something different an hour later
// and take whole highlights another device had created in between.
//
// (user_id, g, i) is a group's natural key (migration 0002's unique index), so OR IGNORE makes
// re-pushing a group a no-op rather than a duplicate row or a constraint error.
const INSERT_HIGHLIGHT_SQL = `
  INSERT OR IGNORE INTO highlights (id, user_id, sutta_id, i, s, e, color, g, created_at, mtime)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

// Retires a whole group — every segment it spans — in one statement. Conditional on mtime like
// every other write here, so a stale erase can't retire a group created more recently.
const TOMBSTONE_GROUP_SQL = `
  UPDATE highlights SET deleted = 1, mtime = ?3 WHERE user_id = ?1 AND g = ?2 AND mtime < ?3
`;

// Writes one highlight group over the given [s,e) ranges (each in its own segment i) of suttaId —
// a single-range array covers the common single-segment selection, a multi-entry one covers a
// cross-segment selection (see useHighlightPopup), so one item always maps to one atomic write
// regardless of how many segments it spans.
//
// The client decides everything about identity: `g` names the group being created and `erase`
// names the groups this selection displaces, worked out from what that device can already see
// (lib/highlights.ts's displacedGroupIds). The server never infers either from live rows — that is
// what an hour-old replayed write would get wrong. Both are required, so an item that omits them
// is a bug rather than a silent half-write; `color: null` is a plain erase, decided by `erase`
// alone (its `ranges` only record what the user selected). Tombstones go into the batch before the
// inserts, so a recolour can't retire the group it just created.
async function setHighlight(db, userId, item) {
  const { suttaId, ranges, color, g, erase } = item || {};
  if (!suttaId || !Array.isArray(ranges) || !ranges.length) return { error: 'ranges_required', status: 400 };
  for (const r of ranges) {
    if (!Number.isInteger(r.i) || !Number.isInteger(r.s) || !Number.isInteger(r.e) || r.s >= r.e) {
      return { error: 'invalid_range', status: 400 };
    }
  }
  if (!Array.isArray(erase) || erase.some((id) => typeof id !== 'string' || !id)) {
    return { error: 'invalid_erase', status: 400 };
  }
  // A server-minted id would cost the group its idempotence: a create re-sent after a lost
  // response would arrive under a second name and duplicate the highlight instead of colliding
  // with itself on (user_id, g, i). Every statement below is scoped `AND user_id = ?` and the
  // unique index leads with user_id too, so one account's group id can't reach another's rows —
  // shape is all that's left to check.
  if (color && (typeof g !== 'string' || !g)) return { error: 'group_id_required', status: 400 };
  // `created_at` takes the client's instant too, so the Highlights auto-list orders by when the
  // user highlighted rather than when the write reached the server.
  const mtime = resolveMtime(item?.mtime);
  const statements = erase.map((groupId) => db.prepare(TOMBSTONE_GROUP_SQL).bind(userId, groupId, mtime));
  if (color) {
    for (const r of ranges) {
      statements.push(
        db.prepare(INSERT_HIGHLIGHT_SQL).bind(crypto.randomUUID(), userId, suttaId, r.i, r.s, r.e, color, g, mtime, mtime)
      );
    }
  }
  // An erase that displaces nothing leaves nothing to run, and D1 rejects an empty batch.
  if (statements.length) await db.batch(statements);
  return OK;
}

async function markVisited(db, userId, item) {
  const suttaId = item?.suttaId;
  if (!suttaId) return { error: 'sutta_id_required', status: 400 };
  // `visited` has no separate mtime column — visited_at already is the clock, so it's the one the
  // client supplies and the conditional write compares against. A stale offline visit can then no
  // longer jump ahead of a newer visit recorded elsewhere.
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

// The wire names, and the whole vocabulary of a push. `list.*` and the annotations carry a record's
// desired state; `item.*` and `sibling.order` are operations, which is why membership and order are
// safe to replay in the order the user made them (docs/offline-sync.md, mechanism 4).
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

export async function applyWrite(db, userId, item) {
  const handler = HANDLERS[item?.type];
  if (!handler) return { error: 'unknown_type', status: 400 };
  return handler(db, userId, item);
}
