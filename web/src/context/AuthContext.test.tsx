import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { LAST_USER_KEY } from '../lib/storageKeys';
import type { User } from '../lib/types';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useNavigate: () => navigate,
}));
vi.mock('../lib/api', () => ({
  authApi: { me: vi.fn(), logout: vi.fn(), deleteAccount: vi.fn() },
}));
// Retiring an identity's mirror is the observable half of a sign-out or a deletion, and IndexedDB
// is not what these tests are about.
vi.mock('../lib/mirrorDb', () => ({ deleteMirror: vi.fn(async () => {}) }));

// AuthContext.tsx is imported dynamically (not statically at the top of this file) so each test
// can `vi.resetModules()` first — the provider reads ?auth_error=1 off the URL as it initialises,
// so each case needs a fresh module instance against the URL it just set up.
async function loadAuthContext() {
  vi.resetModules();
  return import('./AuthContext');
}

function Probe({ useAuthHook }: { useAuthHook: () => ReturnType<typeof import('./AuthContext').useAuth> }) {
  const { user, loading, authError } = useAuthHook();
  return (
    <div>
      <span data-testid="user">{user ? user.email : 'none'}</span>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="authError">{authError ?? 'none'}</span>
    </div>
  );
}

// Exposes the account teardown and the ids it moves — `dataUserId` is what the rest of the app
// reads and writes under, so "left on a fresh local account" is a statement about it.
function AccountProbe({ useAuthHook }: { useAuthHook: () => ReturnType<typeof import('./AuthContext').useAuth> }) {
  const { user, dataUserId, localUserId, deleteAccount, forgetAccount } = useAuthHook();
  return (
    <div>
      <span data-testid="user">{user ? user.email : 'none'}</span>
      <span data-testid="dataUserId">{dataUserId}</span>
      <span data-testid="localUserId">{localUserId}</span>
      <button onClick={() => void deleteAccount()}>delete</button>
      <button onClick={() => void forgetAccount('u-elsewhere')}>forget-elsewhere</button>
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

  // The OAuth flow is a full-page round trip, so a failed sign-in can't reject a promise here —
  // the Worker's callback redirects back with ?auth_error=1 instead (worker/src/routes/auth.js).
  it('surfaces a failed sign-in from ?auth_error=1 and strips it from the URL', async () => {
    window.history.replaceState(null, '', '/settings?auth_error=1');
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

    expect(screen.getByTestId('authError').textContent).toBe('Sign-in did not complete. Please try again.');
    // Left in the URL it would reappear on every reload of a page the user is now happily on.
    expect(window.location.search).toBe('');
    expect(window.location.pathname).toBe('/settings');
  });

  it('keeps the rest of the query when stripping the error marker', async () => {
    window.history.replaceState(null, '', '/browse/dn?q=metta&auth_error=1');
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

    expect(window.location.search).toBe('?q=metta');
  });

  it('deleting the account retires the session, the remembered user and this device’s mirror', async () => {
    localStorage.setItem(LAST_USER_KEY, JSON.stringify(testUser));
    const { AuthProvider, useAuth } = await loadAuthContext();
    const { authApi } = await import('../lib/api');
    const { deleteMirror } = await import('../lib/mirrorDb');
    vi.mocked(authApi.me).mockResolvedValue({ user: testUser });
    vi.mocked(authApi.deleteAccount).mockResolvedValue({ ok: true });

    render(
      <AuthProvider>
        <AccountProbe useAuthHook={useAuth} />
      </AuthProvider>
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const localBefore = screen.getByTestId('localUserId').textContent;

    await act(async () => {
      screen.getByText('delete').click();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(authApi.deleteAccount).toHaveBeenCalled();
    expect(screen.getByTestId('user').textContent).toBe('none');
    expect(localStorage.getItem(LAST_USER_KEY)).toBeNull();
    expect(deleteMirror).toHaveBeenCalledWith('u1');
    // A *fresh* local account, not the one this device used before it signed in: nothing of the
    // deleted account is left for whoever picks the device up next.
    const localAfter = screen.getByTestId('localUserId').textContent;
    expect(localAfter).not.toBe(localBefore);
    expect(screen.getByTestId('dataUserId').textContent).toBe(localAfter);
  });

  // The case that made forgetAccount take an id at all. On a device relaunched after the account
  // was deleted elsewhere, /auth/me and the first flush race: /me is a small GET and the flush waits
  // on the mirror plus a whole snapshot, so `user` is usually already null by the time the 410
  // lands. Reading the id from `user` there deletes nothing, and the deleted account's lists, notes
  // and highlights stay in IndexedDB with nothing left that could ever reach them.
  it('forgets the mirror it is handed, even once the session check has blanked the user', async () => {
    localStorage.setItem(LAST_USER_KEY, JSON.stringify(testUser));
    const { AuthProvider, useAuth } = await loadAuthContext();
    const { authApi } = await import('../lib/api');
    const { deleteMirror } = await import('../lib/mirrorDb');
    // What a deleted account's own /auth/me answers: the cookie still verifies, the row is gone.
    vi.mocked(authApi.me).mockResolvedValue({ user: null });

    render(
      <AuthProvider>
        <AccountProbe useAuthHook={useAuth} />
      </AuthProvider>
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId('user').textContent).toBe('none');

    await act(async () => {
      screen.getByText('forget-elsewhere').click();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(deleteMirror).toHaveBeenCalledWith('u-elsewhere');
  });

  it('reports no error for an ordinary load', async () => {
    window.history.replaceState(null, '', '/settings');
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

    expect(screen.getByTestId('authError').textContent).toBe('none');
  });
});
