import { useDeferredValue, useMemo } from 'react';
import { searchCorpus, searchLists, type ListHit, type SearchHit } from '../lib/corpus';
import type { Corpus, ListDef, NotesMap } from '../lib/types';

// Runs searchCorpus against a deferred copy of `query` — deferred rather than tied directly to
// the input so typing itself always stays urgent and React can interrupt/restart a stale search
// if the user keeps typing, without a hand-rolled debounce timer (searchCorpus scans every sutta
// in the corpus on each call). Shared by LibraryPage (whose one result feeds both TreePane and
// ListPane — see LibraryPage's own comment on why it isn't computed twice) and
// ReaderSearchOverlay (which runs its own independent scan, having no sibling pane to share with).
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
