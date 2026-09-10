import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// The native shell, in place before AuthContext's module-level platform checks run.
vi.hoisted(() => {
  (globalThis as { Capacitor?: unknown }).Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'ios',
  };
});

const deepLink = vi.hoisted(() => ({
  listeners: [] as ((event: { url: string }) => void)[],
  launchUrl: null as string | null,
  fire(url: string) {
    deepLink.listeners.forEach((l) => l({ url }));
  },
}));

const browser = vi.hoisted(() => ({
  opened: 0,
  closed: 0,
  finished: [] as (() => void)[],
  finish() {
    browser.finished.forEach((l) => l());
  },
}));

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: async (event: string, cb: (e: { url: string }) => void) => {
      if (event === 'appUrlOpen') deepLink.listeners.push(cb);
      return { remove: () => {} };
    },
    getLaunchUrl: async () => (deepLink.launchUrl ? { url: deepLink.launchUrl } : null),
  },
}));

vi.mock('@capacitor/browser', () => ({
  Browser: {
    open: async () => {
      browser.opened += 1;
    },
    close: async () => {
      browser.closed += 1;
    },
    addListener: async (event: string, cb: () => void) => {
      if (event === 'browserFinished') browser.finished.push(cb);
      return { remove: () => {} };
    },
  },
}));

const stored = vi.hoisted(() => ({ token: null as string | null }));
vi.mock('../lib/nativeAuth', () => ({
  hydrateNativeToken: async () => {},
  getNativeToken: () => stored.token,
  setNativeToken: async (t: string) => {
    stored.token = t;
  },
  clearNativeToken: async () => {
    stored.token = null;
  },
}));

const me = vi.hoisted(() => ({
  fn: vi.fn(async () => ({ user: null as { id: string; email: string; name: null; picture: null } | null })),
}));
vi.mock('../lib/api', () => ({ authApi: { me: () => me.fn() } }));
vi.mock('../lib/mirrorDb', () => ({ deleteMirror: async () => {} }));
vi.mock('@reach/router', () => ({ navigate: vi.fn(async () => {}) }));

import { AuthProvider, useAuth } from './AuthContext';

const ACCOUNT = { id: 'u1', email: 'reader@example.com', name: null, picture: null };

function Consumer() {
  const { user, signingIn, authError, signInWithGoogleNative } = useAuth();
  return (
    <div>
      <button onClick={() => void signInWithGoogleNative()}>Sign in</button>
      <div data-testid="who">{user?.email ?? 'signed out'}</div>
      <div data-testid="pending">{signingIn ? 'signing in' : 'idle'}</div>
      <div data-testid="error">{authError ?? ''}</div>
    </div>
  );
}

async function mount() {
  render(
    <AuthProvider>
      <Consumer />
    </AuthProvider>
  );
  await waitFor(() => expect(me.fn).toHaveBeenCalled());
}

beforeEach(() => {
  deepLink.listeners = [];
  deepLink.launchUrl = null;
  browser.opened = 0;
  browser.closed = 0;
  browser.finished = [];
  stored.token = null;
  me.fn.mockReset();
  me.fn.mockResolvedValue({ user: null });
});

describe('native Google sign-in', () => {
  it('signs in on a return that arrives after the browser sheet has closed', async () => {
    await mount();
    await userEvent.click(screen.getByText('Sign in'));
    await waitFor(() => expect(browser.opened).toBe(1));
    expect(screen.getByTestId('pending')).toHaveTextContent('signing in');

    // The sheet closes first and the deep link lands well after — the case a timeout-based flow
    // discards, leaving the reader signed out with nothing said.
    browser.finish();
    await waitFor(() => expect(screen.getByTestId('pending')).toHaveTextContent('idle'));

    me.fn.mockResolvedValue({ user: ACCOUNT });
    deepLink.fire('sutamaya://auth?token=tok-late');

    await waitFor(() => expect(screen.getByTestId('who')).toHaveTextContent('reader@example.com'));
    expect(stored.token).toBe('tok-late');
    expect(screen.getByTestId('error')).toHaveTextContent('');
  });

  it('signs in on a return that launched the app, with no sign-in in flight', async () => {
    deepLink.launchUrl = 'sutamaya://auth?token=tok-cold';
    me.fn.mockResolvedValue({ user: ACCOUNT });

    await mount();

    await waitFor(() => expect(screen.getByTestId('who')).toHaveTextContent('reader@example.com'));
    expect(stored.token).toBe('tok-cold');
    expect(browser.opened).toBe(0);
  });

  it('acts on a launch-url return once, though it also arrives on the listener', async () => {
    deepLink.launchUrl = 'sutamaya://auth?token=tok-cold';
    me.fn.mockResolvedValue({ user: ACCOUNT });
    await mount();
    await waitFor(() => expect(screen.getByTestId('who')).toHaveTextContent('reader@example.com'));

    const calls = me.fn.mock.calls.length;
    deepLink.fire('sutamaya://auth?token=tok-cold');
    await new Promise((r) => setTimeout(r, 20));
    expect(me.fn.mock.calls.length).toBe(calls);
  });

  it('reports a return that carries no token', async () => {
    await mount();
    await userEvent.click(screen.getByText('Sign in'));
    await waitFor(() => expect(browser.opened).toBe(1));

    deepLink.fire('sutamaya://auth?error=1');

    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('Sign-in did not complete'));
    expect(screen.getByTestId('pending')).toHaveTextContent('idle');
    expect(stored.token).toBeNull();
  });

  it('reports a repeat failed return, not just the first', async () => {
    await mount();
    await userEvent.click(screen.getByText('Sign in'));
    await waitFor(() => expect(browser.opened).toBe(1));
    deepLink.fire('sutamaya://auth?error=1');
    await waitFor(() => expect(screen.getByTestId('pending')).toHaveTextContent('idle'));

    // The second attempt returns the byte-identical `sutamaya://auth?error=1`; it must still
    // clear the pending state rather than be deduped as a repeat of the first.
    await userEvent.click(screen.getByText('Sign in'));
    await waitFor(() => expect(screen.getByTestId('pending')).toHaveTextContent('signing in'));
    deepLink.fire('sutamaya://auth?error=1');
    await waitFor(() => expect(screen.getByTestId('pending')).toHaveTextContent('idle'));
    expect(screen.getByTestId('error')).toHaveTextContent('Sign-in did not complete');
  });

  it('keeps the token when the account details fail to arrive, and says so', async () => {
    await mount();
    await userEvent.click(screen.getByText('Sign in'));
    await waitFor(() => expect(browser.opened).toBe(1));

    me.fn.mockRejectedValue(Object.assign(new Error('Request failed (401)'), { status: 401 }));
    deepLink.fire('sutamaya://auth?token=tok-ok');

    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('could not be loaded'));
    expect(stored.token).toBe('tok-ok');
    expect(screen.getByTestId('pending')).toHaveTextContent('idle');
  });

  it('drops out of its pending state when the reader backs out of the sheet', async () => {
    await mount();
    await userEvent.click(screen.getByText('Sign in'));
    await waitFor(() => expect(screen.getByTestId('pending')).toHaveTextContent('signing in'));

    browser.finish();

    await waitFor(() => expect(screen.getByTestId('pending')).toHaveTextContent('idle'));
    expect(screen.getByTestId('who')).toHaveTextContent('signed out');
    expect(screen.getByTestId('error')).toHaveTextContent('');
  });
});
