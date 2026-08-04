import { createRoot } from 'react-dom/client';
import App from './App';
import { loadUiPrefs, applyUiScale, applyUiFace } from './lib/uiPrefs';
import './index.css';

// Applied synchronously here, before React mounts, so there's no flash of the default
// scale/font before UiPrefsProvider's effects would otherwise catch up — see Settings > UI
// scale/font (SettingsPage.tsx) for where these are actually changed and lib/uiPrefs.ts for
// how each is applied.
const uiPrefs = loadUiPrefs();
applyUiScale(uiPrefs.uiScale);
applyUiFace(uiPrefs.uiFace);

// No <StrictMode> here: @reach/router's Redirect (and its history subscription) relies on
// class-component lifecycle timing that React 18's dev-mode double-invoking breaks — a
// redirect from "/" would silently never fire. See CLAUDE.md "Frontend" for the tradeoff.
createRoot(document.getElementById('root')!).render(<App />);
