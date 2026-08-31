import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { webOrigins } from './oauth.js';
import { checkRateLimit } from './rateLimit.js';
import { authRouter } from './routes/auth.js';
import { listsRouter } from './routes/lists.js';
import { dataRouter } from './routes/data.js';

const app = new Hono();

// Every /api/* request draws from the general budget, and /api/auth/* draws from a second,
// tighter one on top — its own for GET /api/auth/me, which AuthContext fires on every page load
// and PWA relaunch, and a much tighter one for the rest of /api/auth/*, so routine reloads can't
// burn through the budget a genuine sign-in needs. Nothing else is mounted here: static assets
// never reach the Worker.
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

// A no-op for the normal same-origin case — the Worker serves the SPA from the assets binding on
// this very origin — but it guards against a stray cross-origin call. Built per request rather
// than once at module scope because the allowed origins come from the environment (WEB_ORIGIN is
// one origin in production and may be a comma-separated list in dev — see webOrigins).
app.use('/api/*', (c, next) => cors({ origin: webOrigins(c.env.WEB_ORIGIN), credentials: true })(c, next));

// Everything under /api/* is scoped to one signed-in account, and signing out deletes this
// device's copy of it (deleteMirror in context/AuthContext.tsx) — but the browser's own HTTP cache
// is storage the app can't reach, so this says outright that no copy is to be kept there. Scoped
// to /api/*: the corpus, dictionary and per-sutta text come from the assets binding, never reach
// the Worker, and are meant to be cached hard.
app.use('/api/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
});

app.get('/api/health', async (c) => {
  await c.env.DB.prepare('SELECT 1').first();
  return c.json({ ok: true });
});

app.route('/api/auth', authRouter);
// Reads only. Every write in the app — lists, notes, highlights, visits — goes to
// POST /api/data/push under the router below.
app.route('/api/lists', listsRouter);
app.route('/api/data', dataRouter);

// What the bare origin is depends on which hostname it was asked for. One Worker answers both
// (see the two routes in wrangler.jsonc): the marketing site serves the static landing page,
// and the app serves the app. "/" is listed in `assets.run_worker_first` so both reach the Worker
// at all rather than being answered by the asset router.
//
// Anything other than these is the app — `app.sutamaya.org` in production, and in local
// development `localhost` and `app.local.sutamaya.org` (see docs/deploy.md). Naming the marketing
// hostnames rather than the app's keeps every development host working without listing them here.
// Each maps to where its app lives, for the redirect below.
const MARKETING_HOSTS = new Map([
  ['sutamaya.org', 'https://app.sutamaya.org'],
  ['www.sutamaya.org', 'https://app.sutamaya.org'],
  ['local.sutamaya.org', 'https://app.local.sutamaya.org'],
]);

app.get('/', async (c) => {
  const marketing = MARKETING_HOSTS.has(new URL(c.req.url).hostname);
  // The landing asset's bytes under the "/" URL — a rewrite, not a redirect, so the page Google
  // indexes and the URL people share are the same one. The app side asks for the shell by its
  // real path for the same reason `html_handling` is "none": that is the path the service worker
  // precached it under.
  const res = await c.env.ASSETS.fetch(new URL(marketing ? '/landing.html' : '/index.html', c.req.url));
  return new Response(res.body, {
    status: res.status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // An hour rather than the immutable year the hashed assets get: neither file's URL ever
      // changes, so a copy in a CDN edge or a browser cache is the only thing standing between an
      // edit and the page people see.
      'Cache-Control': 'public, max-age=3600',
    },
  });
});

// The app's own paths, kept off the marketing hostname. The assets binding backs both hostnames,
// so without this `sutamaya.org/browse/dn` would serve the app there too — signed out, since the
// session cookie belongs to the app's origin, and with its API calls cross-origin. Worse, a
// service worker registering on the marketing hostname would precache the shell and serve it at
// "/", putting the app back over the landing page: the exact failure the two hostnames exist to
// prevent.
//
// Listing sw.js and the manifest is what makes that impossible rather than merely unlikely — an
// install needs both, and neither resolves here. The page paths are listed so an old link still
// arrives somewhere useful, one redirect later.
//
// Every path here is also in `assets.run_worker_first` (wrangler.jsonc); without that the asset
// router answers first and the Worker never sees them. Which means the app's side has to serve
// them from the binding by hand, since a Worker that runs first is the whole response.
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
  return c.env.ASSETS.fetch(c.req.raw);
});

// Every error body is `{error: <snake_case code>}`. Nothing outside the sign-in form displays one —
// the flush reads the status and logs the body — so a code is what a reader of a network log or a
// console error wants. The exception is /api/auth/email/*, whose messages EmailCodeSignIn puts on
// screen verbatim and which are therefore written as sentences.
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'internal_error' }, 500);
});

// An /api path matching no route answers in the same shape as every other error here, rather than
// Hono's plain-text default. Non-/api paths don't normally get this far — `assets.run_worker_first`
// keeps them at the asset router, which serves the SPA shell so deep links resolve (see
// assetRouting.test.js) — so the plain text is only what a misconfiguration would surface.
app.notFound((c) => (c.req.path.startsWith('/api/') ? c.json({ error: 'not_found' }, 404) : c.text('404 Not Found', 404)));

export default app;
