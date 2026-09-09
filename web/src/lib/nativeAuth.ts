import { Preferences } from '@capacitor/preferences';
import { isNativeApp } from './platform';

// The bearer token a Capacitor build sends in place of the session cookie (see api.ts): a
// cross-origin WebView fetch carries no cookie, so the session travels in an Authorization header.
// It is kept in the platform's own key-value store — UserDefaults on iOS, SharedPreferences on
// Android — inside the app's container, alongside the mirror it authenticates, and mirrored in
// memory so request() can read it without awaiting. Every function is inert on the web build,
// where nothing ever writes to it.
//
// The plugin is imported statically: a Capacitor plugin behind a dynamic import deadlocks in the
// WebView, its chunk never resolving.

const STORAGE_KEY = 'session_token';

// How long a storage call may take before it is given up on: no storage call may block the first
// render or a sign-in.
const STORAGE_TIMEOUT_MS = 3000;

let inMemory: string | null = null;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('storage timeout')), ms)),
  ]);
}

// Started once; hydrateNativeToken() returns this same promise on every call, and it always
// resolves — a storage error or timeout just leaves the token null.
let hydration: Promise<void> | null = null;

// Reads the stored token into memory. Kicked off at startup and awaited by the session check
// before its first request, so getNativeToken() is accurate by the time it matters.
export function hydrateNativeToken(): Promise<void> {
  if (hydration) return hydration;
  hydration = (async () => {
    if (!isNativeApp()) return;
    try {
      const { value } = await withTimeout(Preferences.get({ key: STORAGE_KEY }), STORAGE_TIMEOUT_MS);
      inMemory = typeof value === 'string' ? value : null;
    } catch {
      inMemory = null;
    }
  })();
  return hydration;
}

// The current bearer token, or null. Synchronous: request() builds a header from it on every call.
export function getNativeToken(): string | null {
  return inMemory;
}

// Persists a token from a completed sign-in, or a re-minted one the server returned on
// X-Session-Token. Inert on web, so callers need no platform guard of their own.
export async function setNativeToken(token: string): Promise<void> {
  if (!isNativeApp()) return;
  inMemory = token;
  try {
    await withTimeout(Preferences.set({ key: STORAGE_KEY, value: token }), STORAGE_TIMEOUT_MS);
  } catch {
    // The in-memory copy still carries the session for the rest of this run.
  }
}

// Drops the token on sign-out, account deletion, or a device reset.
export async function clearNativeToken(): Promise<void> {
  inMemory = null;
  if (!isNativeApp()) return;
  try {
    await withTimeout(Preferences.remove({ key: STORAGE_KEY }), STORAGE_TIMEOUT_MS);
  } catch {
    // ignore
  }
}
