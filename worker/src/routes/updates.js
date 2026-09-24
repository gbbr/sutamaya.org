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

// The two ways of answering "no update" without the plugin treating the response as a failure. It
// classifies a check by `error` and `kind` and takes a body carrying neither as malformed — it
// logs "Error no url or wrong format" and fires `downloadFailed` on every launch — so a no-op
// answer has to say so explicitly. `up_to_date` is "nothing newer exists", `blocked` "one exists
// but not for this device"; neither counts as a failure or rolls a bundle back.
const upToDate = (c) =>
  c.json({ error: 'no_new_version_available', message: 'No new version available', kind: 'up_to_date' });
// A withheld answer's `error` is `below_min_native` when a store update would bring the bundle in,
// which the app's Settings turns into a link to the store; `update_withheld` otherwise.
const withheld = (c, error, message) => c.json({ error, message, kind: 'blocked' });

// The var holding each platform's minimum native build, by the platform the plugin names.
const MIN_NATIVE_VARS = new Map([
  ['ios', 'OTA_MIN_NATIVE_IOS'],
  ['android', 'OTA_MIN_NATIVE_ANDROID'],
]);

// The updater's check. The plugin POSTs a JSON body describing the running bundle; the response
// names the currently published bundle, or reports no update when none is published. The plugin
// compares `version` to what it runs by string equality, so naming the running version is a no-op
// on the device.
updatesRouter.post('/check', async (c) => {
  const version = c.env.OTA_VERSION;
  const checksum = c.env.OTA_CHECKSUM;
  if (!version || !checksum) return upToDate(c);

  // Withholds the bundle from a native binary below its platform's minimum native build, the oldest
  // build able to run it (docs/native-apps.md's "The minimum native build"). The plugin sends
  // `version_code` as the native build number on both platforms.
  //   an empty minimum              – no minimum
  //   a minimum that isn't a number – withheld from the whole platform
  //   an unreadable build number    – below the minimum
  //   an unknown platform           – withheld, having no minimum to be measured against
  const body = await c.req.json().catch(() => ({}));
  const minVar = MIN_NATIVE_VARS.get(body.platform);
  if (!minVar) return withheld(c, 'update_withheld', 'The request names no known platform.');
  const minNative = Number(c.env[minVar] || 0);
  if (Number.isNaN(minNative)) return withheld(c, 'update_withheld', 'The minimum native build is not a number.');
  if (minNative > 0) {
    const native = Number(body.version_code);
    if (!Number.isFinite(native) || native < minNative) {
      return withheld(c, 'below_min_native', 'This app version is below the minimum native build for the published bundle.');
    }
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
