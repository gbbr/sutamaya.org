import { useDeferredValue, useEffect, useMemo, useSyncExternalStore } from 'react';
import { searchLists, type ListHit, type SearchHit } from '../lib/corpus';
import {
  beginTextSearchLoad,
  searchCorpusAndText,
  subscribeTextSearch,
  textSearchSnapshot,
  type TextSearchStatus,
} from '../lib/textSearch';
import type { Corpus, HighlightsMap, ListDef, NotesMap } from '../lib/types';

// Returns the sutta hits and list hits for a query, scanned off a deferred copy of it so typing
// stays responsive while the search walks every sutta and, once the text has arrived, the whole
// canon.
//
// `textStatus` is what the caller says under the results: the search text is fetched lazily, hits
// in it append when it lands, and search works without it — see docs/search.md's "Late, or never".
export function useCorpusSearch(
  corpus: Corpus | null,
  query: string,
  notes: NotesMap,
  lists: ListDef[],
  highlights: HighlightsMap
): { hits: SearchHit[]; listHits: ListHit[]; textStatus: TextSearchStatus } {
  const deferredQuery = useDeferredValue(query);
  const searching = deferredQuery.trim() !== '';
  // A field the reader has focused has usually already started this; a query typed into one that
  // hasn't (the reader's overlay opened straight onto a pasted query) starts it here.
  useEffect(() => {
    if (searching) beginTextSearchLoad(corpus);
  }, [searching, corpus]);
  const { status, index } = useSyncExternalStore(subscribeTextSearch, textSearchSnapshot, textSearchSnapshot);
  const hits = useMemo(
    () => (corpus && searching ? searchCorpusAndText(corpus, deferredQuery, notes, lists, highlights, index) : []),
    [corpus, deferredQuery, searching, notes, lists, highlights, index]
  );
  // Off the same deferred query, so both halves of the results describe one keystroke.
  const listHits = useMemo(() => searchLists(lists, deferredQuery), [lists, deferredQuery]);
  return { hits, listHits, textStatus: status };
}
