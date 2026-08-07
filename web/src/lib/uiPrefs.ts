import { READER_FACES } from './theme';
import type { AppTheme, ReaderFace } from './types';
import { MOBILE_BREAKPOINT } from '../context/LayoutContext';

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

export const UI_PREFS_KEY = 'sutamaya.uiPrefs';
// 'light' rather than 'system' — the app has only ever rendered light until now, so an existing
// user whose OS happens to be in dark mode shouldn't see it flip the first time this ships; they
// opt into 'dark' or 'system' explicitly from here on.
export const UI_PREFS_DEFAULTS: UiPrefs = { uiScale: 1, uiFace: 'serif', theme: 'light' };

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
}

// Overrides the app's `font-serif` utility (titles, Pali, blurbs — see tailwind.config.js,
// which routes it through --ui-serif with today's default as the CSS fallback) with one of the
// same three faces the reader itself offers, for the same reason: a project-wide look, not a
// per-surface one.
export function applyUiFace(face: ReaderFace) {
  document.documentElement.style.setProperty('--ui-serif', READER_FACES[face]);
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

// Toggles the `dark` class Tailwind's darkMode:'class' (tailwind.config.js) and index.css's
// `:root.dark` var overrides both key off. 'system' resolves against the OS preference at the
// moment this runs — UiPrefsContext re-runs it on a matchMedia change event so a 'system'
// selection keeps tracking the OS live, not just at load/selection time.
export function applyTheme(theme: AppTheme) {
  const dark = theme === 'dark' || (theme === 'system' && systemPrefersDark());
  document.documentElement.classList.toggle('dark', dark);
}
