import type { AppTheme } from './types';
import { UI_PREFS_KEY } from './storageKeys';
import { setShellThemeColor } from './themeColor';

export interface UiPrefs {
  uiScale: number;
  theme: AppTheme;
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
  if (supportsZoom()) {
    root.setProperty('zoom', String(scale));
    root.setProperty('--ui-scale', String(scale));
  } else {
    // `--ui-scale` stays 1 on this path, or index.css's <html> height rule divides by it twice.
    root.setProperty('--ui-scale', '1');
    const viewport = document.querySelector('meta[name="viewport"]');
    viewport?.setAttribute(
      'content',
      scale === 1
        ? 'width=device-width, initial-scale=1, viewport-fit=cover'
        : `initial-scale=${scale}, viewport-fit=cover`
    );
  }
}

// The OS's dark-mode preference, which both 'system' themes resolve against.
export function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

// Applies the shell theme, toggling the `dark` class Tailwind and index.css key off. 'system' is
// accepted because main.tsx applies the raw stored preference before React mounts; UiPrefsContext
// resolves it from then on.
export function applyTheme(theme: AppTheme) {
  const dark = theme === 'dark' || (theme === 'system' && systemPrefersDark());
  document.documentElement.classList.toggle('dark', dark);
  // The OS chrome follows the shell, until the reader takes over the same meta tag.
  setShellThemeColor(dark);
}
