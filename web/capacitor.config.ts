import type { CapacitorConfig } from '@capacitor/cli';

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
  },
};

export default config;
