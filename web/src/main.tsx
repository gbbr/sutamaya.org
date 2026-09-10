import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { isNativeApp } from './lib/platform';
import { hydrateNativeToken } from './lib/nativeAuth';
import { hideNativeSplash } from './lib/splash';
import { notifyBundleReady } from './lib/otaUpdate';
import { loadUiPrefs, applyUiScale, applyTheme } from './lib/uiPrefs';
import { loadAnalytics } from './lib/analytics';
// Side-effect import: binds window.__dangerWipeLocal, the console-only reset to a cold, signed-out
// first run. See lib/localWipe.ts.
import './lib/localWipe';
import './index.css';

// The stored scale and theme, applied before React mounts so the page never flashes at the
// defaults. UiPrefsProvider keeps them in step from there.
const uiPrefs = loadUiPrefs();
applyUiScale(uiPrefs.uiScale);
applyTheme(uiPrefs.theme);

// Registers the service worker that serves the whole app — shell, bundles, fonts, corpus tree —
// from the device. The plugin's helper supplies the acting half of `registerType: 'autoUpdate'`:
// once a new build has installed in full, it reloads the page once. Updates are looked for only at
// registration, on the window's `load` event, so that reload lands seconds into a launch and never
// mid-read. A no-op in dev unless PWA_DEV=1 (vite.config.ts). Skipped in a native shell, whose
// build ships no service worker — the bundled assets are the offline store there.
if (!isNativeApp()) registerSW();

// Cloudflare Web Analytics, injected once the load event is behind us. Deliberately not a <script>
// in index.html: it is the only thing on the startup path the precache doesn't serve, and a lossy
// network stalled the whole launch behind it. See lib/analytics.ts.
loadAnalytics();

// Forces iPad Safari to recompute its viewport on return from the background, where it collapses
// its tab bar without telling the page and leaves `dvh` resolving ~95px short. Only a
// document-level scroll prompts a recompute, and index.css denies the document one, so this makes
// it briefly scrollable, scrolls a pixel, and restores everything on the next frame — within a
// frame, so mobile's address-bar animation never triggers.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const html = document.documentElement;
  const overflow = html.style.overflow;
  html.style.overflow = 'auto';
  html.style.height = '200%';
  window.scrollTo(0, 1);
  requestAnimationFrame(() => {
    window.scrollTo(0, 0);
    html.style.overflow = overflow;
    html.style.height = '';
  });
});

// On native the session is a stored bearer token. Its load runs alongside the first render rather
// than gating it — AuthContext awaits it before the session check, and it always settles. Inert
// on web, which authenticates by cookie.
if (isNativeApp()) void hydrateNativeToken();

// No <StrictMode>: @reach/router's Redirect relies on class-lifecycle timing that React 18's
// dev-mode double-invoke breaks, and a redirect from "/" then silently never fires.
createRoot(document.getElementById('root')!).render(<App />);

// Hands the native launch splash over to the app's own loading screen once React has painted.
hideNativeSplash();

// Tells the updater plugin the running bundle booted, so an over-the-air update isn't rolled back
// as broken. Inert on web.
notifyBundleReady();
