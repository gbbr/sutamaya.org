// Fetches and JSON.parses dictionary.json (~20MB) off the main thread — see loadDictionary() in
// lib/corpus.ts. Parsing that much JSON is a real, visible main-thread stall at app boot even
// though the response itself is served from the Service Worker's Cache Storage after the first
// visit (vite-plugin-pwa's `CacheFirst` caching for this URL avoids the repeat network fetch,
// but not the parse cost — that's what running it here avoids).
//
// `self` here is really a DedicatedWorkerGlobalScope, but the project's tsconfig only pulls in
// the "DOM" lib (which can't coexist with "webworker" in the same program), so TypeScript sees
// `self` as `Window` and would reject the worker's own single-argument postMessage (Window's
// version requires a targetOrigin). Cast to the plain `Worker` interface just for its
// postMessage/onmessage signatures.
const worker = self as unknown as Worker;

const DICTIONARY_URL = '/data/dictionary.json';

// No bytes at all for this long means the connection has stalled, not that it's merely slow. The
// distinction is why the body is streamed rather than fetched with a plain overall timeout: 20MB
// legitimately takes minutes on a poor mobile connection, and aborting that would leave exactly
// the users who most need an offline dictionary unable to ever finish downloading one.
const STALL_TIMEOUT_MS = 30_000;

// How often, at most, to tell the main thread this worker is still alive while bytes are arriving
// — its watchdog (loadDictionary) needs a heartbeat to distinguish a slow download from a worker
// that has been killed outright.
const PING_INTERVAL_MS = 2_000;

async function fetchDictionaryBody(): Promise<Blob> {
  const controller = new AbortController();
  let stall = setTimeout(() => controller.abort(), STALL_TIMEOUT_MS);
  const restartStall = () => {
    clearTimeout(stall);
    stall = setTimeout(() => controller.abort(), STALL_TIMEOUT_MS);
  };
  try {
    const res = await fetch(DICTIONARY_URL, { signal: controller.signal });
    // An error response can still carry a body that parses as JSON (an error payload, a proxy's
    // own page), which would otherwise be handed to the reader as though it were the dictionary.
    if (!res.ok) throw new Error(`Failed to load dictionary.json (${res.status})`);
    if (!res.body) return res.blob();
    const reader = res.body.getReader();
    const chunks: BlobPart[] = [];
    let lastPing = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
      restartStall();
      const now = Date.now();
      if (now - lastPing >= PING_INTERVAL_MS) {
        lastPing = now;
        worker.postMessage({ ping: true });
      }
    }
    return new Blob(chunks);
  } finally {
    clearTimeout(stall);
  }
}

worker.onmessage = () => {
  void (async () => {
    let body: Blob;
    try {
      body = await fetchDictionaryBody();
    } catch (error: unknown) {
      worker.postMessage({ ok: false, error: String(error) });
      return;
    }
    try {
      worker.postMessage({ ok: true, dictionary: JSON.parse(await body.text()) });
    } catch (error: unknown) {
      // The bytes arrived but aren't the dictionary — a captive portal's login page, a truncated
      // write. `CacheFirst` (vite.config.ts) stores whatever that was for a year, so every later
      // attempt would replay it from cache and fail identically; `corrupt` is what tells the main
      // thread to drop that entry before retrying (see loadDictionary in lib/corpus.ts).
      worker.postMessage({ ok: false, corrupt: true, error: String(error) });
    }
  })();
};
