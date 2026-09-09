import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { navigate } from '@reach/router';
import { App } from '@capacitor/app';
import { authApi } from '../lib/api';
import { isRetryable, retryWithBackoff, statusOf } from '../lib/retry';
import { readLastUser, writeLastUser } from '../lib/lastUser';
import { localUserId, resetLocalUserId } from '../lib/localAccount';
import { deleteMirror } from '../lib/mirrorDb';
import { API_BASE, isNativeApp } from '../lib/platform';
import { clearNativeToken, hydrateNativeToken, setNativeToken } from '../lib/nativeAuth';
import type { User } from '../lib/types';

// Delay before retrying a transient session check, held above the Worker's 60s rate-limit period.
const SESSION_RETRY_MS = 65_000;

// The custom-scheme URL the native Google flow returns to, carrying `?token=` or `?error=1`. Kept
// in step with worker/src/routes/auth.js and the scheme registered in web/ios and web/android.
const APP_AUTH_LINK = 'sutamaya://auth';

// How long the button keeps its pending look after the browser sheet closes. Cosmetic only — the
// deep link decides the outcome — and it exists so the button doesn't flick back to idle in the
// moment between the sheet closing and the return landing.
const SHEET_SETTLE_MS = 400;

interface AuthState {
  user: User | null;
  loading: boolean;
  // Whether there is a real session behind `user`; read it where the call needs the server.
  isSignedIn: boolean;
  // Whose data the app reads and writes: the signed-in account, or this device's local id
  // (lib/localAccount.ts). Never null.
  dataUserId: string;
  // This device's signed-out id, whether or not it is the one in use — sign-in looks for the mirror
  // it left behind (UserDataContext's adoption) after `dataUserId` has moved on to the account.
  localUserId: string;
  authError: string | null;
  // Native only: a Google sign-in is in flight — the browser sheet is open, or its return is being
  // turned into a session. Always false on web, where signing in is a page navigation.
  signingIn: boolean;
  promptGoogleSignIn: () => void;
  // Native only: opens the Google round trip in the system browser (Google blocks OAuth in a
  // WebView). It resolves once the browser is open, not when the flow ends — the deep-link
  // listener below owns the outcome. A no-op on web, which uses the plain redirect link in
  // GoogleSignInButton.
  signInWithGoogleNative: (returnTo?: string) => Promise<void>;
  requestEmailCode: (email: string) => Promise<void>;
  signInWithEmailCode: (email: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  // Erases the account on the server, then this device's copy of it.
  deleteAccount: () => Promise<void>;
  // Drops this device's copy of the account without touching the server — for a device that has
  // learnt the account is already gone (UserDataContext's flush). `accountId` names the mirror to
  // delete, for a caller that knows it better than this context does.
  forgetAccount: (accountId?: string) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

function authErrorMessage(marker: string | null): string | null {
  return marker ? 'Sign-in did not complete. Please try again.' : null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // The signed-in user, seeded from the last confirmed session (lib/lastUser.ts) so a relaunch with
  // no network opens their own mirror. The server's answer replaces it in either direction.
  const [user, setUser] = useState<User | null>(readLastUser);
  const [loading, setLoading] = useState(true);
  // This device's signed-out identity, in state so retiring it at sign-out re-renders everything
  // reading `dataUserId`.
  const [localId, setLocalId] = useState(localUserId);
  // A failed sign-in, read from the ?auth_error=<reason> the OAuth callback redirects with
  // (worker/src/routes/auth.js), since a full-page round trip leaves no promise to reject. Seeded
  // from the URL the app booted on and stripped below.
  const [authError, setAuthError] = useState<string | null>(() =>
    authErrorMessage(new URLSearchParams(window.location.search).get('auth_error'))
  );
  // Native Google sign-in in flight, from the moment the browser opens to the moment its return
  // has been turned into a session.
  const [signingIn, setSigningIn] = useState(false);
  // Where the sign-in that opened the browser wants to end up. Held here rather than closed over,
  // since the return is handled by a listener that outlives the call.
  const pendingReturnTo = useRef<string | undefined>(undefined);
  // The Browser plugin, kept from the sign-in that opened the sheet so the return can close it.
  // Null when the return arrives on a cold start, where there is no sheet left to close — and the
  // plugin must not be imported there, a dynamic plugin import on the startup path deadlocking the
  // WebView.
  const browserRef = useRef<{ close: () => Promise<void> } | null>(null);
  // True while a return is being turned into a session, so the browser sheet closing underneath it
  // doesn't clear the pending state early.
  const completing = useRef(false);
  // The last return acted on. A cold-started return arrives twice — once as the launch URL, once
  // on the listener — and signing in twice would fetch and navigate twice.
  const handledAuthUrl = useRef<string | null>(null);

  useEffect(() => {
    if (!authError) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has('auth_error')) return;
    url.searchParams.delete('auth_error');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, [authError]);

  useEffect(() => {
    // Loads the session. A signed-out session answers 200 with `{ user: null }`, so anything thrown
    // here is transient and retried on a slow loop; `loading` clears after the first attempt either
    // way, rather than holding a spinner.
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function loadUser() {
      try {
        // On native the bearer token has to be in hand before the first request carries it; this
        // resolves at once on web and is time-boxed on native.
        await hydrateNativeToken();
        const r = await retryWithBackoff(() => authApi.me());
        // The remembered identity follows the server exactly, including to null.
        writeLastUser(r.user);
        if (!cancelled) setUser(r.user);
      } catch (err) {
        if (cancelled) return;
        if (isRetryable(statusOf(err))) {
          // Nothing here says the session is over, so the remembered user stands.
          console.warn('Session check failed transiently; retrying:', err);
          timer = setTimeout(loadUser, SESSION_RETRY_MS);
          return;
        }
        console.error('Failed to load session:', err);
        writeLastUser(null);
        setUser(null);
      }
    }
    loadUser().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  // Sends a signed-out reader to Settings' sign-in section, carrying where they were as `returnTo`
  // for the OAuth round trip to come back to. Captured here, before the URL becomes /settings.
  const promptGoogleSignIn = useCallback(() => {
    const returnTo = window.location.pathname + window.location.search;
    navigate('/settings', { state: { scrollTo: 'auth', returnTo } });
  }, []);

  // Turns a `sutamaya://auth` return into a session. The token it carries is valid whenever it
  // lands, so this is not scoped to the sign-in that started the flow: a return that arrives after
  // the browser sheet has closed, or that cold-starts the app the OS killed while the sheet was
  // open, still signs the reader in.
  const completeNativeSignIn = useCallback(async (url: string) => {
    if (handledAuthUrl.current === url) return;
    handledAuthUrl.current = url;

    void browserRef.current?.close().catch(() => {});
    browserRef.current = null;
    const returnTo = pendingReturnTo.current;
    pendingReturnTo.current = undefined;

    const token = new URL(url).searchParams.get('token');
    if (!token) {
      setSigningIn(false);
      setAuthError(authErrorMessage('1'));
      return;
    }

    completing.current = true;
    // Set again rather than assumed: a cold-started return has no sign-in behind it to have set it.
    setSigningIn(true);
    setAuthError(null);
    await setNativeToken(token);
    try {
      const { user } = await retryWithBackoff(() => authApi.me());
      writeLastUser(user);
      setUser(user);
      if (returnTo) navigate(returnTo);
    } catch (err) {
      // The token is stored and good — this is the account's details failing to arrive, not the
      // sign-in. The session check picks them up on the next launch.
      console.error('Signed in, but the account could not be loaded:', err);
      setAuthError('Signed in, but your account could not be loaded. Check your connection.');
    } finally {
      completing.current = false;
      setSigningIn(false);
    }
  }, []);

  // Listens for the OAuth return for the app's whole life, rather than for the length of one
  // sign-in — see completeNativeSignIn. Inert on web, which has no deep links.
  useEffect(() => {
    if (!isNativeApp()) return;
    let cancelled = false;
    let handle: { remove: () => void } | undefined;
    void App.addListener('appUrlOpen', ({ url }) => {
      if (url.startsWith(APP_AUTH_LINK)) void completeNativeSignIn(url);
    }).then((h) => {
      if (cancelled) h.remove();
      else handle = h;
    });
    // A return that launched the app is delivered as the launch URL; the listener above is
    // registered too late to be told about it.
    void App.getLaunchUrl().then((r) => {
      if (!cancelled && r?.url?.startsWith(APP_AUTH_LINK)) void completeNativeSignIn(r.url);
    });
    return () => {
      cancelled = true;
      handle?.remove();
    };
  }, [completeNativeSignIn]);

  // Native Google sign-in: the WebView can't run Google's OAuth, so the round trip happens in the
  // system browser and returns to a `sutamaya://auth` deep link. This only opens that browser —
  // the listener above owns what comes back.
  const signInWithGoogleNative = useCallback(async (returnTo?: string) => {
    setAuthError(null);
    setSigningIn(true);
    pendingReturnTo.current = returnTo;
    // App is imported statically (useAndroidBackButton needs it on the startup path); only Browser
    // stays dynamic, being reached from this gesture alone.
    const { Browser } = await import('@capacitor/browser');
    browserRef.current = Browser;
    try {
      // The sheet closing is not an outcome — backing out and completing look the same here — so
      // it only drops the button out of its pending state, and only if no return is being handled.
      const finished = await Browser.addListener('browserFinished', () => {
        finished.remove();
        setTimeout(() => {
          if (!completing.current) setSigningIn(false);
        }, SHEET_SETTLE_MS);
      });
      await Browser.open({ url: `${API_BASE}/api/auth/google/start?app=1` });
    } catch (err) {
      console.error('Could not open the sign-in browser:', err);
      browserRef.current = null;
      setSigningIn(false);
      setAuthError(authErrorMessage('1'));
    }
  }, []);

  const requestEmailCode = useCallback(async (email: string) => {
    setAuthError(null);
    await authApi.requestEmailCode(email);
  }, []);

  // Establishes the session in place, without the page unloading as the OAuth redirect does, so it
  // works the same inside an installed PWA. On native the response body carries the bearer token,
  // the cookie it also sets being unusable cross-origin.
  const signInWithEmailCode = useCallback(async (email: string, code: string) => {
    const { user, token } = await authApi.verifyEmailCode(email, code);
    await setNativeToken(token);
    setAuthError(null);
    writeLastUser(user);
    setUser(user);
  }, []);

  // Deletes this device's copy of the account's data and returns the reader to a signed-out state,
  // so nothing is left for whoever uses the device next.
  // `accountId` is passed by a caller holding the id already: the session check can blank `user`
  // first — it answers `{user: null}` for a deleted account — and this closure would then have
  // nothing left to name the mirror it has to delete.
  const forgetAccount = useCallback(async (accountId?: string) => {
    const previousId = accountId ?? user?.id;
    await clearNativeToken();
    writeLastUser(null);
    setUser(null);
    // A fresh local id, so whatever the reader does next starts empty.
    setLocalId(resetLocalUserId());
    if (previousId) await deleteMirror(previousId);
  }, [user]);

  // Ends the session and forgets the account here. Unsynced work is warned about at the button
  // (SettingsPage).
  const logout = useCallback(async () => {
    await authApi.logout();
    await forgetAccount();
  }, [forgetAccount]);

  // Erases the account itself, then forgets it here as a sign-out would. The other devices holding
  // it find out on their next sync, which answers 410 (UserDataContext's flush).
  const deleteAccount = useCallback(async () => {
    await authApi.deleteAccount();
    await forgetAccount();
  }, [forgetAccount]);

  const dataUserId = user?.id ?? localId;

  const value = useMemo(
    () => ({
      user,
      loading,
      isSignedIn: !!user,
      dataUserId,
      localUserId: localId,
      authError,
      signingIn,
      promptGoogleSignIn,
      signInWithGoogleNative,
      requestEmailCode,
      signInWithEmailCode,
      logout,
      deleteAccount,
      forgetAccount,
    }),
    [
      user,
      loading,
      dataUserId,
      localId,
      authError,
      signingIn,
      promptGoogleSignIn,
      signInWithGoogleNative,
      requestEmailCode,
      signInWithEmailCode,
      logout,
      deleteAccount,
      forgetAccount,
    ]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
