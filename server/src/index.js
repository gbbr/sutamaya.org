import './env.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import compression from 'compression';
import cors from 'cors';
import cookieSession from 'cookie-session';
import rateLimit from 'express-rate-limit';
import { authRouter } from './routes/auth.js';
import { listsRouter } from './routes/lists.js';
import { annotationsRouter } from './routes/annotations.js';
import { dataRouter } from './routes/data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';

const PORT = process.env.PORT || 8787;
const WEB_ORIGIN = process.env.WEB_ORIGIN || 'http://localhost:5173';
const SESSION_SECRET = process.env.SESSION_SECRET || 'sutamaya-dev-secret-change-me';

if (isProd && SESSION_SECRET === 'sutamaya-dev-secret-change-me') {
  throw new Error('SESSION_SECRET must be set in production (see deploy.md).');
}

const app = express();
// Cloud Run sits behind a TLS-terminating proxy; this makes `secure` cookies and
// req.protocol reflect the original HTTPS request instead of the proxy's plain HTTP hop.
app.set('trust proxy', 1);
// gzip everything below — the biggest win is corpus.json/dictionary.json/text/{uid}.json (all
// large JSON, served either via the API in dev or express.static below in production) and
// GET /api/data's response, both of which compress ~70-90% as JSON/text.
app.use(compression());

// Static corpus/dictionary/per-sutta text under /data/ is public, non-sensitive, and the target
// of Settings' "Download all suttas for offline" feature. That feature used to be a deliberate,
// single-user bulk pull of one /data/text/{uid}.json request per sutta (~4000 across the whole
// canon), which is why this budget used to need to be so much looser than generalLimiter's below
// — otherwise the download would blow through it almost immediately, 429ing the rest (each 429
// itself resolves fast, but the circuit breaker in web/src/lib/offline.ts trips after ~18 of them
// and gives up early, which reads as the download hanging). It now instead fetches ~30 shard
// bundles (scripts/build-corpus.mjs's SHARD_TARGET_BYTES) plus one manifest request, so a full
// download plus real headroom (retries, concurrent tabs/devices) is comfortably inside even a
// fairly tight budget — this is sized for that, not for thousands of individual requests.
const dataLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 400,
  standardHeaders: true,
  legacyHeaders: false,
});

// Covers the static SPA shell and general API traffic — generous enough for real browsing
// (including repeat dictionary/text fetches), tight enough to bound what a single IP can pull
// from the uncached-by-bots public assets. /data/ has its own separate, looser budget above.
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith('/data/'),
});

// POST /api/auth/google does real work (verifies the Google ID token against Google's
// servers) and is the one open route besides static files — worth its own tighter cap.
// `skip` excludes /me: it's still mounted under this same '/api/auth' prefix below (Express
// matches it as a substring), but it has its own looser meLimiter and shouldn't also eat
// into this budget.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/me',
});

// GET /api/auth/me is just a session-cookie check, fired once on every page load/PWA
// relaunch (AuthContext.tsx) — sharing authLimiter's 20/15min budget with real Google
// verification meant routine reloads (or a PWA relaunch after reconnecting) could burn
// through it and 429 a *subsequent genuine* sign-in attempt. Its own much looser cap.
const meLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/data', dataLimiter);
app.use(generalLimiter);
app.use('/api/auth/me', meLimiter);
app.use('/api/auth', authLimiter);

app.use(cors({ origin: WEB_ORIGIN, credentials: true }));
app.use(express.json());
app.use(
  cookieSession({
    name: 'sutamaya.sid',
    secret: SESSION_SECRET,
    maxAge: 90 * 24 * 60 * 60 * 1000,
    sameSite: 'lax',
    secure: isProd,
  })
);

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRouter);
app.use('/api/lists', listsRouter);
app.use('/api', annotationsRouter);
app.use('/api/data', dataRouter);

// In production the built SPA ships inside this same container/service (see Dockerfile) —
// simplest possible deploy (one Cloud Run service) and avoids cross-origin cookies entirely.
if (isProd) {
  const webDist = path.join(__dirname, '..', 'web-dist');
  // Vite content-hashes everything under `assets/` (dist/assets/*-[hash].js/css) — a given
  // filename's content never changes, so it's safe to tell the browser to skip revalidation
  // entirely for a year. Everything else served below (index.html, sw.js, workbox-*.js,
  // manifest.webmanifest, icons) is NOT content-hashed and must keep the default short/
  // must-revalidate caching, or a deploy updating index.html's references to a new hashed
  // bundle would go unnoticed by browsers still serving the old index.html from cache.
  app.use('/assets', express.static(path.join(webDist, 'assets'), { maxAge: '1y', immutable: true }));
  app.use(express.static(webDist));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(webDist, 'index.html'));
  });
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'internal_error' });
});

app.listen(PORT, () => {
  console.log(`Sutamaya API listening on http://localhost:${PORT}`);
});
