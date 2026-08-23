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

// CSS `zoom` (desktop Chrome/Edge/Safari) has no effect at all in iOS Safari — the one place
// this setting matters most. Feature-detect rather than guess by user agent: measure whether
// `zoom` actually changed a probe element's rendered size. Where it doesn't, fall back to the
// viewport meta tag's `initial-scale`, which redefines the *layout viewport* itself, so `dvh`/
// `vh` units stay meaningful there. `zoom`, in contrast, only magnifies rendering — it doesn't
// touch `window.innerWidth`/`innerHeight` or what `vh`/`dvh` resolve against — so anything
// sized directly off the viewport (this app's `100dvh` panes) ends up rendered *larger* than
// the actual screen once zoomed, which is what index.css's `--ui-scale`-compensated `<html>`
// height corrects for; see the comment there for the full picture. The probe result is cached
// module-level since it can't change within a session and this runs on every scale adjustment
// (e.g. dragging a Settings slider).
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

// The `--ui-scale` custom property `applyUiScale` sets on `<html>` — read this back wherever
// screen-space pixel values (getBoundingClientRect, getClientRects, pointer events) need
// converting into a CSS length assigned *inside* the zoomed subtree, since `zoom` scales any
// such length again at paint time (see index.css's `100dvh` compensation for the same reason).
// Always 1 outside the `zoom`-support path (see applyUiScale) since nothing needs correcting
// there.
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
    // The viewport-meta path already redefines the layout viewport itself, so `100dvh` etc.
    // stay correct without any further compensation — --ui-scale must stay at 1 here, or
    // index.css's <html> height rule would divide by it a second time.
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

// Also used by ReaderPrefsContext, which tracks the same OS preference for the reader's own
// (separately-persisted) 'system' theme option.
export function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

// Toggles the `dark` class Tailwind's darkMode:'class' (tailwind.config.js) and index.css's
// `:root.dark` var overrides both key off. 'system' is still accepted because main.tsx applies
// the raw stored preference before React mounts; from then on UiPrefsContext resolves it against
// its own live matchMedia tracking and passes 'light'/'dark' straight through.
export function applyTheme(theme: AppTheme) {
  const dark = theme === 'dark' || (theme === 'system' && systemPrefersDark());
  document.documentElement.classList.toggle('dark', dark);
  // Keeps the desktop PWA title bar / mobile status bar (see lib/themeColor.ts) in sync with the
  // shell theme — the reader's own, separately-themed background takes over this same meta tag
  // while it's open (ReaderPage) and hands it back on close.
  setShellThemeColor(dark);
}
