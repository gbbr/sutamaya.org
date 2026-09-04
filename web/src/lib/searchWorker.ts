// The Web Worker that holds the sutta text and scans it — see docs/search.md's "Off the main
// thread".
//
// It owns the two blobs from the moment they are fetched to the moment the worker is terminated, so
// the ~34 MB never reaches the main thread's heap and the ~150 ms worst-case scan never blocks a
// keystroke. Everything it does is lib/textSearch.ts, unchanged; this file is the transport.
//
// The metadata half of a search stays on the main thread, which is where the reader's notes, lists
// and highlights live, and arrives here as the ranked ids to merge the text hits into.
import { searchKey } from './corpus';
import {
  fetchTextIndex,
  mergeSearchHits,
  searchTextVariants,
  type RankedHit,
  type TextIndex,
  type TextSearchStatus,
} from './textSearch';

// Sent to load the text, and to run one search once it is loaded.
export type SearchRequest =
  | { type: 'load'; dataVersion: string }
  | { type: 'search'; id: number; query: string; meta: RankedHit[] };

// The load's outcome, and one answer per search. `hits` is null where the text isn't loaded, which
// leaves the metadata hits the main thread already has as the whole result.
export type SearchResponse =
  | { type: 'status'; status: TextSearchStatus }
  | { type: 'result'; id: number; hits: RankedHit[] | null };

let index: TextIndex | null = null;
let loading = false;

const post = (msg: SearchResponse) => (self as unknown as Worker).postMessage(msg);

function load(dataVersion: string): void {
  if (index || loading) return;
  loading = true;
  fetchTextIndex(dataVersion)
    .then((loaded) => {
      index = loaded;
      post({ type: 'status', status: 'ready' });
    })
    // The client terminates this worker on a failure, so the next search starts a fresh one and
    // fetches again: a reader who searched offline gets the sutta text as soon as they are back.
    .catch(() => post({ type: 'status', status: 'unavailable' }))
    .finally(() => {
      loading = false;
    });
}

function search(query: string, meta: RankedHit[]): RankedHit[] | null {
  if (!index) return null;
  const q = searchKey(query.trim());
  if (!q) return null;
  return mergeSearchHits(meta, searchTextVariants(index, query), index, q, (uid, bucket) => ({
    id: uid,
    rank: bucket,
    saved: false,
  }));
}

self.addEventListener('message', (event: MessageEvent<SearchRequest>) => {
  const msg = event.data;
  if (msg.type === 'load') load(msg.dataVersion);
  else post({ type: 'result', id: msg.id, hits: search(msg.query, msg.meta) });
});
