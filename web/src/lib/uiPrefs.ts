import type { AppTheme } from './types';
import { UI_PREFS_KEY } from './storageKeys';
import { setShellThemeColor } from './themeColor';

export interface UiPrefs {
  uiScale: number;
  theme: AppTheme;
}

export { UI_PREFS_KEY };
export const UI_PREFS_DEFAULTS: UiPrefs = { uiScale: 1, theme: 'system' };

export function loadUiPrefs(): UiPrefs {
  try {
    const raw = localStorage.getItem(UI_PREFS_KEY);
    return raw ? { ...UI_PREFS_DEFAULTS, ...JSON.parse(raw) } : UI_PREFS_DEFAULTS;
  } catch {
    return UI_PREFS_DEFAULTS;
  }
}

// CSS `zoom` (desktop Chrome/Edge/Safari) has no effect in iOS Safari, so it is feature-detected
// rather than guessed by user agent: measure whether `zoom` actually changed a probe element's
// rendered size. Where it doesn't, fall back to the viewport meta tag's `initial-scale`, which
// redefines the layout viewport itself and so keeps `vh`/`dvh` meaningful. `zoom` only magnifies
// rendering — it leaves `window.innerHeight` and what `dvh` resolves against untouched — so this
// app's `100dvh` panes render larger than the screen once zoomed, which index.css's
// `--ui-scale`-compensated `<html>` height corrects for. Cached module-level: the answer can't
// change within a session, and this runs on every scale adjustment.
let zoomSupported: boolean | null = null;
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

// The `--ui-scale` custom property `applyUiScale` sets on `<html>`. Read it back wherever a
// screen-space pixel value (getBoundingClientRect, getClientRects, pointer events) becomes a CSS
// length assigned inside the zoomed subtree, since `zoom` scales such a length again at paint time.
// Always 1 outside the `zoom` path, where nothing needs correcting.
export function getUiScale(): number {
  if (typeof document === 'undefined') return 1;
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale'));
  return v > 0 ? v : 1;
}

export function applyUiScale(scale: number) {
  const root = document.documentElement.style;
  if (supportsZoom()) {
    root.setProperty('zoom', String(scale));
    root.setProperty('--ui-scale', String(scale));
  } else {
    // This path redefines the layout viewport itself, so `100dvh` stays correct without further
    // compensation — `--ui-scale` must stay 1 here, or index.css's <html> height rule divides by it
    // a second time.
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

// Also used by ReaderPrefsContext, for the reader's own separately-persisted 'system' theme option.
export function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

// Toggles the `dark` class that Tailwind's darkMode:'class' (tailwind.config.js) and index.css's
// `:root.dark` var overrides both key off. 'system' is accepted because main.tsx applies the raw
// stored preference before React mounts; from then on UiPrefsContext resolves it against its own
// live matchMedia tracking and passes 'light'/'dark' straight through.
export function applyTheme(theme: AppTheme) {
  const dark = theme === 'dark' || (theme === 'system' && systemPrefersDark());
  document.documentElement.classList.toggle('dark', dark);
  // Keeps the desktop PWA title bar / mobile status bar (lib/themeColor.ts) in sync with the shell
  // theme. The reader's own themed background takes over the same meta tag while it is open and
  // hands it back on close.
  setShellThemeColor(dark);
}
