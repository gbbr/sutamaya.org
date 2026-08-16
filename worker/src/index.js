import { Hono } from 'hono';
import { authRouter } from './routes/auth.js';
import { listsRouter } from './routes/lists.js';

const app = new Hono();

app.get('/api/health', async (c) => {
  await c.env.DB.prepare('SELECT 1').first();
  return c.json({ ok: true });
});

app.route('/api/auth', authRouter);
app.route('/api/lists', listsRouter);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'internal_error' }, 500);
});

export default app;
