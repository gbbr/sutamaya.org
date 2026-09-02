import { useDeferredValue, useMemo } from 'react';
import { searchCorpus, searchLists, type ListHit, type SearchHit } from '../lib/corpus';
import type { Corpus, HighlightsMap, ListDef, NotesMap } from '../lib/types';

// Returns the sutta hits and list hits for a query, scanned off a deferred copy of it so typing
// stays responsive while searchCorpus walks every sutta.
export function useCorpusSearch(
  corpus: Corpus | null,
  query: string,
  notes: NotesMap,
  lists: ListDef[],
  highlights: HighlightsMap
): { hits: SearchHit[]; listHits: ListHit[] } {
  const deferredQuery = useDeferredValue(query);
  const hits = useMemo(
    () => (corpus && deferredQuery.trim() ? searchCorpus(corpus, deferredQuery, notes, lists, highlights) : []),
    [corpus, deferredQuery, notes, lists, highlights]
  );
  // Off the same deferred query, so both halves of the results describe one keystroke.
  const listHits = useMemo(() => searchLists(lists, deferredQuery), [lists, deferredQuery]);
  return { hits, listHits };
}
