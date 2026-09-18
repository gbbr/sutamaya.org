import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadUiPrefs, moveReaderTheme } from './uiPrefs';
import { READER_PREFS_KEY, UI_PREFS_KEY } from './storageKeys';

const readerPrefs = () => JSON.parse(localStorage.getItem(READER_PREFS_KEY) ?? 'null');

describe('moveReaderTheme', () => {
  // An in-memory localStorage, fresh per test, as in pwaNudge.test.ts.
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    });
  });

  it('makes a theme picked in the reader the app theme, keeping the other prefs', () => {
    localStorage.setItem(UI_PREFS_KEY, JSON.stringify({ uiScale: 1.1, theme: 'light' }));
    localStorage.setItem(READER_PREFS_KEY, JSON.stringify({ theme: 'dark', fs: 20 }));
    moveReaderTheme();
    expect(loadUiPrefs()).toEqual({ uiScale: 1.1, theme: 'dark' });
    expect(readerPrefs()).toEqual({ fs: 20 });
  });

  it('keeps the app theme when the reader never picked one', () => {
    localStorage.setItem(UI_PREFS_KEY, JSON.stringify({ uiScale: 1, theme: 'light' }));
    localStorage.setItem(READER_PREFS_KEY, JSON.stringify({ theme: 'system', fs: 20 }));
    moveReaderTheme();
    expect(loadUiPrefs().theme).toBe('light');
    expect(readerPrefs()).toEqual({ fs: 20 });
  });

  it('carries sepia over on a device with no app prefs saved', () => {
    localStorage.setItem(READER_PREFS_KEY, JSON.stringify({ theme: 'sepia' }));
    moveReaderTheme();
    expect(loadUiPrefs()).toEqual({ uiScale: 1, theme: 'sepia' });
  });

  it('changes nothing once the theme has moved', () => {
    localStorage.setItem(UI_PREFS_KEY, JSON.stringify({ uiScale: 1, theme: 'light' }));
    localStorage.setItem(READER_PREFS_KEY, JSON.stringify({ fs: 20 }));
    moveReaderTheme();
    expect(loadUiPrefs().theme).toBe('light');
    expect(readerPrefs()).toEqual({ fs: 20 });
  });

  it('changes nothing on a fresh install', () => {
    moveReaderTheme();
    expect(localStorage.getItem(UI_PREFS_KEY)).toBeNull();
    expect(localStorage.getItem(READER_PREFS_KEY)).toBeNull();
  });
});
