import { useDeferredValue, useMemo } from 'react';
import { searchCorpus, searchLists, type ListHit, type SearchHit } from '../lib/corpus';
import type { Corpus, ListDef, NotesMap } from '../lib/types';

// Runs searchCorpus against a deferred copy of `query`, so typing stays urgent and React can
// interrupt a stale search without a hand-rolled debounce — searchCorpus scans every sutta on each
// call. Used by LibraryPage, whose one result feeds both TreePane and ListPane, and by
// ReaderSearchOverlay, which has no sibling pane to share with and runs its own scan.
export function useCorpusSearch(
  corpus: Corpus | null,
  query: string,
  notes: NotesMap,
  lists: ListDef[]
): { hits: SearchHit[]; listHits: ListHit[] } {
  const deferredQuery = useDeferredValue(query);
  const hits = useMemo(
    () => (corpus && deferredQuery.trim() ? searchCorpus(corpus, deferredQuery, notes, lists) : []),
    [corpus, deferredQuery, notes, lists]
  );
  // Off the same deferred query, so the lists block and the sutta hits below it always describe
  // the same keystroke rather than updating a frame apart.
  const listHits = useMemo(() => searchLists(lists, deferredQuery), [lists, deferredQuery]);
  return { hits, listHits };
}
