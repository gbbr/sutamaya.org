import { useSyncExternalStore } from 'react';
import { getRecentSearches, subscribeRecentSearches } from '../lib/search/recentSearches';

// useRecentSearches returns the reader's recent searches, newest first, re-rendering whenever they
// change — on this screen, on another, or in another tab.
export function useRecentSearches(): string[] {
  return useSyncExternalStore(subscribeRecentSearches, getRecentSearches, getRecentSearches);
}
