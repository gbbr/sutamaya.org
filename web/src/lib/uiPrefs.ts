import { READER_FACES } from './theme';
import type { ReaderFace } from './types';

export interface UiPrefs {
  uiScale: number;
  uiFace: ReaderFace;
}

export const UI_PREFS_KEY = 'sutamaya.uiPrefs';
export const UI_PREFS_DEFAULTS: UiPrefs = { uiScale: 1, uiFace: 'serif' };

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
      scale === 1 ? 'width=device-width, initial-scale=1, viewport-fit=cover' : `initial-scale=${scale}, viewport-fit=cover`
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
