import { Hono } from 'hono';
import { requireAuth } from '../auth.js';
import { jsonBody } from '../jsonBody.js';
import { NOTE_MAX_LENGTH } from '../lib/textLimits.js';
import { resolveMtime } from '../lib/mtime.js';

export const annotationsRouter = new Hono();
annotationsRouter.use(requireAuth);

// As in routes/lists.js, every statement here is scoped `AND user_id = ?` — D1 is flat tables
// with no structural per-user isolation of their own, so that predicate is the only thing
// isolating one user's annotations from another's.

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

annotationsRouter.put('/notes/:suttaId', async (c) => {
  const body = await jsonBody(c);
  const text = ((body && body.text) || '').slice(0, NOTE_MAX_LENGTH);
  const cleared = text.trim() === '';
  // Conditional on mtime so a stale offline edit can't overwrite newer work made elsewhere in the
  // meantime — the entire conflict resolution is this WHERE clause. `updated_at` takes the same
  // client-supplied instant as `mtime`, so the Notes auto-list orders by when the user wrote the
  // note rather than by when the write happened to reach the server.
  const mtime = resolveMtime(body?.mtime);
  await c.env.DB.prepare(UPSERT_NOTE_SQL)
    .bind(c.get('userId'), c.req.param('suttaId'), cleared ? '' : text, mtime, cleared ? 1 : 0)
    .run();
  return c.json({ ok: true });
});

// Deletes every stored highlight overlapping one of the posted ranges — same segment,
// `h.s < e AND h.e > s`, so a highlight merely touching at an edge is left alone.
const DELETE_OVERLAPS_SQL = `
  DELETE FROM highlights
   WHERE user_id = ?1 AND sutta_id = ?2 AND i = ?3 AND s < ?4 AND e > ?5
`;

const INSERT_HIGHLIGHT_SQL = `
  INSERT INTO highlights (id, user_id, sutta_id, i, s, e, color, g, created_at, mtime)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

// Atomically replace any highlight overlapping any of the given [s,e) ranges (each in its own
// segment i) of suttaId with `color` (color === null just removes the overlap) — a single-range
// array covers the common single-segment selection, a multi-entry one covers a cross-segment
// selection (see useHighlightPopup), so one request always maps to one atomic write regardless of
// how many segments it spans. All rows written by one call share a single `g` (groupId) so a
// cross-segment highlight can be recombined for display/counting (lib/highlights.ts's
// groupHighlights) without inferring it from segment adjacency.
//
// SQL does the overlap filtering, so the whole operation is one db.batch() of DELETEs followed
// by INSERTs — no read at all, which closes the lost-update window a check-then-write approach
// would leave open. Deletes come first in the batch so a fresh insert can't be removed by a
// later range's overlap delete.
annotationsRouter.put('/highlights/ranges', async (c) => {
  const db = c.env.DB;
  const userId = c.get('userId');
  const { suttaId, ranges, color, mtime: clientMtime } = (await jsonBody(c)) || {};
  if (!suttaId || !Array.isArray(ranges) || !ranges.length) {
    return c.json({ error: 'suttaId and a non-empty ranges array are required.' }, 400);
  }
  for (const r of ranges) {
    if (!Number.isInteger(r.i) || !Number.isInteger(r.s) || !Number.isInteger(r.e) || r.s >= r.e) {
      return c.json({ error: 'each range needs integer i, s, e with s < e.' }, 400);
    }
  }
  const statements = ranges.map((r) =>
    db.prepare(DELETE_OVERLAPS_SQL).bind(userId, suttaId, r.i, r.e, r.s)
  );
  if (color) {
    const groupId = crypto.randomUUID();
    // `created_at` takes the client's instant too, so the Highlights auto-list orders by when
    // the user highlighted rather than when the write reached the server.
    const mtime = resolveMtime(clientMtime);
    for (const r of ranges) {
      statements.push(
        db
          .prepare(INSERT_HIGHLIGHT_SQL)
          .bind(crypto.randomUUID(), userId, suttaId, r.i, r.s, r.e, color, groupId, mtime, mtime)
      );
    }
  }
  await db.batch(statements);
  return c.json({ ok: true });
});

// No current client calls this: removing a highlight goes through PUT /highlights/ranges with a
// null `color`, which does the removal in the same atomic batch as everything else. It stays for
// PWA shells cached before that change, which still fire this optimistically. Deleting a
// highlight that isn't there is not an error — a missing row means the intended end state
// already holds.
//
// Tombstones rather than deletes, so a device that was offline when this ran can't push the
// highlight back as an apparently-new one. Unconditional on mtime: the id is only knowable from
// synced server state, so there is no offline replay of this to be stale.
annotationsRouter.delete('/highlights/:id', async (c) => {
  await c.env.DB.prepare('UPDATE highlights SET deleted = 1, mtime = ? WHERE id = ? AND user_id = ?')
    .bind(resolveMtime(), c.req.param('id'), c.get('userId'))
    .run();
  return c.json({ ok: true });
});

annotationsRouter.post('/visited/:suttaId', async (c) => {
  const body = await jsonBody(c);
  // `visited` has no separate mtime column — visited_at already is the clock, so it's the one
  // the client supplies and the conditional write compares against. A stale offline visit can
  // then no longer jump ahead of a newer visit recorded elsewhere.
  const visitedAt = resolveMtime(body?.visitedAt);
  await c.env.DB.prepare(
    `INSERT INTO visited (user_id, sutta_id, visited_at) VALUES (?1, ?2, ?3)
       ON CONFLICT(user_id, sutta_id) DO UPDATE SET visited_at = ?3
       WHERE ?3 > visited.visited_at`
  )
    .bind(c.get('userId'), c.req.param('suttaId'), visitedAt)
    .run();
  return c.json({ ok: true });
});
