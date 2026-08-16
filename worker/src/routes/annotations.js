import { Hono } from 'hono';
import { requireAuth } from '../auth.js';
import { jsonBody } from '../jsonBody.js';
import { NOTE_MAX_LENGTH } from '../lib/textLimits.js';

export const annotationsRouter = new Hono();
annotationsRouter.use(requireAuth);

// As in routes/lists.js, every statement here is scoped `AND user_id = ?` — D1 is flat tables
// with no structural per-user isolation of their own, so that predicate is the only thing
// isolating one user's annotations from another's.

// Blank text deletes the row rather than storing an empty string: lib/userData.js's auto-notes
// list treats "row exists" as "has a note", so an empty note left behind would keep showing up
// there.
annotationsRouter.put('/notes/:suttaId', async (c) => {
  const body = await jsonBody(c);
  const text = ((body && body.text) || '').slice(0, NOTE_MAX_LENGTH);
  const userId = c.get('userId');
  const suttaId = c.req.param('suttaId');
  if (text.trim() === '') {
    await c.env.DB.prepare('DELETE FROM notes WHERE user_id = ? AND sutta_id = ?').bind(userId, suttaId).run();
  } else {
    await c.env.DB.prepare(
      `INSERT INTO notes (user_id, sutta_id, text, updated_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(user_id, sutta_id) DO UPDATE SET text = ?3, updated_at = ?4`
    )
      .bind(userId, suttaId, text, new Date().toISOString())
      .run();
  }
  return c.json({ ok: true });
});

// Deletes every stored highlight overlapping one of the posted ranges — same segment,
// `h.s < e AND h.e > s`, so a highlight merely touching at an edge is left alone.
const DELETE_OVERLAPS_SQL = `
  DELETE FROM highlights
   WHERE user_id = ?1 AND sutta_id = ?2 AND i = ?3 AND s < ?4 AND e > ?5
`;

const INSERT_HIGHLIGHT_SQL = `
  INSERT INTO highlights (id, user_id, sutta_id, i, s, e, color, g, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  const { suttaId, ranges, color } = (await jsonBody(c)) || {};
  if (!suttaId || !Array.isArray(ranges) || !ranges.length) {
    return c.json({ error: 'suttaId and a non-empty ranges array are required.' }, 400);
  }
  for (const r of ranges) {
    if (!Number.isInteger(r.i) || !Number.isInteger(r.s) || !Number.isInteger(r.e)) {
      return c.json({ error: 'each range needs integer i, s, e.' }, 400);
    }
  }
  const statements = ranges.map((r) =>
    db.prepare(DELETE_OVERLAPS_SQL).bind(userId, suttaId, r.i, r.e, r.s)
  );
  if (color) {
    const groupId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    for (const r of ranges) {
      statements.push(
        db
          .prepare(INSERT_HIGHLIGHT_SQL)
          .bind(crypto.randomUUID(), userId, suttaId, r.i, r.s, r.e, color, groupId, createdAt)
      );
    }
  }
  await db.batch(statements);
  return c.json({ ok: true });
});

// Deleting a highlight that isn't there is not an error, matching the Express original — the
// client fires this optimistically and a missing row means the intended end state already holds.
annotationsRouter.delete('/highlights/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM highlights WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), c.get('userId'))
    .run();
  return c.json({ ok: true });
});

annotationsRouter.post('/visited/:suttaId', async (c) => {
  await c.env.DB.prepare(
    `INSERT INTO visited (user_id, sutta_id, visited_at) VALUES (?1, ?2, ?3)
       ON CONFLICT(user_id, sutta_id) DO UPDATE SET visited_at = ?3`
  )
    .bind(c.get('userId'), c.req.param('suttaId'), new Date().toISOString())
    .run();
  return c.json({ ok: true });
});
