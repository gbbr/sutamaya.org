import { Hono } from 'hono';
import { requireAuth, findUserById } from '../auth.js';
import { assembleUserData } from '../lib/userData.js';

export const dataRouter = new Hono();
dataRouter.use(requireAuth);

// Aggregates everything the client needs for one user into the same shape the reader's client-side
// state uses: lists, membership, notes, highlights, visited. The actual shaping/auto-list-synthesis
// logic lives in lib/userData.js's assembleUserData, pulled out so it's unit-testable without a
// live database — this just runs the four queries and adapts each row into the `{id, data}` pairs
// that function expects, mapping snake_case columns back to the camelCase field names it (and the
// client) use. db.batch sends all four in one round trip and reads them as one snapshot.
async function buildUserData(db, userId) {
  // Tombstoned rows must never reach the client: they survive in D1 so a device that was offline
  // when the delete happened can't resurrect them by pushing its still-live copy back. Notes are the
  // sharpest of these — assembleUserData's auto-notes list treats "a row exists" as "this sutta has
  // a note", so a tombstone slipping past the filter would put a deleted note back on screen.
  //
  // `lists` is the exception that fetches its tombstones: lib/listTree.js needs them to cascade a
  // deleted group's descendants out, and drops every dead row itself.
  const [lists, notes, highlights, visited] = await db.batch([
    db.prepare('SELECT * FROM lists WHERE user_id = ? ORDER BY position').bind(userId),
    db.prepare('SELECT * FROM notes WHERE user_id = ? AND deleted = 0').bind(userId),
    db.prepare('SELECT * FROM highlights WHERE user_id = ? AND deleted = 0').bind(userId),
    db.prepare('SELECT * FROM visited WHERE user_id = ?').bind(userId),
  ]);
  return assembleUserData({
    // `position`/`mtime`/`deleted` are here only to feed lib/listTree.js's read-time repair (cascade,
    // dangling-parent re-homing, cycle breaking, sibling order) — none of the three reach the client.
    listDocs: lists.results.map((row) => ({
      id: row.id,
      data: {
        label: row.label,
        parentId: row.parent_id,
        kind: row.kind,
        items: JSON.parse(row.items || '[]'),
        position: row.position,
        mtime: row.mtime,
        deleted: row.deleted,
      },
    })),
    // notes/visited are keyed by (user_id, sutta_id) rather than carrying a synthetic id, so the
    // sutta id is used as `id` here — which is what assembleUserData keys by.
    noteDocs: notes.results.map((row) => ({ id: row.sutta_id, data: { text: row.text, updatedAt: row.updated_at } })),
    highlightDocs: highlights.results.map((row) => ({
      id: row.id,
      data: { suttaId: row.sutta_id, i: row.i, s: row.s, e: row.e, color: row.color, g: row.g, createdAt: row.created_at },
    })),
    visitedDocs: visited.results.map((row) => ({ id: row.sutta_id, data: { visitedAt: row.visited_at } })),
  });
}

dataRouter.get('/', async (c) => c.json(await buildUserData(c.env.DB, c.get('userId'))));

dataRouter.get('/export', async (c) => {
  // requireAuth never reads the database (see its comment in auth.js) — this is the one route under
  // it that actually needs the email, so it fetches its own.
  const userId = c.get('userId');
  const user = await findUserById(c.env.DB, userId);
  const payload = { email: user?.email, exportedAt: new Date().toISOString(), ...(await buildUserData(c.env.DB, userId)) };
  c.header('Content-Disposition', 'attachment; filename="sutamaya-export.json"');
  return c.json(payload);
});
