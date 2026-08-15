import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isStandalone, hasOpenedSutta, markSuttaOpened, isOfflineNudgeDismissed, dismissOfflineNudge } from './pwaNudge';

beforeEach(() => {
  // Node's own built-in localStorage global shadows jsdom's here in a way that leaves it
  // undefined rather than a working store (same workaround as TreePane.test.tsx) — stub a plain
  // in-memory one, fresh per test.
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
  // jsdom has no matchMedia implementation at all — each test sets it explicitly rather than
  // relying on a shared default.
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
  Object.defineProperty(navigator, 'standalone', { value: undefined, configurable: true });
});

describe('isStandalone', () => {
  it('is false in a regular browser tab', () => {
    expect(isStandalone()).toBe(false);
  });

  it('is true when display-mode: standalone matches (Android/desktop PWA install)', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    expect(isStandalone()).toBe(true);
  });

  it('is true when navigator.standalone is set (iOS home-screen launch, no display-mode support)', () => {
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    expect(isStandalone()).toBe(true);
  });
});

describe('hasOpenedSutta / markSuttaOpened', () => {
  it('is false until a sutta has been marked opened, true after', () => {
    expect(hasOpenedSutta()).toBe(false);
    markSuttaOpened();
    expect(hasOpenedSutta()).toBe(true);
  });
});

describe('isOfflineNudgeDismissed / dismissOfflineNudge', () => {
  it('is false until dismissed, true after', () => {
    expect(isOfflineNudgeDismissed()).toBe(false);
    dismissOfflineNudge();
    expect(isOfflineNudgeDismissed()).toBe(true);
  });
});
