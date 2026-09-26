import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('GET /api/health', () => {
  it('returns 200 with a working DB binding', async () => {
    const res = await SELF.fetch('https://x/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('/api/* caching', () => {
  // Signing out deletes this device's copy of the account's data, but the browser's HTTP cache is
  // storage the app can't reach — so nothing under /api/* may be kept there.
  it('tells the browser to keep no copy of an API response', async () => {
    const res = await SELF.fetch('https://x/api/auth/me');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});
