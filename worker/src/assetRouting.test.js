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

  // The service worker precaches the shell under this exact path and serves it for every in-app
  // navigation, so /index.html has to answer with the shell and not redirect. Cloudflare's default
  // `html_handling` redirects it to '/', whose meaning depends on the hostname it was asked for —
  // and the precache would store whatever came back as the shell.
  it('serves the app shell at /index.html rather than redirecting to /', async () => {
    const res = await SELF.fetch('https://x/index.html', { redirect: 'manual' });
    expect(res.status).toBe(200);

    const shell = await SELF.fetch('https://x/read/dn16');
    expect(await res.text()).toBe(await shell.text());
  });

  // '/' means one thing on the marketing hostname and another on the app's, which is the whole
  // point of running them as separate origins: the landing page has to stay outside the installed
  // app's scope, and a manifest cannot exclude a path. Two things have to hold for the marketing
  // side, and only one of them is in this file's code: wrangler.jsonc has to list '/' in
  // `run_worker_first` (without it the asset router answers first and `not_found_handling` hands
  // back index.html), and index.js's route has to fetch landing.html from the binding. Either one
  // regressing puts the app shell at the origin's front door, where nothing but JavaScript is
  // indexable.
  //
  // Asserted on what holds whether web/dist is a real build or the config's placeholders: the
  // Cache-Control header, which only the Worker route sets, and whether the body is the same
  // document as the shell.
  it('serves the static landing page at / on the marketing hostname', async () => {
    const res = await SELF.fetch('https://sutamaya.org/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(res.headers.get('cache-control')).toMatch(/max-age=3600/);

    const shell = await SELF.fetch('https://sutamaya.org/read/dn16');
    expect(await res.text()).not.toBe(await shell.text());
  });

  it('serves the app shell at / on every other hostname', async () => {
    const res = await SELF.fetch('https://app.sutamaya.org/');
    expect(res.status).toBe(200);

    const shell = await SELF.fetch('https://app.sutamaya.org/read/dn16');
    expect(await res.text()).toBe(await shell.text());
  });

  // The app's paths belong to the app's hostname. Two of these matter more than the rest: without
  // sw.js and the manifest a service worker cannot register on the marketing hostname, and it is a
  // service worker registering there that would put the app's shell back at "/" and bury the
  // landing page.
  it.each(['/browse/dn', '/read/dn16', '/settings', '/help', '/index.html', '/sw.js', '/manifest.webmanifest'])(
    'redirects %s to the app when asked for on the marketing hostname',
    async (path) => {
      const res = await SELF.fetch(`https://sutamaya.org${path}`, { redirect: 'manual' });
      expect(res.status).toBe(301);
      expect(res.headers.get('Location')).toBe(`https://app.sutamaya.org${path}`);
    }
  );

  it('keeps the query string on that redirect', async () => {
    const res = await SELF.fetch('https://sutamaya.org/settings?scrollTo=offline', { redirect: 'manual' });
    expect(res.headers.get('Location')).toBe('https://app.sutamaya.org/settings?scrollTo=offline');
  });

  // The landing page's own files stay put, or the page it is redirecting away from would break.
  it.each(['/favicon-32-v3.png', '/robots.txt', '/sitemap.xml'])('serves %s on the marketing hostname', async (path) => {
    const res = await SELF.fetch(`https://sutamaya.org${path}`, { redirect: 'manual' });
    expect(res.status).toBe(200);
  });

  it('serves those same app paths normally on the app hostname', async () => {
    const res = await SELF.fetch('https://app.sutamaya.org/settings');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
  });
});
