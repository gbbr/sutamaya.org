import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { webOrigins } from './oauth.js';
import { checkRateLimit } from './rateLimit.js';
import { authRouter } from './routes/auth.js';
import { listsRouter } from './routes/lists.js';
import { dataRouter } from './routes/data.js';
import { withShareMeta } from './shareMeta.js';

const app = new Hono();

// Rate limiting, per client IP, in three budgets:
//   RATE_LIMIT_API  – every /api/* request
//   RATE_LIMIT_ME   – GET /api/auth/me, which the app fires on every load, on top of the above
//   RATE_LIMIT_AUTH – the rest of /api/auth/*, on top of the above
app.use('/api/*', async (c, next) => {
  const tooMany = () => c.json({ error: 'rate_limited' }, 429);
  const ip = c.req.header('cf-connecting-ip');

  if (!(await checkRateLimit(c.env.RATE_LIMIT_API, ip))) return tooMany();
  if (c.req.path.startsWith('/api/auth/')) {
    const budget = c.req.path === '/api/auth/me' ? c.env.RATE_LIMIT_ME : c.env.RATE_LIMIT_AUTH;
    if (!(await checkRateLimit(budget, ip))) return tooMany();
  }
  return next();
});

// CORS, built per request since the allowed origins come from WEB_ORIGIN. A no-op in the normal
// same-origin case, the app being served from this origin.
app.use('/api/*', (c, next) => cors({ origin: webOrigins(c.env.WEB_ORIGIN), credentials: true })(c, next));

// Keeps one account's data out of the browser's HTTP cache, which the app can't clear on sign-out.
// Scoped to /api/*: the corpus and text come from the assets binding and are cached hard.
app.use('/api/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
});

app.get('/api/health', async (c) => {
  await c.env.DB.prepare('SELECT 1').first();
  return c.json({ ok: true });
});

app.route('/api/auth', authRouter);
// Reads only; every write goes to POST /api/data/push under the router below.
app.route('/api/lists', listsRouter);
app.route('/api/data', dataRouter);

// The hostnames serving the landing page, each mapped to where its app lives. Every other
// hostname is the app, so no development host has to be listed.
const MARKETING_HOSTS = new Map([
  ['sutamaya.org', 'https://app.sutamaya.org'],
  ['www.sutamaya.org', 'https://app.sutamaya.org'],
  ['local.sutamaya.org', 'https://app.local.sutamaya.org'],
]);

// The bare origin: the landing page on a marketing hostname, the app shell everywhere else.
app.get('/', async (c) => {
  const marketing = MARKETING_HOSTS.has(new URL(c.req.url).hostname);
  // A rewrite rather than a redirect, so the indexed page and the shared URL are the same one.
  const res = await c.env.ASSETS.fetch(new URL(marketing ? '/landing.html' : '/index.html', c.req.url));
  return new Response(res.body, {
    status: res.status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // An hour, not the year hashed assets get: neither file's URL changes between deploys.
      'Cache-Control': 'public, max-age=3600',
    },
  });
});

// The app's own paths, redirected off the marketing hostname and served from the assets binding on
// the app's. The shell, sw.js and the manifest are here so no service worker can register on the
// marketing hostname and serve the app over the landing page; the page paths, so an old link still
// arrives. Keep in step with `assets.run_worker_first` (wrangler.jsonc), which is what makes the
// Worker see them at all.
const APP_PATHS = [
  '/index.html',
  '/sw.js',
  '/manifest.webmanifest',
  '/browse/*',
  '/read/*',
  '/settings',
  '/help',
];

app.on(['GET', 'HEAD'], APP_PATHS, async (c) => {
  const url = new URL(c.req.url);
  const appOrigin = MARKETING_HOSTS.get(url.hostname);
  if (appOrigin) return c.redirect(`${appOrigin}${url.pathname}${url.search}`, 301);
  // A sutta or group link gets its own title and description written into the shell; every other
  // path is handed back as built. See shareMeta.js.
  return withShareMeta(await c.env.ASSETS.fetch(c.req.raw), url, c.env);
});

// Every error body is `{error: <snake_case code>}`, read from a network log rather than displayed.
// The exception is /api/auth/email/*, whose messages EmailCodeSignIn shows verbatim.
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'internal_error' }, 500);
});

// An unmatched /api path answers in the same shape as every other error. Non-/api paths stay at
// the asset router and don't normally reach here, so the plain text is a misconfiguration's cue.
app.notFound((c) => (c.req.path.startsWith('/api/') ? c.json({ error: 'not_found' }, 404) : c.text('404 Not Found', 404)));

export default app;
