import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { renderRoutes } from '../testRouter';
import { useNativeLinks } from './useNativeLinks';

// The link event as the hook subscribes to it, and the link the app was launched with.
const links = vi.hoisted(() => ({
  open: (_event: { url: string }) => {},
  launch: undefined as string | undefined,
}));

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: async (event: string, cb: (event: { url: string }) => void) => {
      if (event === 'appUrlOpen') links.open = cb;
      return { remove: () => {} };
    },
    getLaunchUrl: async () => (links.launch ? { url: links.launch } : undefined),
  },
}));

function Shell() {
  useNativeLinks();
  return null;
}

// Renders the hook inside the iOS app, on `path`.
function renderOn(path: string) {
  (globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios' };
  const pages = ['/browse', '/read/:suttaId'].map((page) => ({ path: page, element: null }));
  return renderRoutes([{ element: <Shell />, children: pages }], path);
}

afterEach(() => {
  delete (globalThis as { Capacitor?: unknown }).Capacitor;
  sessionStorage.clear();
  links.launch = undefined;
});

describe('useNativeLinks', () => {
  it('opens the page of a link that arrives while the app runs', async () => {
    const { router } = renderOn('/browse');
    await act(async () => links.open({ url: 'https://app.sutamaya.org/read/mn10' }));
    expect(router.state.location.pathname).toBe('/read/mn10');
  });

  it('opens the link that launched the app once, and not again after a reload', async () => {
    links.launch = 'https://app.sutamaya.org/read/mn10';
    const launched = renderOn('/browse');
    await waitFor(() => expect(launched.router.state.location.pathname).toBe('/read/mn10'));

    const { key } = launched.router.state.location;
    await act(async () => links.open({ url: 'https://app.sutamaya.org/read/mn10' }));
    expect(launched.router.state.location.key).toBe(key);
    launched.unmount();

    const reloaded = renderOn('/browse');
    await act(async () => {});
    expect(reloaded.router.state.location.pathname).toBe('/browse');
  });

  it('leaves the sign-in return alone', async () => {
    const { router } = renderOn('/browse');
    await act(async () => links.open({ url: 'sutamaya://auth?code=abc' }));
    expect(router.state.location.pathname).toBe('/browse');
  });
});
