import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { navigate } from '@reach/router';
import { authApi } from '../lib/api';
import { isRetryable, retryWithBackoff, statusOf } from '../lib/retry';
import { readLastUser, writeLastUser } from '../lib/lastUser';
import type { User } from '../lib/types';

// Longer than the Worker's 60s rate-limit period, so a retry lands in a fresh budget rather than
// spending the next one the moment it opens.
const SESSION_RETRY_MS = 65_000;

interface AuthState {
  user: User | null;
  loading: boolean;
  authError: string | null;
  promptGoogleSignIn: () => void;
  requestEmailCode: (email: string) => Promise<void>;
  signInWithEmailCode: (email: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

function authErrorMessage(marker: string | null): string | null {
  return marker ? 'Sign-in did not complete. Please try again.' : null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Seeded from the last confirmed session rather than from null, so a relaunch with no network
  // opens the user's own mirror instead of an empty one (see lib/lastUser.ts). The server's answer
  // replaces it as soon as one arrives, in either direction.
  const [user, setUser] = useState<User | null>(readLastUser);
  const [loading, setLoading] = useState(true);
  // A failed sign-in comes back as ?auth_error=<reason> on the page the OAuth callback redirects
  // to (worker/src/routes/auth.js) — the flow is a full-page round trip, so there's no live
  // promise left to catch a rejection from. Seeded synchronously from the URL the app booted on,
  // which is the only moment the marker can be there; stripped below so a reload doesn't show it
  // again.
  const [authError, setAuthError] = useState<string | null>(() =>
    authErrorMessage(new URLSearchParams(window.location.search).get('auth_error'))
  );

  useEffect(() => {
    if (!authError) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has('auth_error')) return;
    url.searchParams.delete('auth_error');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, [authError]);

  useEffect(() => {
    // GET /auth/me returns 200 with { user: null } for a genuinely signed-out session — it
    // never throws for that case (see routes/auth.js). So a thrown error here is always a
    // transient problem (offline, a 429, a 5xx during e.g. a PWA relaunch right after airplane
    // mode toggles back on) rather than a real "you're logged out" signal, and shouldn't wipe
    // an otherwise-valid session cookie's user out of the UI on the first blip — retry with
    // backoff before giving up.
    //
    // retryWithBackoff exhausts in about five seconds, which is inside the Worker's own 60s
    // rate-limit window — so a 429 is guaranteed to fail every one of those attempts, and treating
    // that as the end of it would render the app signed-out until the user happened to reload. A
    // transient failure keeps trying on a slow loop instead. `loading` still clears after the first
    // attempt: this is an offline-first app, and it should render rather than hold a spinner.
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function loadUser() {
      try {
        const r = await retryWithBackoff(() => authApi.me());
        // The server has spoken, so the remembered identity follows it exactly — including to
        // null, which is what a genuinely signed-out session answers (200 with `user: null`).
        writeLastUser(r.user);
        if (!cancelled) setUser(r.user);
      } catch (err) {
        if (cancelled) return;
        if (isRetryable(statusOf(err))) {
          // Nothing here says the session is over, so the remembered user stands and the app goes
          // on running against the mirror — the whole point of seeding `user` from it.
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

  // Called from arbitrary places a signed-out user tries something that needs an account (the
  // list/note/highlight actions in UserDataContext, the account badge). It sends them to
  // Settings' sign-in section rather than starting the redirect itself: leaving the app is a big
  // enough interruption that it should follow a click on something that says "Sign in", not a
  // click on "add to list".
  //
  // `returnTo` is where they were when they hit the wall, carried through Settings and into the
  // OAuth round trip so signing in puts them back on the sutta they were filing rather than
  // stranding them on the Settings page. Captured here rather than read off the URL later —
  // by the time the button is clicked, the URL *is* /settings.
  const promptGoogleSignIn = useCallback(() => {
    const returnTo = window.location.pathname + window.location.search;
    navigate('/settings', { state: { scrollTo: 'auth', returnTo } });
  }, []);

  const requestEmailCode = useCallback(async (email: string) => {
    setAuthError(null);
    await authApi.requestEmailCode(email);
  }, []);

  // Unlike the OAuth redirect, this establishes the session without the page ever unloading —
  // which is the point of a code over a link: it works the same inside an installed PWA, where a
  // link opened from the mail app would have signed the browser in and left the app signed out.
  const signInWithEmailCode = useCallback(async (email: string, code: string) => {
    const { user } = await authApi.verifyEmailCode(email, code);
    setAuthError(null);
    writeLastUser(user);
    setUser(user);
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    writeLastUser(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, authError, promptGoogleSignIn, requestEmailCode, signInWithEmailCode, logout }),
    [user, loading, authError, promptGoogleSignIn, requestEmailCode, signInWithEmailCode, logout]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
