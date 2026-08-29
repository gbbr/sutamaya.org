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
    // A JSON error code from index.js's notFound handler, rather than index.html — which is the
    // thing under test here: the request reached the Worker at all.
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(await res.json()).toEqual({ error: 'not_found' });
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

  // '/' is the one path that must NOT get the SPA shell — it is the static landing page, the only
  // page a search engine can read without rendering the app. Two things have to hold for that, and
  // only one of them is in this file's code: wrangler.jsonc has to list '/' in `run_worker_first`
  // (without it the asset router answers first and `not_found_handling` hands back index.html),
  // and index.js's route has to fetch landing.html from the binding. Either one regressing puts
  // the app shell back at the origin's front door, where nothing but JavaScript is indexable.
  //
  // Asserted on the two things that hold whether web/dist is a real build or the config's
  // placeholders: the Cache-Control header, which only the Worker route sets, and the body being
  // a different document from the shell. Both regressions collapse the two into one response.
  it('serves the static landing page at /, not the SPA shell', async () => {
    const res = await SELF.fetch('https://x/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(res.headers.get('cache-control')).toMatch(/max-age=3600/);

    const shell = await SELF.fetch('https://x/read/dn16');
    expect(await res.text()).not.toBe(await shell.text());
  });
});
