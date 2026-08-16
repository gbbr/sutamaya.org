import { Hono } from 'hono';
import { authRouter } from './routes/auth.js';
import { listsRouter } from './routes/lists.js';
import { annotationsRouter } from './routes/annotations.js';
import { dataRouter } from './routes/data.js';

const app = new Hono();

app.get('/api/health', async (c) => {
  await c.env.DB.prepare('SELECT 1').first();
  return c.json({ ok: true });
});

app.route('/api/auth', authRouter);
app.route('/api/lists', listsRouter);
// Mounted at /api, not /api/annotations — its routes are /notes/*, /highlights/* and /visited/*,
// which are the client's actual paths (same as the Express original).
app.route('/api', annotationsRouter);
app.route('/api/data', dataRouter);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'internal_error' }, 500);
});

export default app;
