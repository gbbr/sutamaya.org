import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RECENT_SEARCHES_CAP,
  clearRecentSearches,
  getRecentSearches,
  isSameSearch,
  removeRecentSearch,
  saveRecentSearch,
  subscribeRecentSearches,
} from '../recentSearches';
import { RECENT_SEARCHES_KEY } from '../../storageKeys';

const stored = () => JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) ?? 'null');

beforeEach(() => {
  // An in-memory localStorage, fresh per test, as in lib/ui/__tests__/uiPrefs.test.ts.
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
  // The history lives in the module, so each test starts it empty.
  clearRecentSearches();
});

describe('recent searches', () => {
  it('puts a saved search on top, once, and stores it', () => {
    saveRecentSearch('sati');
    saveRecentSearch('dhamma');
    saveRecentSearch('sati');
    expect(getRecentSearches()).toEqual(['sati', 'dhamma']);
    expect(stored()).toEqual(['sati', 'dhamma']);
  });

  it('treats case, diacritics and spacing as the same search, keeping the latest spelling', () => {
    saveRecentSearch('nibbāna');
    saveRecentSearch(' Nibbana ');
    expect(getRecentSearches()).toEqual(['Nibbana']);
    expect(isSameSearch('four  noble', 'Four noble')).toBe(true);
  });

  it('saves nothing for an empty query', () => {
    saveRecentSearch('   ');
    expect(getRecentSearches()).toEqual([]);
  });

  it('keeps the newest searches up to the cap', () => {
    for (let i = 0; i <= RECENT_SEARCHES_CAP; i++) saveRecentSearch(`q${i}`);
    expect(getRecentSearches()).toHaveLength(RECENT_SEARCHES_CAP);
    expect(getRecentSearches()[0]).toBe(`q${RECENT_SEARCHES_CAP}`);
    expect(getRecentSearches()).not.toContain('q0');
  });

  it('removes one search, or all of them', () => {
    saveRecentSearch('metta');
    saveRecentSearch('dhamma');
    saveRecentSearch('sati');
    removeRecentSearch('Dhamma');
    expect(getRecentSearches()).toEqual(['sati', 'metta']);
    clearRecentSearches();
    expect(getRecentSearches()).toEqual([]);
    expect(stored()).toEqual([]);
  });

  it('tells its subscribers of every change until they unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRecentSearches(listener);
    saveRecentSearch('sati');
    removeRecentSearch('sati');
    unsubscribe();
    saveRecentSearch('dhamma');
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
