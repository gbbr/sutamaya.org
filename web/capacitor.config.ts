import type { CapacitorConfig } from '@capacitor/cli';

// The Worker origin the over-the-air update check is made against — the same origin
// web/src/lib/platform.ts's API_BASE resolves to. SUTAMAYA_API_BASE points a test build at a local
// or staging Worker (it is also what dev:ios / dev:android set); a normal build checks production.
const apiBase = process.env.SUTAMAYA_API_BASE || 'https://app.sutamaya.org';

// Wraps the built web app (web/dist) in the iOS and Android shells under ios/ and android/.
// `npx cap sync` copies the latest dist in; the shells run no service worker (see
// web/vite.config.ts's native build mode) and the bundled corpus is the offline store.
const config: CapacitorConfig = {
  appId: 'org.sutamaya.app',
  appName: 'sutamaya',
  webDir: 'dist',
  plugins: {
    // main.tsx calls SplashScreen.hide() on first paint, handing straight over to the app's own
    // loading screen rather than flashing white. launchAutoHide with a long duration is only a
    // backstop for a launch that never paints.
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 3000,
      backgroundColor: '#171513',
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: true,
      splashImmersive: true,
    },
    // Style is driven from the app theme at runtime (lib/statusBar.ts). Edge-to-edge is the
    // platform default on this Android target and matches iOS under viewport-fit=cover; the shell
    // feeds the safe-area insets the app CSS reads (--safe-* in index.css).
    StatusBar: {
      style: 'DEFAULT',
    },
    // Over-the-air web + corpus updates, self-hosted on the Worker. `atBackground`: a newer bundle
    // is downloaded silently while the app runs and swapped in while it is backgrounded, so the
    // reader meets it on the next cold start with no visible reload. `appReadyTimeout` is the
    // window main.tsx has to call `notifyAppReady()` in before the bundle is judged broken and
    // rolled back. `statsUrl` is emptied to keep the app from posting launch telemetry to Capgo's
    // hosted endpoint — only `updateUrl` is used, and it is ours.
    CapacitorUpdater: {
      updateUrl: `${apiBase}/api/updates/check`,
      autoUpdate: 'atBackground',
      appReadyTimeout: 10000,
      statsUrl: '',
    },
  },
};

export default config;
