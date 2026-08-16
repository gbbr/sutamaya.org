import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

// Which requests the assets binding answers and which reach the Worker is configuration
// (`assets.run_worker_first` and `assets.not_found_handling` in wrangler.jsonc), not code, so
// nothing else in this suite covers it. These run through SELF, the Worker's real entrypoint,
// which does traverse the asset router; the route suites use Hono's app.request() instead, which
// invokes the app directly and cannot see the asset layer at all.
//
// What `run_worker_first: ["/api/*"]` actually buys is the *client-side routes*, which is not
// obvious: because `main` is set, a request matching no asset already falls through to the Worker
// on its own, so /api/* reaches Hono with or without it. `not_found_handling` is only consulted
// when the Worker is not in the path — so declaring /api/* worker-first is what makes every other
// unmatched path stop at the asset router and get index.html. Remove it and /read/dn16 answers
// 404 from Hono instead of the SPA shell: every deep link and every refresh outside / breaks.
// (Verified by deleting the line and watching the third test below fail.)
describe('asset vs API routing', () => {
  it('answers an unmatched /api path from the Worker, not the SPA shell', async () => {
    const res = await SELF.fetch('https://x/api/definitely-not-a-route');
    // Deliberately not asserting the status: an unmatched /api/* path 401s rather than 404s,
    // because annotationsRouter is mounted at /api and its requireAuth runs before Hono's own 404
    // can. That is incidental to mount order. What matters is that a JSON body came back from the
    // Worker at all, rather than index.html.
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });

  it('serves a static file from the assets binding', async () => {
    const res = await SELF.fetch('https://x/favicon.svg');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/image\/svg/);
  });

  it('falls back to index.html for a client-side route', async () => {
    const res = await SELF.fetch('https://x/read/dn16');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
  });
});
