import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { authApi } from '../lib/api';
import type { User } from '../lib/types';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

interface AuthState {
  user: User | null;
  loading: boolean;
  loginWithGoogle: (credential: string) => Promise<void>;
  promptGoogleSignIn: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const googleReady = useRef(false);

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
      googleReady.current = true;
    }
    if (window.google) init();
    else {
      const id = window.setInterval(() => {
        if (window.google) {
          window.clearInterval(id);
          init();
        }
      }, 100);
      return () => window.clearInterval(id);
    }
    return () => {
      cancelled = true;
    };
  }, [loginWithGoogle]);

  const promptGoogleSignIn = useCallback(() => {
    if (!googleReady.current || !window.google) return;
    window.google.accounts.id.prompt();
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, loginWithGoogle, promptGoogleSignIn, logout }),
    [user, loading, loginWithGoogle, promptGoogleSignIn, logout]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
