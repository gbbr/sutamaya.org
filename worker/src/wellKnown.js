import { Hono } from 'hono';

// The domain-verification files the native apps' deep links rest on, served from the app hostname
// (`app.sutamaya.org`). Listed in `assets.run_worker_first` (wrangler.jsonc) so the Worker, not the
// asset router, answers them.

// The paths a verified link may open in the app: the app's own screens, and nothing else. `/api/*`
// is outside the set, so the OAuth round trip stays in the browser that started it rather than
// being pulled into the app mid-flow. The same set is written in Android's own syntax in
// web/android/app/src/main/AndroidManifest.xml, which this has to stay in step with.
const DEEP_LINK_PATHS = ['/', '/browse/*', '/read/*', '/settings', '/help'];

// Android App Links: authorises `org.sutamaya.app`, signed by one of these certificates, to open
// the links its manifest claims on this host. The path scoping lives in the manifest — this file
// grants the app the host, and Android has no path syntax for it.
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

// iOS Universal Links: the same paths, as the allow-list of `components` Apple's format takes.
function appleAppSiteAssociation(teamId) {
  return {
    applinks: {
      details: [
        {
          appIDs: [`${teamId}.org.sutamaya.app`],
          components: DEEP_LINK_PATHS.map((path) => ({ '/': path })),
        },
      ],
    },
  };
}

export const wellKnownRouter = new Hono();

wellKnownRouter.get('/assetlinks.json', (c) =>
  c.json(ASSET_LINKS, 200, { 'Cache-Control': 'public, max-age=3600' })
);

// Answers only once `APPLE_TEAM_ID` is set (wrangler.jsonc), which is what makes the app ID real.
// iOS caches the association it fetches, so a placeholder would have to age out of every device
// that had seen it; a 404 leaves the iOS build on its `sutamaya://auth` custom scheme instead.
wellKnownRouter.get('/apple-app-site-association', (c) => {
  const teamId = c.env.APPLE_TEAM_ID;
  if (!teamId) return c.notFound();
  return c.json(appleAppSiteAssociation(teamId), 200, { 'Cache-Control': 'public, max-age=3600' });
});
