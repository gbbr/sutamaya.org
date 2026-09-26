import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { renderRoutes } from '../../testRouter';
import { registerBackHandler } from '../../lib/native/backButton';
import { useNativeBack } from '../useNativeBack';

// Android's back button as the hook subscribes to it, and how often the app went to the background.
const android = vi.hoisted(() => ({ back: () => {}, minimized: 0 }));

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: async (event: string, cb: () => void) => {
      if (event === 'backButton') android.back = cb;
      return { remove: () => {} };
    },
    minimizeApp: async () => {
      android.minimized += 1;
    },
  },
}));

function Shell() {
  useNativeBack();
  return null;
}

// Renders the hook inside the given native shell, on `path`.
function renderOn(platform: 'ios' | 'android', path: string) {
  (globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true, getPlatform: () => platform };
  window.history.replaceState(null, '', path);
  const pages = ['/', '/browse', '/settings'].map((page) => ({ path: page, element: null }));
  return renderRoutes([{ element: <Shell />, children: pages }], path);
}

// Sends the event the iOS app sends for a swipe in from the left edge.
function swipe() {
  act(() => {
    window.dispatchEvent(new Event('swipeback'));
  });
}

afterEach(() => {
  delete (globalThis as { Capacitor?: unknown }).Capacitor;
  window.history.replaceState(null, '', '/');
  android.minimized = 0;
});

describe('useNativeBack', () => {
  it('dismisses what is open on an iOS swipe', () => {
    const dismiss = vi.fn();
    onTestFinished(registerBackHandler(dismiss));
    renderOn('ios', '/browse');
    swipe();
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('leaves Settings on an iOS swipe', async () => {
    const { router } = renderOn('ios', '/settings');
    swipe();
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('does nothing on an iOS swipe with no step left', async () => {
    const { router } = renderOn('ios', '/browse');
    swipe();
    await act(async () => {});
    expect(router.state.location.pathname).toBe('/browse');
  });

  it("backgrounds the app on Android's back button with no step left", () => {
    const { router } = renderOn('android', '/browse');
    act(() => android.back());
    expect(android.minimized).toBe(1);
    expect(router.state.location.pathname).toBe('/browse');
  });
});
