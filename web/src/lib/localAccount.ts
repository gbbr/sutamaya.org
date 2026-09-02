import { randomId } from './ids';
import { KEEP_SAFE_DISMISSED_KEY, LOCAL_USER_KEY } from './storageKeys';

// Identity for a reader who hasn't signed in: an id to file their work under, so the mirror and
// the auto-lists behave as they do for a real account, and signing in adopts the whole thing onto
// the server. The prefix keeps the two namespaces apart, a server id being a UUID.
const LOCAL_PREFIX = 'local-';

// True for an id belonging to a signed-out reader rather than an account.
export function isLocalUserId(id: string | null | undefined): boolean {
  return !!id && id.startsWith(LOCAL_PREFIX);
}

// The id used when localStorage is unavailable, which lasts only as long as the tab.
let sessionFallback: string | null = null;

// The id this device files signed-out work under, minted on first use and stable thereafter.
export function localUserId(): string {
  try {
    const stored = localStorage.getItem(LOCAL_USER_KEY);
    if (stored) return stored;
    const minted = `${LOCAL_PREFIX}${randomId()}`;
    localStorage.setItem(LOCAL_USER_KEY, minted);
    return minted;
  } catch {
    sessionFallback ??= `${LOCAL_PREFIX}${randomId()}`;
    return sessionFallback;
  }
}

// Retires this device's local id and mints a fresh one, giving an empty mirror and resetting the
// "keep this safe" prompt, which is keyed by local id.
export function resetLocalUserId(): string {
  try {
    localStorage.removeItem(LOCAL_USER_KEY);
  } catch {
    // The mint below still produces a usable id for this session.
  }
  sessionFallback = null;
  return localUserId();
}

// True once the "keep this safe" prompt has been dismissed for this local id.
export function isKeepSafeDismissed(localId: string): boolean {
  try {
    return localStorage.getItem(KEEP_SAFE_DISMISSED_KEY) === localId;
  } catch {
    return false;
  }
}

// Dismisses that prompt for this local id.
export function dismissKeepSafe(localId: string): void {
  try {
    localStorage.setItem(KEEP_SAFE_DISMISSED_KEY, localId);
  } catch {
    // storage unavailable — ignore
  }
}

// True on iOS in a browser tab rather than an installed app — the one platform where local-only
// data is genuinely temporary, WebKit evicting a site's storage after about seven days away, with
// a home-screen install as the documented exemption. A heuristic, used only to choose wording: a
// wrong answer shows a more alarming sentence to someone who is safe, never the reverse.
export function isIosBrowserTab(): boolean {
  if (typeof navigator === 'undefined') return false;
  const iosLike =
    /iP(hone|ad|od)/.test(navigator.platform || '') ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ||
    /iPhone|iPad|iPod/.test(navigator.userAgent || '');
  if (!iosLike) return false;
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return !standalone;
}
