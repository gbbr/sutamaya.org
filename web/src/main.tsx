import { createRoot } from 'react-dom/client';
import App from './App';
import { loadUiPrefs, applyUiScale, applyUiFace, applyTheme, syncAppHeight } from './lib/uiPrefs';
import './index.css';

// Applied synchronously here, before React mounts, so there's no flash of the default
// scale/font/theme before UiPrefsProvider's effects would otherwise catch up — see Settings >
// UI scale/font/Theme (SettingsPage.tsx) for where these are actually changed and lib/uiPrefs.ts
// for how each is applied.
const uiPrefs = loadUiPrefs();
applyUiScale(uiPrefs.uiScale);
applyUiFace(uiPrefs.uiFace);
applyTheme(uiPrefs.theme);

// Keeps --app-height (see lib/uiPrefs.ts) fresh across resizes, orientation changes, and the
// on-screen keyboard opening/closing.
syncAppHeight();
// syncAppHeight's own guard skips updates mid-pinch-zoom (see its comment) so the in-gesture
// frames don't flash a wrong height — but that means the *last* resize event of a gesture, fired
// while the scale is still a hair off its resting value, can get skipped too, stranding
// --app-height at the zoomed frame forever with nothing left to re-trigger a sync. This trailing
// call re-checks once events have stopped for a moment, by which point the scale has settled and
// the guard passes.
let appHeightSettleTimer: ReturnType<typeof setTimeout>;
function onViewportResize() {
  syncAppHeight();
  clearTimeout(appHeightSettleTimer);
  appHeightSettleTimer = setTimeout(syncAppHeight, 200);
}
window.visualViewport?.addEventListener('resize', onViewportResize);
window.addEventListener('resize', onViewportResize);

// No <StrictMode> here: @reach/router's Redirect (and its history subscription) relies on
// class-component lifecycle timing that React 18's dev-mode double-invoking breaks — a
// redirect from "/" would silently never fire. See CLAUDE.md "Frontend" for the tradeoff.
createRoot(document.getElementById('root')!).render(<App />);
