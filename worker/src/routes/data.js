import { Hono } from 'hono';
import { requireAuth, findUserById } from '../auth.js';
import { jsonBody } from '../jsonBody.js';
import { assembleUserData } from '../lib/userData.js';
import { applyWrite } from '../lib/writes.js';

export const dataRouter = new Hono();
dataRouter.use(requireAuth);

// Returns everything one user's client needs — lists, membership, notes, highlights, visited — by
// running the four queries as one batched snapshot and handing the rows to assembleUserData, which
// does the shaping. Columns are mapped from snake_case to the camelCase the client uses.
async function buildUserData(db, userId) {
  // Tombstones never reach the client. `lists` is the exception and fetches its own, which
  // lib/listTree.js needs to cascade a deleted group's descendants out.
  const [lists, notes, highlights, visited] = await db.batch([
    db.prepare('SELECT * FROM lists WHERE user_id = ? ORDER BY position').bind(userId),
    db.prepare('SELECT * FROM notes WHERE user_id = ? AND deleted = 0').bind(userId),
    db.prepare('SELECT * FROM highlights WHERE user_id = ? AND deleted = 0').bind(userId),
    db.prepare('SELECT * FROM visited WHERE user_id = ?').bind(userId),
  ]);
  return assembleUserData({
    // `position`, `mtime` and `deleted` feed lib/listTree.js's read-time repair and stop there.
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
    // notes and visited have no id of their own, so the sutta id is the one assembleUserData keys
    // them by.
    noteDocs: notes.results.map((row) => ({ id: row.sutta_id, data: { text: row.text, updatedAt: row.updated_at } })),
    highlightDocs: highlights.results.map((row) => ({
      id: row.id,
      // `mtime` is rendered with, not just ordered by: the reader resolves overlapping highlights
      // by (mtime, id) — see lib/highlights.ts.
      data: {
        suttaId: row.sutta_id,
        i0: row.i0,
        o0: row.o0,
        i1: row.i1,
        o1: row.o1,
        color: row.color,
        createdAt: row.created_at,
        mtime: row.mtime,
      },
    })),
    visitedDocs: visited.results.map((row) => ({ id: row.sutta_id, data: { visitedAt: row.visited_at } })),
  });
}

dataRouter.get('/', async (c) => c.json(await buildUserData(c.env.DB, c.get('userId'))));

// Most items one push may carry, set by the Worker's 50-subrequest budget and the five D1 queries
// the dearest item costs. The client chunks at the same number and loops until its queue drains.
export const PUSH_MAX_ITEMS = 10;

// The app's only write endpoint: the records and operations the mirror owes the server, in the
// order the user made them, answered with one result per item.
//
// Not atomic — `results[i]` answers `items[i]`, and a refusal neither rolls back the items before
// it nor blocks the ones after it. Items run in order, sequentially, so an add and a later remove
// of the same sutta mean what they should. Anything that stops the whole push stays a
// whole-request status, leaving the client's queue intact.
dataRouter.post('/push', async (c) => {
  const body = await jsonBody(c);
  const items = Array.isArray(body?.items) ? body.items : null;
  if (!items) return c.json({ error: 'items_required' }, 400);
  if (items.length > PUSH_MAX_ITEMS) return c.json({ error: 'too_many_items' }, 400);
  const db = c.env.DB;
  const userId = c.get('userId');
  const results = [];
  for (const item of items) results.push(await applyWrite(db, userId, item));
  return c.json({ results });
});

// The same payload as GET /, plus the account's email, as a download.
dataRouter.get('/export', async (c) => {
  // requireAuth never reads the database, so the email is fetched here.
  const userId = c.get('userId');
  const user = await findUserById(c.env.DB, userId);
  const payload = { email: user?.email, exportedAt: new Date().toISOString(), ...(await buildUserData(c.env.DB, userId)) };
  c.header('Content-Disposition', 'attachment; filename="sutamaya-export.json"');
  return c.json(payload);
});
