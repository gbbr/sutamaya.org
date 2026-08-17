import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { navigate } from '@reach/router';
import { authApi } from '../lib/api';
import { isRetryable, retryWithBackoff, statusOf } from '../lib/retry';
import type { User } from '../lib/types';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

// Longer than the Worker's 60s rate-limit period, so a retry lands in a fresh budget rather than
// spending the next one the moment it opens.
const SESSION_RETRY_MS = 65_000;

interface AuthState {
  user: User | null;
  loading: boolean;
  googleReady: boolean;
  authError: string | null;
  loginWithGoogle: (credential: string) => Promise<void>;
  promptGoogleSignIn: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  // True once google.accounts.id.initialize() has run — gates GoogleSignInButton's
  // renderButton() call, which needs that config to already exist (see GoogleSignInButton.tsx).
  const [googleReady, setGoogleReady] = useState(false);
  // Set only from the GIS callback below — a failure that never reaches our JS at all (Chrome's
  // FedCM handshake dying before `callback` fires) can't be surfaced here, but a credential that
  // *is* obtained and then fails verification/network can be, and previously wasn't (console-only).
  const [authError, setAuthError] = useState<string | null>(null);

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
        if (!cancelled) setUser(r.user);
      } catch (err) {
        if (cancelled) return;
        if (isRetryable(statusOf(err))) {
          console.warn('Session check failed transiently; retrying:', err);
          timer = setTimeout(loadUser, SESSION_RETRY_MS);
          return;
        }
        console.error('Failed to load session:', err);
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

  const loginWithGoogle = useCallback(async (credential: string) => {
    const { user } = await authApi.google(credential);
    setUser(user);
  }, []);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    let cancelled = false;
    function init() {
      if (cancelled || !window.google) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID!,
        callback: ({ credential }) => {
          setAuthError(null);
          loginWithGoogle(credential).catch((err) => {
            console.error('Google sign-in failed:', err);
            setAuthError(err instanceof Error ? err.message : 'Sign-in failed. Please try again.');
          });
        },
      });
      setGoogleReady(true);
    }
    if (window.google) init();
    else {
      // Bounded rather than polling forever — if the Google Identity Services script never
      // loads at all (ad-blocker, network failure, script restructured), this gives up after
      // ~15s and leaves googleReady false instead of running an interval for the tab's whole
      // lifetime with no error surfaced anywhere.
      let attempts = 0;
      const MAX_ATTEMPTS = 150;
      const id = window.setInterval(() => {
        if (window.google) {
          window.clearInterval(id);
          init();
          return;
        }
        attempts += 1;
        if (attempts >= MAX_ATTEMPTS) {
          window.clearInterval(id);
          console.error('Google Identity Services script did not load in time.');
        }
      }, 100);
      return () => window.clearInterval(id);
    }
    return () => {
      cancelled = true;
    };
  }, [loginWithGoogle]);

  // google.accounts.id.renderButton() needs a real, user-clicked on-page element to reliably open
  // its popup (browsers require a genuine click, not a programmatic API call), so it can't be
  // fired imperatively from arbitrary call sites (list/note/highlight actions in
  // UserDataContext) — routing all of those to the Settings page, which renders the actual
  // button, sidesteps that.
  const promptGoogleSignIn = useCallback(() => {
    navigate('/settings', { state: { scrollTo: 'auth' } });
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, googleReady, authError, loginWithGoogle, promptGoogleSignIn, logout }),
    [user, loading, googleReady, authError, loginWithGoogle, promptGoogleSignIn, logout]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
