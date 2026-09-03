import { useDeferredValue, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { searchLists, type ListHit, type SearchHit } from '../lib/corpus';
import {
  beginTextSearchLoad,
  searchCorpusAndText,
  subscribeTextSearch,
  textSearchSnapshot,
  TEXT_LOADING_DELAY_MS,
  type TextSearchStatus,
} from '../lib/textSearch';
import type { Corpus, HighlightsMap, ListDef, NotesMap } from '../lib/types';

// Returns the sutta hits and list hits for a query, scanned off a deferred copy of it so typing
// stays responsive while the search walks every sutta and, once the text has arrived, the whole
// canon.
//
// `textStatus` is what the caller says in an empty result and `textLoading` whether it draws the
// spinner under the rows: the search text is fetched lazily, hits in it append when it lands, and
// search works without it — see docs/search.md's "Late, or never".
export function useCorpusSearch(
  corpus: Corpus | null,
  query: string,
  notes: NotesMap,
  lists: ListDef[],
  highlights: HighlightsMap
): { hits: SearchHit[]; listHits: ListHit[]; textStatus: TextSearchStatus; textLoading: boolean } {
  const deferredQuery = useDeferredValue(query);
  const searching = deferredQuery.trim() !== '';
  // A field the reader has focused has usually already started this; a query typed into one that
  // hasn't (the reader's overlay opened straight onto a pasted query) starts it here.
  useEffect(() => {
    if (searching) beginTextSearchLoad(corpus);
  }, [searching, corpus]);
  const { status, index } = useSyncExternalStore(subscribeTextSearch, textSearchSnapshot, textSearchSnapshot);
  // Set only once the fetch has run past TEXT_LOADING_DELAY_MS, so a load that lands in a blink —
  // every load on a fast connection, the field having started it on focus — says nothing at all.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (status !== 'loading') {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), TEXT_LOADING_DELAY_MS);
    return () => clearTimeout(timer);
  }, [status]);
  const hits = useMemo(
    () => (corpus && searching ? searchCorpusAndText(corpus, deferredQuery, notes, lists, highlights, index) : []),
    [corpus, deferredQuery, searching, notes, lists, highlights, index]
  );
  // Off the same deferred query, so both halves of the results describe one keystroke.
  const listHits = useMemo(() => searchLists(lists, deferredQuery), [lists, deferredQuery]);
  return { hits, listHits, textStatus: status, textLoading: searching && slow };
}
