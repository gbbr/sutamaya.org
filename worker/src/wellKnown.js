import { Hono } from 'hono';

// The domain-verification files the native apps' deep links rest on, served from the app hostname
// (`app.sutamaya.org`). Listed in `assets.run_worker_first` (wrangler.jsonc) so the Worker, not the
// asset router, answers them.

// Android App Links: authorises `org.sutamaya.app`, signed by one of these certificates, to open
// every `https://app.sutamaya.org/...` link — the OAuth return included, so the deep link no longer
// rides an unverified custom scheme. `/api/*` is not excluded here: Android has no path filter in
// this file and those URLs are never user-facing links.
//
// Fingerprints, in order: the local debug keystore (`~/.android/debug.keystore`). The Play upload
// and Play-managed signing certificates get appended when the app is set up for the store.
const ANDROID_CERT_FINGERPRINTS = [
  '7C:90:1B:67:DB:D7:35:E1:4F:F1:86:44:CE:B2:53:22:DE:86:94:4D:1E:28:DC:45:61:7B:3C:9B:A0:4E:DE:0F',
];

const ASSET_LINKS = [
  {
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: 'org.sutamaya.app',
      sha256_cert_fingerprints: ANDROID_CERT_FINGERPRINTS,
    },
  },
];

// iOS Universal Links need `/.well-known/apple-app-site-association` here too, with an
// `applinks.details[].appIDs` of `<TeamID>.org.sutamaya.app` and `components` excluding `/api/*`.
// It is deliberately not served yet: it needs the enrolled Apple Team ID, and iOS caches a wrong
// association. Until then the iOS build returns on the `sutamaya://auth` custom scheme.

export const wellKnownRouter = new Hono();

wellKnownRouter.get('/assetlinks.json', (c) =>
  c.json(ASSET_LINKS, 200, { 'Cache-Control': 'public, max-age=3600' })
);
