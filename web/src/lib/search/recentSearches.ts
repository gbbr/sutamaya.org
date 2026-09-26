import { searchKey } from './metadata';
import { RECENT_SEARCHES_KEY } from '../storageKeys';

// How many searches the history keeps.
export const RECENT_SEARCHES_CAP = 8;

// isSameSearch reports whether two queries differ only in case, diacritics or spacing.
export function isSameSearch(a: string, b: string): boolean {
  const fold = (q: string) => searchKey(q).replace(/\s+/g, ' ').trim();
  return fold(a) === fold(b);
}

function load(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((q): q is string => typeof q === 'string') : [];
  } catch {
    return [];
  }
}

// The history, newest first, as one array replaced on every change.
let searches = load();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function set(next: string[]) {
  searches = next;
  try {
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
  } catch {
    // storage unavailable — the history still works for this session
  }
  notify();
}

// Follows another tab's changes. A null key is that tab clearing the whole storage.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== RECENT_SEARCHES_KEY && e.key !== null) return;
    searches = load();
    notify();
  });
}

// subscribeRecentSearches calls `listener` on every change to the history, and returns the
// unsubscribe.
export function subscribeRecentSearches(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// getRecentSearches returns the history, newest first.
export function getRecentSearches(): string[] {
  return searches;
}

// saveRecentSearch puts `query` at the top of the history, once one of its results is opened.
export function saveRecentSearch(query: string) {
  const q = query.trim();
  if (!q) return;
  set([q, ...searches.filter((s) => !isSameSearch(s, q))].slice(0, RECENT_SEARCHES_CAP));
}

// removeRecentSearch drops one search from the history.
export function removeRecentSearch(query: string) {
  set(searches.filter((s) => !isSameSearch(s, query)));
}

// clearRecentSearches empties the history, for its Clear button and for a sign-out.
export function clearRecentSearches() {
  set([]);
}
