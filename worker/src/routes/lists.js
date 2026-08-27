import { Hono } from 'hono';
import { requireAuth } from '../auth.js';
import { shapeList } from '../lib/listShape.js';

export const listsRouter = new Hono();
listsRouter.use(requireAuth);

// Reading only. Every write to a list — create, rename, move, delete, membership, order — goes
// through POST /api/data/push instead (routes/data.js, over lib/writes.js), which is the app's one
// write endpoint.

// Adapts a `lists` row (snake_case columns, `items` stored as a JSON string) into the camelCase
// field names shapeList — shared with lib/userData.js — and the client both expect.
function serializeList(row) {
  return shapeList(row.id, { label: row.label, parentId: row.parent_id, kind: row.kind, items: JSON.parse(row.items || '[]') });
}

// A flat list of this user's live lists. The client reads its tree from GET /api/data instead
// (which additionally applies lib/listTree.js's repair), so this stays a plain filtered read.
//
// Scoped `AND user_id = ?` like every other statement against these tables: D1 is flat tables with
// no structural per-user isolation, so that predicate is the only thing separating one account's
// lists from another's.
listsRouter.get('/', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM lists WHERE user_id = ? AND deleted = 0 ORDER BY position')
    .bind(c.get('userId'))
    .all();
  return c.json({ lists: results.map(serializeList) });
});
