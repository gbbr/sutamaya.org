import { READER_FACES } from './theme';
import type { AppTheme, ReaderFace } from './types';
import { MOBILE_BREAKPOINT } from '../context/LayoutContext';
import { UI_PREFS_KEY } from './storageKeys';
import { setShellThemeColor } from './themeColor';

// The UI is noticeably smaller by default on a phone than on desktop at the same nominal scale,
// so mobile gets this baked into every applied scale on top of whatever the user's own slider
// says — the slider itself (Settings > UI scale) still shows and controls only the raw
// preference value; this multiplier is never persisted or reflected there.
const MOBILE_UI_SCALE_BOOST = 1.15;

function isMobileViewport(): boolean {
  return window.innerWidth < MOBILE_BREAKPOINT;
}

export interface UiPrefs {
  uiScale: number;
  uiFace: ReaderFace;
  theme: AppTheme;
}

export { UI_PREFS_KEY };
export const UI_PREFS_DEFAULTS: UiPrefs = { uiScale: 1, uiFace: 'system', theme: 'system' };

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
  const effectiveScale = isMobileViewport() ? scale * MOBILE_UI_SCALE_BOOST : scale;
  const root = document.documentElement.style;
  if (supportsZoom()) {
    root.setProperty('zoom', String(effectiveScale));
    root.setProperty('--ui-scale', String(effectiveScale));
  } else {
    // The viewport-meta path already redefines the layout viewport itself, so `100dvh` etc.
    // stay correct without any further compensation — --ui-scale must stay at 1 here, or
    // index.css's <html> height rule would divide by it a second time.
    root.setProperty('--ui-scale', '1');
    const viewport = document.querySelector('meta[name="viewport"]');
    viewport?.setAttribute(
      'content',
      effectiveScale === 1
        ? 'width=device-width, initial-scale=1, viewport-fit=cover'
        : `initial-scale=${effectiveScale}, viewport-fit=cover`
    );
  }
  // Re-measure next frame, once the browser has reflowed against the new initial-scale — and
  // treat whatever visualViewport.scale settles at as the new "resting" scale, since on the
  // viewport-meta fallback path a non-1 UI-scale pref makes that resting value itself != 1 (see
  // restingViewportScale below).
  requestAnimationFrame(() => {
    restingViewportScale = window.visualViewport?.scale ?? 1;
    syncAppHeight();
  });
}

// The visualViewport.scale that counts as "at rest, no real pinch-zoom" for syncAppHeight's
// guard below. On the `zoom`-capable path this is always 1 (applyUiScale never touches the
// viewport meta there). On the viewport-meta fallback path, applyUiScale sets `initial-scale`
// itself, so the resting scale tracks whatever UI-scale is currently in effect instead.
let restingViewportScale = 1;

// Sets --app-height, which index.css's <html> height rule reads instead of `vh`/`dvh` — some
// WebView builds don't recompute those correctly after applyUiScale's viewport-meta path above
// changes the page's scale, but visualViewport.height stays accurate throughout.
//
// Skipped while the user has pinch-zoomed in (visualViewport.scale off its resting value): that
// gesture shrinks visualViewport.height without changing the actual (CSS-pixel) viewport, so
// following it here would shrink <html> to less than the real screen and leave a growing blank
// gap below #root (both are `overflow: hidden`, see index.css) that gets worse the further in
// the user zooms. Freezing --app-height at its last correct value until the user zooms back out
// to the resting scale is what this function is for either way — real viewport changes
// (address-bar show/hide, keyboard) all happen at that resting scale, not at a pinch-zoomed one.
export function syncAppHeight() {
  const scale = window.visualViewport?.scale;
  if (scale != null && Math.abs(scale - restingViewportScale) > 0.01) return;
  const height = window.visualViewport?.height ?? window.innerHeight;
  document.documentElement.style.setProperty('--app-height', `${height}px`);
}

// Overrides the app's `font-serif` utility (titles, Pali, blurbs — see tailwind.config.js,
// which routes it through --ui-serif with today's default as the CSS fallback) with one of the
// same three faces the reader itself offers, for the same reason: a project-wide look, not a
// per-surface one.
export function applyUiFace(face: ReaderFace) {
  document.documentElement.style.setProperty('--ui-serif', READER_FACES[face]);
}

// Also used by ReaderPrefsContext, which tracks the same OS preference for the reader's own
// (separately-persisted) 'system' theme option.
export function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

// Toggles the `dark` class Tailwind's darkMode:'class' (tailwind.config.js) and index.css's
// `:root.dark` var overrides both key off. 'system' resolves against the OS preference at the
// moment this runs — UiPrefsContext re-runs it on a matchMedia change event so a 'system'
// selection keeps tracking the OS live, not just at load/selection time.
export function applyTheme(theme: AppTheme) {
  const dark = theme === 'dark' || (theme === 'system' && systemPrefersDark());
  document.documentElement.classList.toggle('dark', dark);
  // Keeps the desktop PWA title bar / mobile status bar (see lib/themeColor.ts) in sync with the
  // shell theme — the reader's own, separately-themed background takes over this same meta tag
  // while it's open (ReaderPage) and hands it back on close.
  setShellThemeColor(dark);
}
