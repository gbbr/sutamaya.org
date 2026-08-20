import { createRoot } from 'react-dom/client';
import App from './App';
import { loadUiPrefs, applyUiScale, applyUiFace, applyTheme } from './lib/uiPrefs';
import './index.css';

// Applied synchronously here, before React mounts, so there's no flash of the default
// scale/font/theme before UiPrefsProvider's effects would otherwise catch up — see Settings >
// UI scale/font/Theme (SettingsPage.tsx) for where these are actually changed and lib/uiPrefs.ts
// for how each is applied.
const uiPrefs = loadUiPrefs();
applyUiScale(uiPrefs.uiScale);
applyUiFace(uiPrefs.uiFace);
applyTheme(uiPrefs.theme);

// Returning from the background strands iPad Safari on a stale, too-short viewport: it collapses
// its tab bar without telling the page, so `dvh` (index.css's <html> height) keeps resolving
// against the pre-background height and the app renders ~95px short, showing a band of bare
// canvas below it. Safari only recomputes the viewport in response to a *document-level* scroll,
// and `overflow: hidden` on <html> (index.css, so the document itself never scrolls) is what
// denies it one — which is why the bar persists until the user happens to touch the screen.
//
// So give it one: make the document briefly scrollable, scroll a pixel, and put everything back
// on the next frame. Safari then recomputes the viewport, and `dvh` resolves correctly again. The
// restore lands within a frame, which keeps mobile's address-bar hide animation (see index.css's
// `overflow: hidden` comment) from being triggered.
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
