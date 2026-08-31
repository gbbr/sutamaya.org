import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { loadUiPrefs, applyUiScale, applyTheme } from './lib/uiPrefs';
// Side-effect import: binds window.__dangerWipeLocal, the console-only reset to a cold, signed-out
// first run. See lib/localWipe.ts.
import './lib/localWipe';
import './index.css';

// Applied synchronously before React mounts, so there is no flash of the default scale or theme
// before UiPrefsProvider's effects catch up. Settings changes them (SettingsPage.tsx);
// lib/uiPrefs.ts applies them.
const uiPrefs = loadUiPrefs();
applyUiScale(uiPrefs.uiScale);
applyTheme(uiPrefs.theme);

// The service worker holds the whole app — shell, bundles, fonts, the corpus tree — so a returning
// reader always renders from the copy already on their device. Registering through the plugin's own
// helper (rather than by hand) is what supplies the acting half of `registerType: 'autoUpdate'`:
// once a new build has downloaded and installed in full, this reloads the page once, served
// entirely from local storage. Without it the new build only appears at the launch *after* the one
// that fetched it, which leaves an installed app — the kind that resumes rather than restarts —
// showing an old version for as long as it is never cold-started.
//
// An update is looked for only at registration, which is on the window's `load` event, so the
// reload lands seconds into a launch and never mid-read. It costs the reader nothing but a flash:
// the sutta and its scroll offset are restored across a reload (hooks/useScrollMemory.ts). Offline,
// nothing is found and nothing reloads. A no-op in dev unless PWA_DEV=1 (see vite.config.ts).
registerSW();

// Returning from the background strands iPad Safari on a stale, too-short viewport: it collapses
// its tab bar without telling the page, so `dvh` (index.css's <html> height) keeps resolving
// against the pre-background height and the app renders ~95px short, with a band of bare canvas
// below it. Safari only recomputes the viewport in response to a document-level scroll, which
// `overflow: hidden` on <html> denies it.
//
// So give it one: make the document briefly scrollable, scroll a pixel, and put everything back on
// the next frame. Safari recomputes the viewport and `dvh` resolves correctly again. The restore
// lands within a frame, which keeps mobile's address-bar hide animation from being triggered.
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

// No <StrictMode> here: @reach/router's Redirect (and its history subscription) relies on
// class-component lifecycle timing that React 18's dev-mode double-invoking breaks — a
// redirect from "/" would silently never fire. See CLAUDE.md "Frontend" for the tradeoff.
createRoot(document.getElementById('root')!).render(<App />);
