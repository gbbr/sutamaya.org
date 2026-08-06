import './env.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
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

// Covers the static SPA/data files and general API traffic — generous enough for
// real browsing (including repeat dictionary/text fetches), tight enough to bound
// what a single IP can pull from the uncached-by-bots public assets.
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

// /api/auth does real work (verifies the Google ID token against Google's servers)
// and is the one open route besides static files — worth its own tighter cap.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(generalLimiter);
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
