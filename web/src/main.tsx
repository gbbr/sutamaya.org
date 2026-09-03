import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { loadUiPrefs, applyUiScale, applyTheme } from './lib/uiPrefs';
import { watchTextSearchIdle } from './lib/textSearch';
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
// mid-read. A no-op in dev unless PWA_DEV=1 (vite.config.ts).
registerSW();

// Releases the search text after the app has been out of sight for a while — see docs/search.md's
// "What it costs the device".
watchTextSearchIdle();

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

// No <StrictMode>: @reach/router's Redirect relies on class-lifecycle timing that React 18's
// dev-mode double-invoke breaks, and a redirect from "/" then silently never fires.
createRoot(document.getElementById('root')!).render(<App />);
