import { HAS_OPENED_SUTTA_KEY, OFFLINE_NUDGE_DISMISSED_KEY, OFFLINE_UPDATE_DISMISSED_KEY } from './storageKeys';

// True once the app is running as an installed/home-screen PWA rather than a regular browser
// tab — `display-mode: standalone` covers Android/desktop Chrome installs, `navigator.standalone`
// covers iOS/iPadOS Safari (which has no install event or media query of its own).
export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function hasOpenedSutta(): boolean {
  try {
    return localStorage.getItem(HAS_OPENED_SUTTA_KEY) === '1';
  } catch {
    return false;
  }
}

export function markSuttaOpened(): void {
  try {
    localStorage.setItem(HAS_OPENED_SUTTA_KEY, '1');
  } catch {
    // storage unavailable — ignore
  }
}

export function isOfflineNudgeDismissed(): boolean {
  try {
    return localStorage.getItem(OFFLINE_NUDGE_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissOfflineNudge(): void {
  try {
    localStorage.setItem(OFFLINE_NUDGE_DISMISSED_KEY, '1');
  } catch {
    // storage unavailable — ignore
  }
}

// The "updated text available" nudge dismisses per dataVersion rather than once and for all: it
// recurs every time the corpus text actually changes, so a boolean would silence every future
// update after the first dismissal.
export function dismissedOfflineUpdateVersion(): string | null {
  try {
    return localStorage.getItem(OFFLINE_UPDATE_DISMISSED_KEY);
  } catch {
    return null;
  }
}

export function dismissOfflineUpdate(version: string): void {
  try {
    localStorage.setItem(OFFLINE_UPDATE_DISMISSED_KEY, version);
  } catch {
    // storage unavailable — ignore
  }
}
