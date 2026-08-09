const SUTTA_TEXT_CACHE = 'sutta-text';
// Exported so tests can advance fake timers by the real value instead of duplicating it.
export const FETCH_TIMEOUT_MS = 20_000;

function textUrl(uid: string): string {
  return `/data/text/${encodeURIComponent(uid)}.json`;
}

function uidFromCacheUrl(url: string): string | null {
  const m = new URL(url).pathname.match(/^\/data\/text\/(.+)\.json$/);
  return m ? decodeURIComponent(m[1]) : null;
}

// Resolves to `false` the moment `signal` fires abort — whether that's from FETCH_TIMEOUT_MS
// elapsing or the caller cancelling — without waiting for whatever it's racing against to notice.
// The Cache API's put() takes no cancellation mechanism of its own, so this is what lets a stuck
// cache.put() actually be abandoned instead of blocking; earlier this was a fixed setTimeout
// promise wired to nothing, so Cancel couldn't interrupt a stuck item early — it had to wait out
// the same full timeout as a genuine timeout would, making a user-initiated Cancel feel broken.
function abortedAsFailure(signal: AbortSignal): Promise<false> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    signal.addEventListener('abort', () => resolve(false), { once: true });
  });
}

// Fetches one sutta's text and writes it directly into the sutta-text Cache Storage cache from
// the page, rather than trusting that a resolved fetch() implies the Service Worker's own
// CacheFirst rule (vite.config.ts) succeeded in caching it — Workbox swallows cache-write errors
// internally so a failed cache.put() on the SW side is invisible to the page, which previously let
// this report "success" (and advance progress) for items that were never actually persisted.
async function fetchAndCache(cache: Cache, uid: string, signal: AbortSignal | undefined): Promise<boolean> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  if (signal?.aborted) controller.abort();
  // Also aborts `controller` on timeout (not just rejecting independently of it, this file's
  // previous approach) — so a stuck fetch() is actually cancelled rather than abandoned to keep
  // consuming network in the background for no reason once this function has moved on.
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const work = (async () => {
      const request = new Request(textUrl(uid));
      const res = await fetch(request, { signal: controller.signal });
      if (!res.ok) return false;
      // Re-checked here, not just at the top — abortedAsFailure below can already have won the
      // race by the time this fetch resolves, in which case fetchAndCache has already returned
      // `false` to its caller. Writing to the cache anyway at that point — the abandoned `work`
      // promise keeps running even after losing the race — would silently cache an item this
      // function already reported as failed, the exact "reported state and real cache state
      // disagree" problem this whole module exists to avoid.
      if (controller.signal.aborted) return false;
      await cache.put(request, res);
      return true;
    })();
    return await Promise.race([work, abortedAsFailure(controller.signal)]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function cachedUidSet(cache: Cache, uids: string[]): Promise<Set<string>> {
  const keys = await cache.keys();
  const cached = new Set<string>();
  const wanted = new Set(uids);
  for (const req of keys) {
    const uid = uidFromCacheUrl(req.url);
    if (uid && wanted.has(uid)) cached.add(uid);
  }
  return cached;
}

// Three full batches' worth of failures in a row, at the default concurrency — past this point,
// it's no longer plausible this is ordinary flakiness. Observed on-device: a download that
// consistently, reproducibly capped at the same item count even across full app restarts, most
// likely because the device is genuinely low on free storage and every new cache.put() from here
// on is doomed. Without this, "doomed" still meant grinding through every remaining item one
// FETCH_TIMEOUT_MS-bounded failure at a time — for thousands of items, indistinguishable from
// hanging forever even though each individual step was technically bounded.
const MAX_CONSECUTIVE_FAILURES = 18;

async function runPass(
  cache: Cache,
  uids: string[],
  concurrency: number,
  signal: AbortSignal | undefined,
  onProgress: ((done: number, total: number) => void) | undefined,
  doneCount: { n: number },
  total: number
): Promise<{ failed: string[]; circuitTripped: boolean }> {
  const failed: string[] = [];
  let consecutiveFailures = 0;
  for (let i = 0; i < uids.length; i += concurrency) {
    if (signal?.aborted) break;
    const batch = uids.slice(i, i + concurrency);
    const results = await Promise.all(batch.map((uid) => fetchAndCache(cache, uid, signal)));
    results.forEach((ok, idx) => {
      if (ok) {
        doneCount.n++;
        consecutiveFailures = 0;
      } else {
        failed.push(batch[idx]);
        consecutiveFailures++;
      }
    });
    onProgress?.(doneCount.n, total);
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      // Whatever's left is presumed doomed too — reported as failed without spending another
      // FETCH_TIMEOUT_MS on each to prove it.
      failed.push(...uids.slice(i + concurrency));
      return { failed, circuitTripped: true };
    }
  }
  return { failed, circuitTripped: false };
}

export async function prefetchAllSuttas(
  uids: string[],
  opts: { concurrency?: number; signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {}
): Promise<{ failed: string[]; circuitTripped: boolean }> {
  const { concurrency = 6, signal, onProgress } = opts;
  const cache = await caches.open(SUTTA_TEXT_CACHE);
  const alreadyCached = await cachedUidSet(cache, uids);
  const doneCount = { n: alreadyCached.size };
  onProgress?.(doneCount.n, uids.length);

  const remaining = uids.filter((u) => !alreadyCached.has(u));
  const first = await runPass(cache, remaining, concurrency, signal, onProgress, doneCount, uids.length);
  if (signal?.aborted || first.failed.length === 0 || first.circuitTripped) return first;

  // Retry through the same onProgress callback — no more silent second pass leaving the UI
  // looking frozen while it's actually still working.
  return runPass(cache, first.failed, concurrency, signal, onProgress, doneCount, uids.length);
}

export async function estimateOfflineStatus(uids: string[]): Promise<{ cached: number; total: number }> {
  if (!('caches' in window)) return { cached: 0, total: uids.length };
  const cache = await caches.open(SUTTA_TEXT_CACHE);
  const cached = await cachedUidSet(cache, uids);
  return { cached: cached.size, total: uids.length };
}
