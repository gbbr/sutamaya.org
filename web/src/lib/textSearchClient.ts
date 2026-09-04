// The main thread's side of full-text search: the worker's lifecycle, the load status the UI
// renders, and one search at a time over the message boundary — see docs/search.md's "Off the main
// thread" and "Late, or never".
//
// Nothing here scans anything. The blobs are the worker's, and the only thing this module holds of
// them is whether they are loaded.
import type { Corpus } from './types';
import type { RankedHit, TextSearchStatus } from './textSearch';
import type { SearchRequest, SearchResponse } from './searchWorker';

let worker: Worker | null = null;
let status: TextSearchStatus = 'idle';
const listeners = new Set<() => void>();

// The search the worker is answering, and the one waiting for it to finish.
let lastId = 0;
let awaiting: { id: number; resolve: (hits: RankedHit[] | null) => void } | null = null;
let queued: { query: string; meta: RankedHit[]; resolve: (hits: RankedHit[] | null) => void } | null = null;

function publish(next: TextSearchStatus): void {
  if (status === next) return;
  status = next;
  for (const fn of listeners) fn();
}

export function subscribeTextSearch(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function textSearchStatus(): TextSearchStatus {
  return status;
}

// Ends the worker and answers whatever was waiting on it with nothing, which leaves the caller its
// metadata hits.
function stopWorker(): void {
  worker?.terminate();
  worker = null;
  awaiting?.resolve(null);
  queued?.resolve(null);
  awaiting = null;
  queued = null;
}

function onMessage(event: MessageEvent<SearchResponse>): void {
  const msg = event.data;
  if (msg.type === 'status') {
    if (msg.status === 'unavailable') stopWorker();
    publish(msg.status);
    return;
  }
  if (awaiting?.id !== msg.id) return;
  awaiting.resolve(msg.hits);
  awaiting = null;
  pump();
}

// Hands the waiting search to the worker, once it has finished the one before it. The scan is tens
// of milliseconds and a reader types faster than that, so queueing every keystroke would answer
// each one long after it was typed.
function pump(): void {
  if (awaiting || !queued || !worker) return;
  const job = queued;
  queued = null;
  awaiting = { id: ++lastId, resolve: job.resolve };
  send({ type: 'search', id: awaiting.id, query: job.query, meta: job.meta });
}

function send(msg: SearchRequest): void {
  worker?.postMessage(msg);
}

// Starts the one fetch of the search text, if it hasn't been started. Called when a search field is
// focused, and again on the first keystroke — never on app start, since this is ~2.4 MB served
// that a reader who doesn't search should not pay for.
export function beginTextSearchLoad(corpus: Corpus | null): void {
  if (!corpus || status === 'loading' || status === 'ready') return;
  if (!worker) {
    try {
      worker = new Worker(new URL('./searchWorker.ts', import.meta.url), { type: 'module' });
      worker.addEventListener('message', onMessage);
      // A worker that dies takes the text with it, and search carries on without it.
      worker.addEventListener('error', () => {
        stopWorker();
        publish('unavailable');
      });
    } catch {
      // No worker on this device: search stays what it is without the sutta text.
      publish('unavailable');
      return;
    }
  }
  publish('loading');
  send({ type: 'load', dataVersion: corpus.dataVersion });
}

// Forgets the loaded text, back to the state before anything asked for it. The next search starts a
// new worker, which fetches again and is served from Cache Storage rather than the network.
export function resetTextSearch(): void {
  stopWorker();
  publish('idle');
}

// The suttas whose text answers `query`, merged into `meta` and ordered — null where the worker has
// no text to scan, which leaves `meta` the whole result.
export function searchText(query: string, meta: RankedHit[]): Promise<RankedHit[] | null> {
  if (!worker || status !== 'ready') return Promise.resolve(null);
  return new Promise((resolve) => {
    // Only the newest waiting search is worth running; an older one has been typed over already.
    queued?.resolve(null);
    queued = { query, meta, resolve };
    pump();
  });
}

// Drops the text once the app has been out of sight for `IDLE_RELEASE_MS`. It is ~34 MB of strings,
// which is worth holding while the reader is searching and not worth holding while they are
// elsewhere — an idle tab carrying it is a bigger target for iOS to discard outright, and that
// costs a whole reload rather than the re-read this costs.
const IDLE_RELEASE_MS = 60_000;
let releaseTimer: ReturnType<typeof setTimeout> | undefined;

// Starts releasing the text when the page is hidden, and stops if it comes back first.
export function watchTextSearchIdle(): () => void {
  const onChange = () => {
    clearTimeout(releaseTimer);
    if (document.visibilityState === 'hidden' && status === 'ready') {
      releaseTimer = setTimeout(resetTextSearch, IDLE_RELEASE_MS);
    }
  };
  document.addEventListener('visibilitychange', onChange);
  return () => {
    clearTimeout(releaseTimer);
    document.removeEventListener('visibilitychange', onChange);
  };
}
