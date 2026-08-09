import rateLimit from 'express-rate-limit';

// Mounts all four rate limiters in the exact order/paths this app depends on for correct
// budgeting — see each limiter's own comment for why it exists and rateLimiters.test.js for what
// actually applies to which path. Pulled out of index.js so it's testable without booting the
// whole app (index.js calls app.listen() at import time). The limiters are built fresh inside
// this function (rather than as module-level singletons) so each call — index.js's one real call
// at boot, or one per test case — gets its own independent in-memory counters.
export function applyRateLimiters(app) {
  // Static corpus/dictionary/per-sutta text under /data/ is public, non-sensitive, and the
  // target of Settings' "Download all suttas for offline" feature. That feature used to be a
  // deliberate, single-user bulk pull of one /data/text/{uid}.json request per sutta (~4000
  // across the whole canon), which is why this budget used to need to be so much looser than
  // generalLimiter's below — otherwise the download would blow through it almost immediately,
  // 429ing the rest (each 429 itself resolves fast, but the circuit breaker in
  // web/src/lib/offline.ts trips after ~18 of them and gives up early, which reads as the
  // download hanging). It now instead fetches ~30 shard bundles
  // (scripts/build-corpus.mjs's SHARD_TARGET_BYTES) plus one manifest request, so a full
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
}
