import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { applyRateLimiters } from './rateLimiters.js';

// Pins exactly which limiter (by its `limit` value, read off the RateLimit-Limit header) applies
// to a given path — this app already caused one production incident from this exact wiring being
// order/path-sensitive (see rateLimiters.js's own comments, and CLAUDE.md), so before touching
// the implementation these tests lock in the current routing decisions path-by-path. A fresh app
// (and therefore fresh in-memory limiter state) per test, since express-rate-limit tracks
// counters per limiter instance keyed by IP — supertest requests all appear to come from the
// same IP, so reusing one app across tests would leak remaining-count state between them.
function buildApp() {
  const app = express();
  applyRateLimiters(app);
  app.use((req, res) => res.json({ ok: true, path: req.path }));
  return app;
}

async function limitFor(app, path, opts = {}) {
  const res = await request(app)[opts.method ?? 'get'](path);
  return res.headers['ratelimit-limit'] ? Number(res.headers['ratelimit-limit']) : null;
}

describe('applyRateLimiters (characterization — pins current routing before any refactor)', () => {
  it('GET /data/text/sn1.1.json draws only from dataLimiter (400)', async () => {
    const app = buildApp();
    expect(await limitFor(app, '/data/text/sn1.1.json')).toBe(400);
  });

  it('GET /api/lists draws only from generalLimiter (300)', async () => {
    const app = buildApp();
    expect(await limitFor(app, '/api/lists')).toBe(300);
  });

  it('GET /api/data draws only from generalLimiter (300)', async () => {
    const app = buildApp();
    expect(await limitFor(app, '/api/data')).toBe(300);
  });

  it('GET /api/auth/me draws from meLimiter (120), reporting meLimiter\'s header last', async () => {
    // Both generalLimiter and meLimiter apply here (see rateLimiters.js's comments — generalLimiter
    // has no skip for /api/auth/me, only for /data/*) — express-rate-limit sets the response
    // header once per applicable middleware, so whichever is mounted last wins the header a test
    // can observe. meLimiter is mounted after generalLimiter, so its limit (120) is what shows.
    const app = buildApp();
    expect(await limitFor(app, '/api/auth/me')).toBe(120);
  });

  it('POST /api/auth/google draws from authLimiter (20), not meLimiter', async () => {
    const app = buildApp();
    expect(await limitFor(app, '/api/auth/google', { method: 'post' })).toBe(20);
  });

  it('GET /api/health draws only from generalLimiter (300)', async () => {
    const app = buildApp();
    expect(await limitFor(app, '/api/health')).toBe(300);
  });

  it('meLimiter and authLimiter have independent budgets — exhausting one does not 429 the other', async () => {
    const app = buildApp();
    // authLimiter's budget is 20 — burn through it via POST /api/auth/google.
    for (let i = 0; i < 20; i += 1) {
      const res = await request(app).post('/api/auth/google');
      expect(res.status).not.toBe(429);
    }
    const blocked = await request(app).post('/api/auth/google');
    expect(blocked.status).toBe(429);

    // GET /api/auth/me is unaffected — it's meLimiter's budget (120), not authLimiter's.
    const stillOk = await request(app).get('/api/auth/me');
    expect(stillOk.status).not.toBe(429);
  });
});
