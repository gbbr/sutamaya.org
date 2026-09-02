import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { navigate } from '@reach/router';
import { authApi } from '../lib/api';
import { isRetryable, retryWithBackoff, statusOf } from '../lib/retry';
import { readLastUser, writeLastUser } from '../lib/lastUser';
import { localUserId, resetLocalUserId } from '../lib/localAccount';
import { deleteMirror } from '../lib/mirrorDb';
import type { User } from '../lib/types';

// Delay before retrying a transient session check, held above the Worker's 60s rate-limit period.
const SESSION_RETRY_MS = 65_000;

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

  const requestEmailCode = useCallback(async (email: string) => {
    setAuthError(null);
    await authApi.requestEmailCode(email);
  }, []);

  // Establishes the session in place, without the page unloading as the OAuth redirect does, so it
  // works the same inside an installed PWA.
  const signInWithEmailCode = useCallback(async (email: string, code: string) => {
    const { user } = await authApi.verifyEmailCode(email, code);
    setAuthError(null);
    writeLastUser(user);
    setUser(user);
  }, []);

  // Ends the session and deletes this device's copy of the account's data, so nothing is left for
  // whoever signs in next. Unsynced work is warned about at the button (SettingsPage).
  const logout = useCallback(async () => {
    const previousId = user?.id;
    await authApi.logout();
    writeLastUser(null);
    setUser(null);
    // A fresh local id, so whatever the reader does next starts empty.
    setLocalId(resetLocalUserId());
    if (previousId) await deleteMirror(previousId);
  }, [user]);

  const dataUserId = user?.id ?? localId;

  const value = useMemo(
    () => ({
      user,
      loading,
      isSignedIn: !!user,
      dataUserId,
      localUserId: localId,
      authError,
      promptGoogleSignIn,
      requestEmailCode,
      signInWithEmailCode,
      logout,
    }),
    [user, loading, dataUserId, localId, authError, promptGoogleSignIn, requestEmailCode, signInWithEmailCode, logout]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
