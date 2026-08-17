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

// A highlight group is immutable. One selection mints one `g` (groupId) and writes one row per
// segment it spans, and nothing ever updates those rows again: a recolour is a tombstone plus a
// brand new group, an erase is a tombstone. That's what makes the write safe to replay — the old
// "delete whatever currently overlaps, then insert" meant something different an hour later than
// it did when the user acted, and took whole highlights another device had created in between.
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
// cross-segment selection (see useHighlightPopup), so one request always maps to one atomic write
// regardless of how many segments it spans.
//
// The client decides everything about identity: `g` names the group being created and `erase`
// names the groups this selection displaces, worked out from what that device can already see
// (lib/highlights.ts's displacedGroupIds). The server never infers either from live rows — that is
// what an hour-old replayed write would get wrong. Both are required, so a request that omits them
// is a bug rather than a silent half-write; `color: null` is a plain erase, decided by `erase`
// alone (its `ranges` only record what the user selected). Tombstones go into the batch before the
// inserts, so a recolour can't retire the group it just created.
annotationsRouter.put('/highlights/ranges', async (c) => {
  const db = c.env.DB;
  const userId = c.get('userId');
  const { suttaId, ranges, color, g, mtime: clientMtime, erase } = (await jsonBody(c)) || {};
  if (!suttaId || !Array.isArray(ranges) || !ranges.length) {
    return c.json({ error: 'suttaId and a non-empty ranges array are required.' }, 400);
  }
  for (const r of ranges) {
    if (!Number.isInteger(r.i) || !Number.isInteger(r.s) || !Number.isInteger(r.e) || r.s >= r.e) {
      return c.json({ error: 'each range needs integer i, s, e with s < e.' }, 400);
    }
  }
  if (!Array.isArray(erase) || erase.some((id) => typeof id !== 'string' || !id)) {
    return c.json({ error: 'erase must be an array of group ids.' }, 400);
  }
  // A server-minted id would cost the group its idempotence: a create re-sent after a lost
  // response would arrive under a second name and duplicate the highlight instead of colliding
  // with itself on (user_id, g, i). Every statement below is scoped `AND user_id = ?` and the
  // unique index leads with user_id too, so one account's group id can't reach another's rows —
  // shape is all that's left to check.
  if (color && (typeof g !== 'string' || !g)) {
    return c.json({ error: 'g must be a non-empty string.' }, 400);
  }
  // `created_at` takes the client's instant too, so the Highlights auto-list orders by when the
  // user highlighted rather than when the write reached the server.
  const mtime = resolveMtime(clientMtime);
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
