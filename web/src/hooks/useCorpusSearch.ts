import { useDeferredValue, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { searchLists, type ListHit, type SearchHit } from '../lib/search/metadata';
import { searchCorpusVariants, type RankedHit, type TextSearchStatus } from '../lib/search/text';
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
// `textStatus` is what the caller says in an empty result and `textPending` whether it draws the
// "Searching sutta text…" state in place of the results: the search text is fetched lazily and
// scanned off the main thread, and until that first answer arrives there is no ranked list to show
// — see docs/search.md's "Late, or never".
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
  textPending: boolean;
  hitsSettled: boolean;
} {
  const deferredQuery = useDeferredValue(query);
  const searching = deferredQuery.trim() !== '';
  // A field the reader has focused has usually already started this; a query typed into one that
  // hasn't (the reader's overlay opened straight onto a pasted query) starts it here, as does a
  // search still on screen when the idle release drops the text.
  const status = useSyncExternalStore(subscribeTextSearch, textSearchStatus, textSearchStatus);
  useEffect(() => {
    if (searching && status === 'idle') beginTextSearchLoad(corpus);
  }, [searching, corpus, status]);

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
      if (!live) return;
      // The worker died mid-search: the metadata half is the whole answer from here, so nothing
      // is held over it.
      if (!ranked) {
        setMerged(null);
        return;
      }
      const hits = hydrate(corpus, meta, ranked);
      lastCompleted = { query: deferredQuery, hits };
      setMerged({ meta, hits });
    });
    return () => {
      live = false;
    };
  }, [corpus, searching, status, deferredQuery, meta]);

  const answered = merged?.meta === meta;
  // Whether the results are waiting on the text: still on its way, or here and still being scanned
  // for a search that has nothing on screen yet. No rows, and the caller says so instead. The
  // metadata half alone ranks the suttas differently, so showing it would put a list on screen that
  // reorders under the reader a second or two later.
  const textPending =
    searching && !answered && (status === 'idle' || status === 'loading' || (status === 'ready' && !merged));
  // The results while the worker answers the newest keystroke: the previous answer, held, rather
  // than this keystroke's metadata half. The rows keep their text hits and their snippets, and
  // only the marked words move, until the new answer replaces them. Held only where an answer is
  // coming — with the text gone for good, the metadata half is the answer.
  const hits = textPending ? [] : merged && (answered || (searching && status === 'ready')) ? merged.hits : meta;
  // Whether `hits` is the complete answer to this query, which a scroll restore waits for.
  const hitsSettled = !searching || (!textPending && (status !== 'ready' || answered));
  // Off the same deferred query, so both halves of the results describe one keystroke.
  const listHits = useMemo(() => searchLists(lists, deferredQuery), [lists, deferredQuery]);
  return { hits, listHits, textStatus: status, textPending, hitsSettled };
}
