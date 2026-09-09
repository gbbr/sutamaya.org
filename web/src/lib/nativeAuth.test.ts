import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stands in for the platform key-value store the plugin wraps.
const store = vi.hoisted(() => new Map<string, string>());
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: store.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => {
      store.set(key, value);
    },
    remove: async ({ key }: { key: string }) => {
      store.delete(key);
    },
  },
}));

function stubCapacitor(native: boolean) {
  vi.stubGlobal('Capacitor', {
    isNativePlatform: () => native,
    getPlatform: () => (native ? 'ios' : 'web'),
  });
}

beforeEach(() => {
  store.clear();
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('nativeAuth on web', () => {
  it('holds no token and every write is inert', async () => {
    const m = await import('./nativeAuth');
    await m.hydrateNativeToken();
    expect(m.getNativeToken()).toBeNull();
    await m.setNativeToken('tok');
    expect(m.getNativeToken()).toBeNull();
    expect(store.size).toBe(0);
  });
});

describe('nativeAuth in a native shell', () => {
  it('persists a token and reads it back on the next launch, then clears it', async () => {
    stubCapacitor(true);
    const first = await import('./nativeAuth');
    await first.setNativeToken('tok-1');
    expect(first.getNativeToken()).toBe('tok-1');

    // A fresh module instance stands in for a relaunch: memory is empty until hydrate reads storage.
    vi.resetModules();
    const second = await import('./nativeAuth');
    expect(second.getNativeToken()).toBeNull();
    await second.hydrateNativeToken();
    expect(second.getNativeToken()).toBe('tok-1');

    await second.clearNativeToken();
    expect(second.getNativeToken()).toBeNull();
    expect(store.size).toBe(0);
  });
});
