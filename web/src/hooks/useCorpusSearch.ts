import { useDeferredValue, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { searchLists, type ListHit, type SearchHit } from '../lib/search/metadata';
import {
  searchCorpusVariants,
  TEXT_LOADING_DELAY_MS,
  type RankedHit,
  type TextSearchStatus,
} from '../lib/search/text';
import {
  beginTextSearchLoad,
  searchText,
  subscribeTextSearch,
  textSearchStatus,
} from '../lib/search/textClient';
import type { Corpus, HighlightsMap, ListDef, NotesMap } from '../lib/types';

// The worker's answer turned back into hits: a sutta the metadata found keeps the hit it already
// had, and gains the snippet the text cut for it; a sutta the text alone reached gets a new one.
function hydrate(corpus: Corpus, meta: SearchHit[], ranked: RankedHit[]): SearchHit[] {
  const byId = new Map(meta.map((hit) => [hit.id, hit]));
  const hits: SearchHit[] = [];
  for (const { id, rank, snippet } of ranked) {
    const hit = byId.get(id);
    if (hit) {
      hits.push(snippet ? { ...hit, snippet } : hit);
      continue;
    }
    const sutta = corpus.suttas[id];
    if (sutta) hits.push(snippet ? { id, sutta, rank, saved: false, snippet } : { id, sutta, rank, saved: false });
  }
  return hits;
}

// The last search the worker finished answering. A mount whose query matches opens on those hits
// rather than on the metadata half alone, so returning to a search — closing the reader on one of
// its results — has its complete list, and its scroll position, in the first frame. One entry: the
// only search worth returning to is the one just left. Refreshed by the search this seeds, which
// runs anyway, so data edited while away corrects itself a moment later.
let lastCompleted: { query: string; hits: SearchHit[] } | null = null;

// Returns the sutta hits and list hits for a query, scanned off a deferred copy of it so typing
// stays responsive.
//
// The metadata half is scanned here, on the keystroke, since the reader's notes, lists and
// highlights live on this thread. The sutta text is scanned in a Web Worker, so its hits arrive a
// moment later and below the metadata hits, which is where they belong anyway — see docs/search.md.
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
): {
  hits: SearchHit[];
  listHits: ListHit[];
  textStatus: TextSearchStatus;
  textLoading: boolean;
  hitsSettled: boolean;
} {
  const deferredQuery = useDeferredValue(query);
  const searching = deferredQuery.trim() !== '';
  // A field the reader has focused has usually already started this; a query typed into one that
  // hasn't (the reader's overlay opened straight onto a pasted query) starts it here.
  useEffect(() => {
    if (searching) beginTextSearchLoad(corpus);
  }, [searching, corpus]);
  const status = useSyncExternalStore(subscribeTextSearch, textSearchStatus, textSearchStatus);
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

  const meta = useMemo(
    () => (corpus && searching ? searchCorpusVariants(corpus, deferredQuery, notes, lists, highlights) : []),
    [corpus, deferredQuery, searching, notes, lists, highlights]
  );
  // Keyed on the metadata hits themselves, so an answer to an earlier keystroke — or to the same
  // one before the reader's own data changed — is never shown against a later query.
  const [merged, setMerged] = useState<{ meta: SearchHit[]; hits: SearchHit[] } | null>(() =>
    lastCompleted?.query === deferredQuery ? { meta, hits: lastCompleted.hits } : null
  );
  useEffect(() => {
    if (!corpus || !searching || status !== 'ready') return;
    let live = true;
    const ask = meta.map(({ id, rank, saved }) => ({ id, rank, saved }));
    void searchText(deferredQuery, ask).then((ranked) => {
      if (!live || !ranked) return;
      const hits = hydrate(corpus, meta, ranked);
      lastCompleted = { query: deferredQuery, hits };
      setMerged({ meta, hits });
    });
    return () => {
      live = false;
    };
  }, [corpus, searching, status, deferredQuery, meta]);

  const hits = merged?.meta === meta ? merged.hits : meta;
  // Whether `hits` is the complete answer to this query, which a scroll restore waits for. True
  // while the search text is still loading, a wait nothing can be held back for.
  const hitsSettled = !searching || status !== 'ready' || merged?.meta === meta;
  // Off the same deferred query, so both halves of the results describe one keystroke.
  const listHits = useMemo(() => searchLists(lists, deferredQuery), [lists, deferredQuery]);
  return { hits, listHits, textStatus: status, textLoading: searching && slow, hitsSettled };
}
