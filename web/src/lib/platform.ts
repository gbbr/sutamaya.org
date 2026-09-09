// How the app is running: a browser — tab or installed PWA — or a Capacitor native shell. The one
// place platform branching starts from. main.tsx, api.ts, analytics.ts, pwaNudge.ts and
// localAccount.ts route their platform checks through here, so a native build differs from the web
// build only at these points and never as a parallel code path.

// The platforms the app runs on. Open-ended: 'macos' joins it when that target is added.
export type Platform = 'web' | 'ios' | 'android';

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

// The global Capacitor injects into its WebView before the app's own scripts run. Absent in every
// browser, so each check below reads as 'web' until the native shell exists.
function capacitor(): CapacitorGlobal | undefined {
  return (globalThis as typeof globalThis & { Capacitor?: CapacitorGlobal }).Capacitor;
}

// True inside a Capacitor native shell, false in any browser including an installed PWA.
export function isNativeApp(): boolean {
  return capacitor()?.isNativePlatform?.() === true;
}

// Which platform this is. 'web' covers every browser; the rest are native shells.
export function platformName(): Platform {
  const name = capacitor()?.getPlatform?.();
  return name === 'ios' || name === 'android' ? name : 'web';
}

// True when the app fills the screen with no browser chrome — an installed PWA, or any native
// shell. `display-mode: standalone` covers Android and desktop installs; `navigator.standalone`
// covers iOS/iPadOS Safari, which has neither an install event nor a media query of its own.
export function isStandaloneDisplay(): boolean {
  if (isNativeApp()) return true;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

// The origin the API and the data export live at: empty on web, where the app shares an origin with
// the Worker; the Worker's own origin in a native shell, whose WebView origin is local instead.
// `__API_BASE_OVERRIDE__` (vite.config.ts, from SUTAMAYA_API_BASE) points a native test build at a
// local Worker; it is the empty string in every normal build.
export const API_BASE =
  (typeof __API_BASE_OVERRIDE__ === 'string' && __API_BASE_OVERRIDE__) ||
  (isNativeApp() ? 'https://app.sutamaya.org' : '');
