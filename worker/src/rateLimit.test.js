import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import app from './index.js';
import { checkRateLimit } from './rateLimit.js';

// server/src/rateLimiters.test.js doesn't port — it reads each limiter's budget off the
// `RateLimit-Limit` response header, and a Cloudflare Rate Limiting binding emits no such header.
// What that suite was really pinning is which budget applies to which path, since this app has
// already had one production incident from that wiring being order-sensitive. So: the wrapper's
// own decisions here, then the same path-by-path routing check against stub bindings.

// Counts calls and denies once `limit` of them have been made — the shape of the real binding's
// `.limit({key})`, which returns `{success}` and nothing else.
function stubBinding(limit = Infinity) {
  const calls = [];
  return {
    calls,
    async limit({ key }) {
      calls.push(key);
      return { success: calls.length <= limit };
    },
  };
}

describe('checkRateLimit', () => {
  it('allows and consumes budget while the binding says success', async () => {
    const binding = stubBinding(2);
    expect(await checkRateLimit(binding, '203.0.113.7')).toBe(true);
    expect(await checkRateLimit(binding, '203.0.113.7')).toBe(true);
    expect(await checkRateLimit(binding, '203.0.113.7')).toBe(false);
    expect(binding.calls).toEqual(['203.0.113.7', '203.0.113.7', '203.0.113.7']);
  });

  it('keys the budget on whatever it is handed, so distinct IPs are independent', async () => {
    const binding = stubBinding();
    await checkRateLimit(binding, '203.0.113.7');
    await checkRateLimit(binding, '198.51.100.4');
    expect(binding.calls).toEqual(['203.0.113.7', '198.51.100.4']);
  });

  it('allows without consulting anything when no binding is configured', async () => {
    expect(await checkRateLimit(undefined, '203.0.113.7')).toBe(true);
  });

  it('allows without consulting the binding when there is no client IP to key on', async () => {
    const binding = stubBinding(0);
    expect(await checkRateLimit(binding, undefined)).toBe(true);
    expect(binding.calls).toEqual([]);
  });
});

// Stub bindings are injected through app.request()'s env argument rather than exercising the real
// ones from wrangler.jsonc: miniflare simulates those with genuine shared in-memory counters, so
// a test that spent a real budget would leak into every other suite's requests.
function api(path, { method = 'GET', bindings = {}, ip = '203.0.113.7' } = {}) {
  return app.request(path, { method, headers: { 'cf-connecting-ip': ip } }, { ...env, ...bindings });
}

describe('rate limiter routing (which budget applies to which path)', () => {
  it('GET /api/lists draws only from the general budget', async () => {
    const general = stubBinding();
    const auth = stubBinding();
    const me = stubBinding();
    await api('/api/lists', { bindings: { RATE_LIMIT_API: general, RATE_LIMIT_AUTH: auth, RATE_LIMIT_ME: me } });
    expect(general.calls).toHaveLength(1);
    expect(auth.calls).toHaveLength(0);
    expect(me.calls).toHaveLength(0);
  });

  it('GET /api/auth/me draws from the general budget and the /me budget, not the sign-in one', async () => {
    const general = stubBinding();
    const auth = stubBinding();
    const me = stubBinding();
    await api('/api/auth/me', { bindings: { RATE_LIMIT_API: general, RATE_LIMIT_AUTH: auth, RATE_LIMIT_ME: me } });
    expect(general.calls).toHaveLength(1);
    expect(me.calls).toHaveLength(1);
    expect(auth.calls).toHaveLength(0);
  });

  it('POST /api/auth/google draws from the general budget and the sign-in one, not /me', async () => {
    const general = stubBinding();
    const auth = stubBinding();
    const me = stubBinding();
    await api('/api/auth/google', {
      method: 'POST',
      bindings: { RATE_LIMIT_API: general, RATE_LIMIT_AUTH: auth, RATE_LIMIT_ME: me },
    });
    expect(general.calls).toHaveLength(1);
    expect(auth.calls).toHaveLength(1);
    expect(me.calls).toHaveLength(0);
  });

  it('exhausting the sign-in budget does not 429 /api/auth/me — separate budgets', async () => {
    const bindings = { RATE_LIMIT_API: stubBinding(), RATE_LIMIT_AUTH: stubBinding(0), RATE_LIMIT_ME: stubBinding() };
    const blocked = await api('/api/auth/google', { method: 'POST', bindings });
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: 'Too many requests. Please try again in a moment.' });

    const stillOk = await api('/api/auth/me', { bindings });
    expect(stillOk.status).toBe(200);
  });

  it('a denied general budget short-circuits before the per-route one is consumed', async () => {
    const me = stubBinding();
    const res = await api('/api/auth/me', { bindings: { RATE_LIMIT_API: stubBinding(0), RATE_LIMIT_ME: me } });
    expect(res.status).toBe(429);
    expect(me.calls).toHaveLength(0);
  });

  it('is keyed per client IP, so one caller being blocked leaves another alone', async () => {
    // One shared binding whose budget is already spent for the noisy IP; the quiet IP's own
    // bucket is untouched.
    const spent = new Set(['198.51.100.4']);
    const binding = { async limit({ key }) { return { success: !spent.has(key) }; } };
    expect((await api('/api/lists', { ip: '198.51.100.4', bindings: { RATE_LIMIT_API: binding } })).status).toBe(429);
    expect((await api('/api/lists', { ip: '203.0.113.7', bindings: { RATE_LIMIT_API: binding } })).status).not.toBe(429);
  });
});

describe('CORS on /api/*', () => {
  it('echoes the configured web origin with credentials allowed', async () => {
    const res = await app.request(
      '/api/health',
      { headers: { Origin: 'https://sutamaya.org' } },
      { ...env, WEB_ORIGIN: 'https://sutamaya.org' }
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://sutamaya.org');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  it('does not allow an origin other than the configured one', async () => {
    const res = await app.request(
      '/api/health',
      { headers: { Origin: 'https://evil.example' } },
      { ...env, WEB_ORIGIN: 'https://sutamaya.org' }
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('https://evil.example');
  });
});
