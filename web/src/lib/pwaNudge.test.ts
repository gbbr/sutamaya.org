import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hasOpenedSutta, markSuttaOpened, isOfflineNudgeDismissed, dismissOfflineNudge } from './pwaNudge';

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
