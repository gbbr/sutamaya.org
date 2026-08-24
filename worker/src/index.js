import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { webOrigins } from './oauth.js';
import { checkRateLimit } from './rateLimit.js';
import { authRouter } from './routes/auth.js';
import { listsRouter } from './routes/lists.js';
import { annotationsRouter } from './routes/annotations.js';
import { dataRouter } from './routes/data.js';

const app = new Hono();

// Every /api/* request draws from the general budget, and /api/auth/* draws from a second,
// tighter one on top — its own for GET /api/auth/me, which AuthContext fires on every page load
// and PWA relaunch, and a much tighter one for the rest of /api/auth/*, so routine reloads can't
// burn through the budget a genuine sign-in needs. Nothing else is mounted here: static assets
// never reach the Worker.
app.use('/api/*', async (c, next) => {
  const tooMany = () => c.json({ error: 'Too many requests. Please try again in a moment.' }, 429);
  const ip = c.req.header('cf-connecting-ip');

  if (!(await checkRateLimit(c.env.RATE_LIMIT_API, ip))) return tooMany();
  if (c.req.path.startsWith('/api/auth/')) {
    const budget = c.req.path === '/api/auth/me' ? c.env.RATE_LIMIT_ME : c.env.RATE_LIMIT_AUTH;
    if (!(await checkRateLimit(budget, ip))) return tooMany();
  }
  return next();
});

// A no-op for the normal same-origin case — the Worker serves the SPA from the assets binding on
// this very origin — but it guards against a stray cross-origin call. Built per request rather
// than once at module scope because the allowed origins come from the environment (WEB_ORIGIN is
// one origin in production and may be a comma-separated list in dev — see webOrigins).
app.use('/api/*', (c, next) => cors({ origin: webOrigins(c.env.WEB_ORIGIN), credentials: true })(c, next));

app.get('/api/health', async (c) => {
  await c.env.DB.prepare('SELECT 1').first();
  return c.json({ ok: true });
});

app.route('/api/auth', authRouter);
app.route('/api/lists', listsRouter);
// Mounted at /api, not /api/annotations — its routes are /notes/*, /highlights/* and /visited/*,
// which are the client's actual paths.
app.route('/api', annotationsRouter);
app.route('/api/data', dataRouter);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'internal_error' }, 500);
});

export default app;
