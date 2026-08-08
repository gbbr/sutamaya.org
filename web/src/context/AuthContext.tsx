import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { navigate } from '@reach/router';
import { authApi } from '../lib/api';
import type { User } from '../lib/types';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

interface AuthState {
  user: User | null;
  loading: boolean;
  googleReady: boolean;
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

  useEffect(() => {
    authApi
      .me()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
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
          loginWithGoogle(credential).catch((err) => console.error('Google sign-in failed:', err));
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

  // Used to *not* be a real button — this fired Google's silent "One Tap" prompt
  // (google.accounts.id.prompt()), which Google is deprecating in favor of FedCM and which, in
  // practice, fails completely silently (no popup, no error, no callback) for a long list of
  // ordinary reasons: FedCM disabled for the site, third-party cookies blocked, the browser's
  // One Tap cooldown after a previous dismissal, etc. — exactly what showed up in testing.
  // google.accounts.id.renderButton() is the reliable alternative (a real, user-clicked element
  // that reliably opens a popup, since browsers require a genuine click — not a programmatic
  // API call — to permit that), but it has to render into on-page DOM, so it can't be fired
  // imperatively from arbitrary call sites (list/note/highlight actions in UserDataContext).
  // Routing all of those to the Settings page, which renders the actual button, is the fix.
  const promptGoogleSignIn = useCallback(() => {
    navigate('/settings');
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, googleReady, loginWithGoogle, promptGoogleSignIn, logout }),
    [user, loading, googleReady, loginWithGoogle, promptGoogleSignIn, logout]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
