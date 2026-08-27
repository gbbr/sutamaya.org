import { createRoot } from 'react-dom/client';
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
