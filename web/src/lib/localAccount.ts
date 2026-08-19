import { randomId } from './ids';
import { KEEP_SAFE_DISMISSED_KEY, LOCAL_USER_KEY } from './storageKeys';

// Identity for a reader who hasn't signed in.
//
// The offline mirror already treats the local write as the durable one (docs/offline-sync.md), so
// the only thing a signed-out user was ever missing is an id to file that work under. This mints
// one. Everything downstream — the mirror, its IndexedDB record, the auto-lists — then works
// exactly as it does for a real account, and signing in adopts the whole thing onto the server
// (see adoptMirror in lib/mirror.ts).
//
// The prefix is what tells the two apart. Server ids are `crypto.randomUUID()` (worker/src/auth.js),
// which can never start with a letter run like this, so the namespaces can't collide.
const LOCAL_PREFIX = 'local-';

export function isLocalUserId(id: string | null | undefined): boolean {
  return !!id && id.startsWith(LOCAL_PREFIX);
}

// The id this device files signed-out work under, minted on first use and stable thereafter — a
// reload has to land on the same mirror, or every note made before it would be orphaned. Where
// localStorage is unavailable the id is per-session rather than persistent: the work still exists
// for as long as the tab does, which is the same bargain lib/mirrorDb.ts makes for storage.
let sessionFallback: string | null = null;

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

// Retires the current local id and mints a fresh one. Called on sign-out, where the point is that
// this device is no longer carrying the previous session's work: a new namespace means an empty
// mirror, and it resets the "keep this safe" prompt (keyed by local id) for whatever the user does
// next.
export function resetLocalUserId(): string {
  try {
    localStorage.removeItem(LOCAL_USER_KEY);
  } catch {
    // ignore — the mint below still produces a usable id for this session
  }
  sessionFallback = null;
  return localUserId();
}

export function isKeepSafeDismissed(localId: string): boolean {
  try {
    return localStorage.getItem(KEEP_SAFE_DISMISSED_KEY) === localId;
  } catch {
    return false;
  }
}

export function dismissKeepSafe(localId: string): void {
  try {
    localStorage.setItem(KEEP_SAFE_DISMISSED_KEY, localId);
  } catch {
    // storage unavailable — ignore
  }
}

// iOS/iPadOS WebKit running in a browser tab rather than as an installed app.
//
// This is the one platform where local-only data is genuinely temporary: Safari's storage policy
// evicts all script-writable storage — IndexedDB included — for a site not visited in about seven
// days, and a home-screen install is the documented exemption. Every browser on iOS is WebKit, so
// Chrome and Firefox there are subject to it too.
//
// iPadOS 13+ reports itself as "MacIntel", which is why the touch-point count is part of the test:
// a real Mac reports 0. The check is a heuristic and Apple's exact rules are undocumented, so it
// is used only to choose *wording* — the wrong answer shows a slightly more alarming sentence to
// someone who is safe, never the reverse.
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
