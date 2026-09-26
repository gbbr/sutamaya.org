import type { Theme } from '../types';
import { READER_PREFS_KEY, UI_PREFS_KEY } from '../storageKeys';
import { setShellThemeColor } from './themeColor';

export interface UiPrefs {
  uiScale: number;
  theme: Theme;
}

export { UI_PREFS_KEY };
export const UI_PREFS_DEFAULTS: UiPrefs = { uiScale: 1, theme: 'system' };

// The app shell's UI scale and theme, and how each is applied to the document.
//
// Scale goes through CSS `zoom` where the browser supports it, and through the viewport meta tag's
// `initial-scale` where it doesn't — iOS Safari. The two differ in what they do to the viewport:
// `zoom` only magnifies rendering, leaving `dvh` resolving against the unzoomed screen, which
// index.css corrects for using `--ui-scale`; `initial-scale` redefines the layout viewport itself,
// so `--ui-scale` stays 1 on that path.
//
// The viewport path pins `minimum-scale` and `maximum-scale` to the same value, making the chosen
// scale the only zoom the page can have. iOS otherwise zooms the page itself — into a focused field
// whose text renders under 16px, or on a double-tap — and from then on keeps that zoom through a
// rotation or a new `initial-scale`, leaving the page zoomed in. The native shell has no pinch
// gesture to undo it. A Safari tab still allows pinch-zoom over the lock, as Safari does on every
// page for accessibility.

// moveReaderTheme folds a theme stored with the reader's prefs into the app's one theme. A pinned
// reader theme wins over the app's, since it is the one on screen while reading; 'system' defers.
export function moveReaderTheme() {
  try {
    const reader = JSON.parse(localStorage.getItem(READER_PREFS_KEY) ?? 'null');
    if (!reader || !('theme' in reader)) return;
    const { theme, ...rest } = reader;
    if (theme !== 'system') localStorage.setItem(UI_PREFS_KEY, JSON.stringify({ ...loadUiPrefs(), theme }));
    localStorage.setItem(READER_PREFS_KEY, JSON.stringify(rest));
  } catch {
    // storage unavailable — ignore
  }
}

// The stored scale and theme, or the defaults.
export function loadUiPrefs(): UiPrefs {
  try {
    const raw = localStorage.getItem(UI_PREFS_KEY);
    return raw ? { ...UI_PREFS_DEFAULTS, ...JSON.parse(raw) } : UI_PREFS_DEFAULTS;
  } catch {
    return UI_PREFS_DEFAULTS;
  }
}

// Whether CSS `zoom` works here, cached for the session.
let zoomSupported: boolean | null = null;

// Feature-detects `zoom` by measuring a probe element, rather than guessing by user agent.
function supportsZoom(): boolean {
  if (zoomSupported != null) return zoomSupported;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;width:100px;';
  probe.style.setProperty('zoom', '2');
  document.body.appendChild(probe);
  zoomSupported = probe.getBoundingClientRect().width > 150;
  probe.remove();
  return zoomSupported;
}

// The `--ui-scale` on `<html>`, to divide by wherever a screen-space measurement becomes a CSS
// length inside the zoomed subtree, which `zoom` would scale a second time. Always 1 off that path.
export function getUiScale(): number {
  if (typeof document === 'undefined') return 1;
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale'));
  return v > 0 ? v : 1;
}

// Applies the UI scale to the document, by whichever of the two paths this browser supports.
export function applyUiScale(scale: number) {
  const root = document.documentElement.style;
  // Keeps index.css's safe-area insets at the screen's own size, on either path.
  root.setProperty('--inset-scale', String(scale));
  if (supportsZoom()) {
    root.setProperty('zoom', String(scale));
    root.setProperty('--ui-scale', String(scale));
  } else {
    // `--ui-scale` stays 1 on this path, or index.css's <html> height rule divides by it twice.
    root.setProperty('--ui-scale', '1');
    const locked = `initial-scale=${scale}, minimum-scale=${scale}, maximum-scale=${scale}, viewport-fit=cover`;
    const viewport = document.querySelector('meta[name="viewport"]');
    viewport?.setAttribute('content', scale === 1 ? `width=device-width, ${locked}` : locked);
  }
}

// The OS's dark-mode preference, which both 'system' themes resolve against.
export function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

// Applies the theme to the shell, toggling the `dark` class Tailwind and index.css key off; sepia
// shows as light. 'system' is accepted because main.tsx applies the raw stored preference before
// React mounts; UiPrefsContext resolves it from then on.
export function applyTheme(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && systemPrefersDark());
  document.documentElement.classList.toggle('dark', dark);
  // The OS chrome follows the shell, until the reader takes over the same meta tag.
  setShellThemeColor(dark);
}
