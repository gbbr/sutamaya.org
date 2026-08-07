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

worker.onmessage = () => {
  fetch('/data/dictionary.json')
    .then((res) => res.json())
    .then((dictionary) => worker.postMessage({ ok: true, dictionary }))
    .catch((error: unknown) => worker.postMessage({ ok: false, error: String(error) }));
};
