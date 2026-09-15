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
const ANDROID_CERT_FINGERPRINTS = [
  // the local debug keystore (`~/.android/debug.keystore`)
  '7C:90:1B:67:DB:D7:35:E1:4F:F1:86:44:CE:B2:53:22:DE:86:94:4D:1E:28:DC:45:61:7B:3C:9B:A0:4E:DE:0F',
  // the Play upload key
  '76:5F:20:D8:9B:4B:18:EF:9F:A6:52:34:D3:BA:D4:55:9D:35:73:FC:FF:79:51:5B:3E:D7:18:D6:8B:B4:F8:2F',
  // Google Play's signing key: Play Console's Digital Asset Links snippet
  'BF:12:44:F0:C1:F5:65:15:68:D3:5C:63:F8:24:17:C1:FC:EB:DE:D8:43:69:BB:72:7D:89:8B:F6:85:45:04:75',
  // Google Play's signing key: the app signing certificate's Classical tab
  '61:3A:42:EE:91:AB:51:46:3E:DA:C1:73:BE:E6:F9:59:BA:C7:07:96:4E:79:67:C5:D9:25:CA:DC:11:3C:54:E9',
  // Google Play's signing key: the app signing certificate's Post-quantum tab
  'EC:9A:12:2B:F0:9F:45:DE:46:28:6C:63:F2:3A:B9:2E:E7:1C:7A:73:47:05:FC:BE:3A:F9:F1:F0:48:02:C2:E1',
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
