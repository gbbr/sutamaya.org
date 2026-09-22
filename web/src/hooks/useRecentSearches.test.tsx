import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRecentSearches } from './useRecentSearches';
import { clearRecentSearches, saveRecentSearch } from '../lib/recentSearches';
import { RECENT_SEARCHES_KEY } from '../lib/storageKeys';

beforeEach(() => {
  // An in-memory localStorage, fresh per test, as in lib/uiPrefs.test.ts.
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
  // The history lives in its module, so each test starts it empty.
  clearRecentSearches();
});

describe('useRecentSearches', () => {
  it('follows a change made elsewhere in the app, as a sign-out clearing the history', () => {
    saveRecentSearch('sati');
    const { result } = renderHook(() => useRecentSearches());
    expect(result.current).toEqual(['sati']);
    act(() => clearRecentSearches());
    expect(result.current).toEqual([]);
  });

  it("follows another tab's change", () => {
    const { result } = renderHook(() => useRecentSearches());
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(['metta']));
    act(() => void window.dispatchEvent(new StorageEvent('storage', { key: RECENT_SEARCHES_KEY })));
    expect(result.current).toEqual(['metta']);
  });
});
