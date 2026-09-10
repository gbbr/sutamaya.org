import { Hono } from 'hono';
import { webOrigins } from '../oauth.js';

// Self-hosted over-the-air bundle updates for the native apps. `npm run release:ota` uploads the
// web + corpus bundle as a zip to an R2 bucket and records its version and checksum in the
// OTA_VERSION / OTA_CHECKSUM vars (per environment, so staging and production have separate
// channels). `@capgo/capacitor-updater` in the shell polls `/check`, compares the version against
// the bundle it is running, and downloads the zip when they differ. Touches no D1 and needs no
// session — the bundle is public, like a store download.

export const updatesRouter = new Hono();

// The object key a bundle version is stored under, and the shape `/bundle/:file` accepts back.
const bundleKey = (version) => `sutamaya-${version}.zip`;
const BUNDLE_FILE = /^sutamaya-[A-Za-z0-9._-]+\.zip$/;

// The updater's check. The plugin POSTs a JSON body describing the running bundle; the response
// names the currently published bundle, or is empty when none is published. The plugin compares
// `version` to what it runs by string equality, so an empty body — or the same version — is a
// no-op on the device.
updatesRouter.post('/check', async (c) => {
  const version = c.env.OTA_VERSION;
  const checksum = c.env.OTA_CHECKSUM;
  if (!version || !checksum) return c.json({});

  // Withhold the bundle from a native binary older than the last one this line of web code is
  // safe to run in — a change that needs a new plugin, permission or deep-link path bumps the
  // native build number and OTA_MIN_NATIVE together, and old binaries then wait for a store
  // update instead of pulling a bundle they can't run. Empty OTA_MIN_NATIVE means no floor. The
  // plugin sends `version_code` as the native build number on both platforms; a request that
  // doesn't carry a readable one is treated as below the floor.
  const floor = Number(c.env.OTA_MIN_NATIVE);
  if (floor > 0) {
    const body = await c.req.json().catch(() => ({}));
    const native = Number.parseInt(body.version_code, 10);
    if (!Number.isFinite(native) || native < floor) return c.json({});
  }

  // Built on WEB_ORIGIN — the environment's canonical app origin — not on the request URL, which a
  // dev proxy or preview host can change.
  const [origin] = webOrigins(c.env.WEB_ORIGIN);
  const url = `${origin}/api/updates/bundle/${bundleKey(version)}`;
  return c.json({ version, url, checksum });
});

// The bundle zip, streamed from R2. The filename carries the version, so the body never changes
// and is cached hard — the `no-store` that `/api/*` otherwise carries is lifted for this path in
// worker/src/index.js.
updatesRouter.get('/bundle/:file', async (c) => {
  const file = c.req.param('file');
  if (!BUNDLE_FILE.test(file)) return c.json({ error: 'not_found' }, 404);
  const object = await c.env.OTA_BUCKET.get(file);
  if (!object) return c.json({ error: 'not_found' }, 404);
  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Length': String(object.size),
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
});
