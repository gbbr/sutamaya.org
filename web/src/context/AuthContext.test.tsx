import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { LAST_USER_KEY } from '../lib/storageKeys';
import type { User } from '../lib/types';

vi.mock('@reach/router', () => ({ navigate: vi.fn() }));
vi.mock('../lib/api', () => ({
  authApi: { me: vi.fn(), google: vi.fn(), logout: vi.fn() },
}));

// AuthContext.tsx is imported dynamically (not statically at the top of this file) so each test
// can `vi.resetModules()` first — GOOGLE_CLIENT_ID is read from import.meta.env once, at module
// load time, so a fresh module instance is the only way to test both the "unset" and "set" cases
// in the same file.
async function loadAuthContext() {
  vi.resetModules();
  return import('./AuthContext');
}

function Probe({ useAuthHook }: { useAuthHook: () => ReturnType<typeof import('./AuthContext').useAuth> }) {
  const { user, loading, googleReady, authError } = useAuthHook();
  return (
    <div>
      <span data-testid="user">{user ? user.email : 'none'}</span>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="googleReady">{String(googleReady)}</span>
      <span data-testid="authError">{authError ?? 'none'}</span>
    </div>
  );
}

const testUser: User = { id: 'u1', email: 'a@example.com', name: 'A', picture: null };

describe('AuthContext', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    // Same in-memory stub the rest of this suite uses (e.g. hooks/useScrollMemory.test.tsx) —
    // Node's own global here is undefined, so lib/lastUser.ts would otherwise see every call throw
    // and quietly fall back to "nothing remembered", which is the case under test.
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    delete (window as unknown as { google?: unknown }).google;
  });

  it('loads the session on the first successful /auth/me call', async () => {
    const { AuthProvider, useAuth } = await loadAuthContext();
    const { authApi } = await import('../lib/api');
    vi.mocked(authApi.me).mockResolvedValue({ user: testUser });

    render(
      <AuthProvider>
        <Probe useAuthHook={useAuth} />
      </AuthProvider>
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByTestId('user').textContent).toBe('a@example.com');
    expect(screen.getByTestId('loading').textContent).toBe('false');
  });

  it('retries with backoff after a transient /auth/me failure, then succeeds', async () => {
    const { AuthProvider, useAuth } = await loadAuthContext();
    const { authApi } = await import('../lib/api');
    vi.mocked(authApi.me)
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValueOnce({ user: testUser });

    render(
      <AuthProvider>
        <Probe useAuthHook={useAuth} />
      </AuthProvider>
    );

    // First attempt fails immediately; still "loading" and no user yet.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId('loading').textContent).toBe('true');
    expect(screen.getByTestId('user').textContent).toBe('none');

    // Advance past the first retry delay (500ms) — the retried call resolves with the user.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(authApi.me).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('user').textContent).toBe('a@example.com');
    expect(screen.getByTestId('loading').textContent).toBe('false');
  });

  it('keeps trying a rate-limited session check rather than settling on signed-out', async () => {
    const { AuthProvider, useAuth } = await loadAuthContext();
    const { authApi } = await import('../lib/api');
    vi.mocked(authApi.me).mockRejectedValue(Object.assign(new Error('too many requests'), { status: 429 }));
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(
      <AuthProvider>
        <Probe useAuthHook={useAuth} />
      </AuthProvider>
    );

    // 1 initial attempt + 3 retries (RETRY_DELAYS_MS = [500, 1500, 3000]), all of which land inside
    // the Worker's own 60s rate-limit window and so are all doomed.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0 + 500 + 1500 + 3000 + 100);
    });

    expect(authApi.me).toHaveBeenCalledTimes(4);
    // The app renders in the meantime — it works offline — but exhausting a budget is not a logout,
    // so once that window has passed the next attempt picks the session up with no reload.
    expect(screen.getByTestId('loading').textContent).toBe('false');
    vi.mocked(authApi.me).mockResolvedValue({ user: testUser });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(65_000);
    });

    expect(screen.getByTestId('user').textContent).toBe('a@example.com');
    consoleWarn.mockRestore();
  });

  it('treats a permanent rejection as signed-out instead of retrying it forever', async () => {
    const { AuthProvider, useAuth } = await loadAuthContext();
    const { authApi } = await import('../lib/api');
    vi.mocked(authApi.me).mockRejectedValue(Object.assign(new Error('bad request'), { status: 400 }));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <AuthProvider>
        <Probe useAuthHook={useAuth} />
      </AuthProvider>
    );

    // A 400 isn't retryable, so retryWithBackoff rejects on the first attempt rather than spending
    // the schedule on a call that will fail identically every time.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });

    expect(authApi.me).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('user').textContent).toBe('none');
    expect(screen.getByTestId('loading').textContent).toBe('false');
    consoleError.mockRestore();
  });

  it('starts signed in from the remembered user when /auth/me cannot be reached', async () => {
    localStorage.setItem(LAST_USER_KEY, JSON.stringify(testUser));
    const { AuthProvider, useAuth } = await loadAuthContext();
    const { authApi } = await import('../lib/api');
    vi.mocked(authApi.me).mockRejectedValue(new Error('network down'));
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(
      <AuthProvider>
        <Probe useAuthHook={useAuth} />
      </AuthProvider>
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });

    // The whole point of an offline-first reader: relaunching on a plane has to open this user's
    // own mirror. Without a remembered identity `user` stays null, UserDataProvider mounts an empty
    // mirror over a full one, and every list, note and highlight on the device is both invisible
    // and unwritable until the network comes back.
    expect(screen.getByTestId('user').textContent).toBe('a@example.com');
    expect(screen.getByTestId('loading').textContent).toBe('false');
    consoleWarn.mockRestore();
  });

  it('forgets the remembered user once the server says the session is over', async () => {
    localStorage.setItem(LAST_USER_KEY, JSON.stringify(testUser));
    const { AuthProvider, useAuth } = await loadAuthContext();
    const { authApi } = await import('../lib/api');
    // A genuinely signed-out session is a 200 with a null user, not an error (see routes/auth.js).
    vi.mocked(authApi.me).mockResolvedValue({ user: null });

    render(
      <AuthProvider>
        <Probe useAuthHook={useAuth} />
      </AuthProvider>
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByTestId('user').textContent).toBe('none');
    expect(localStorage.getItem(LAST_USER_KEY)).toBeNull();
  });

  it('does not touch googleReady when VITE_GOOGLE_CLIENT_ID is unset', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '');
    const { AuthProvider, useAuth } = await loadAuthContext();
    const { authApi } = await import('../lib/api');
    vi.mocked(authApi.me).mockResolvedValue({ user: null });

    render(
      <AuthProvider>
        <Probe useAuthHook={useAuth} />
      </AuthProvider>
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByTestId('googleReady').textContent).toBe('false');
  });

  it('becomes googleReady once window.google appears, via the bounded poll', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');
    const { AuthProvider, useAuth } = await loadAuthContext();
    const { authApi } = await import('../lib/api');
    vi.mocked(authApi.me).mockResolvedValue({ user: null });

    render(
      <AuthProvider>
        <Probe useAuthHook={useAuth} />
      </AuthProvider>
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId('googleReady').textContent).toBe('false');

    // Simulate the GIS <script> tag finishing its load partway through the poll.
    const initialize = vi.fn();
    (window as unknown as { google: Window['google'] }).google = {
      accounts: { id: { initialize, prompt: vi.fn(), renderButton: vi.fn() } },
    };

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300); // a few 100ms poll ticks
    });

    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ client_id: 'test-client-id' }));
    expect(screen.getByTestId('googleReady').textContent).toBe('true');
  });

  it('gives up polling for window.google after ~15s and never becomes ready', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');
    const { AuthProvider, useAuth } = await loadAuthContext();
    const { authApi } = await import('../lib/api');
    vi.mocked(authApi.me).mockResolvedValue({ user: null });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <AuthProvider>
        <Probe useAuthHook={useAuth} />
      </AuthProvider>
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(16000); // past MAX_ATTEMPTS (150 * 100ms = 15000ms)
    });

    expect(screen.getByTestId('googleReady').textContent).toBe('false');
    expect(consoleError).toHaveBeenCalledWith('Google Identity Services script did not load in time.');
    consoleError.mockRestore();
  });
});
