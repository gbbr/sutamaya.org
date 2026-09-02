import { Hono } from 'hono';
import { requireAuth } from '../auth.js';
import { shapeList } from '../lib/listShape.js';

export const listsRouter = new Hono();
listsRouter.use(requireAuth);

// Reading only; every write to a list goes through POST /api/data/push (routes/data.js).

// Maps a `lists` row into the camelCase shape the client expects.
function serializeList(row) {
  return shapeList(row.id, { label: row.label, parentId: row.parent_id, kind: row.kind, items: JSON.parse(row.items || '[]') });
}

// This user's live lists, flat. The client reads its tree from GET /api/data, which additionally
// applies lib/listTree.js's repair.
listsRouter.get('/', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM lists WHERE user_id = ? AND deleted = 0 ORDER BY position')
    .bind(c.get('userId'))
    .all();
  return c.json({ lists: results.map(serializeList) });
});
