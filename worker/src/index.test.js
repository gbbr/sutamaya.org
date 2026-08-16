import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('GET /api/health', () => {
  it('returns 200 with a working DB binding', async () => {
    const res = await SELF.fetch('https://x/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
