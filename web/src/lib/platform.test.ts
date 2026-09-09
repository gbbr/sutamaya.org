import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isNativeApp, platformName, isStandaloneDisplay, API_BASE } from './platform';

// Stands in for the object Capacitor injects into its WebView.
function stubCapacitor(platform: 'ios' | 'android' | 'web') {
  vi.stubGlobal('Capacitor', {
    isNativePlatform: () => platform !== 'web',
    getPlatform: () => platform,
  });
}

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
  Object.defineProperty(navigator, 'standalone', { value: undefined, configurable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isNativeApp', () => {
  it('is false in a browser, where Capacitor is absent', () => {
    expect(isNativeApp()).toBe(false);
  });

  it('is true inside a native shell', () => {
    stubCapacitor('ios');
    expect(isNativeApp()).toBe(true);
  });
});

describe('platformName', () => {
  it("is 'web' in a browser", () => {
    expect(platformName()).toBe('web');
  });

  it('reports the native platform', () => {
    stubCapacitor('android');
    expect(platformName()).toBe('android');
  });
});

describe('isStandaloneDisplay', () => {
  it('is false in a regular browser tab', () => {
    expect(isStandaloneDisplay()).toBe(false);
  });

  it('is true when display-mode: standalone matches (Android/desktop PWA install)', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    expect(isStandaloneDisplay()).toBe(true);
  });

  it('is true when navigator.standalone is set (iOS home-screen launch)', () => {
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    expect(isStandaloneDisplay()).toBe(true);
  });

  it('is true in a native shell regardless of the browser signals', () => {
    stubCapacitor('ios');
    expect(isStandaloneDisplay()).toBe(true);
  });
});

describe('API_BASE', () => {
  it('is empty on web, where the app and the Worker share an origin', () => {
    expect(API_BASE).toBe('');
  });

  it('is the Worker origin in a native shell', async () => {
    vi.resetModules();
    stubCapacitor('ios');
    const { API_BASE: nativeBase } = await import('./platform');
    expect(nativeBase).toBe('https://app.sutamaya.org');
  });
});
