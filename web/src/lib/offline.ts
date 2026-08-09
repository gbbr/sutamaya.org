const SUTTA_TEXT_CACHE = 'sutta-text';
const MANIFEST_URL = '/data/text-shards/manifest.json';

// Exported so tests can advance fake timers by the real value instead of duplicating it. Shards
// are ~1MB bundles of many suttas (see scripts/build-corpus.mjs's SHARD_TARGET_BYTES), not the
// single small file a reactive per-sutta read fetches, so this budget is deliberately much
// larger than a single-file fetch would need.
export const SHARD_FETCH_TIMEOUT_MS = 60_000;

export interface ShardEntry {
  file: string;
  bytes: number;
  uids: string[];
}

export interface ShardManifest {
  totalBytes: number;
  totalUids: number;
  shards: ShardEntry[];
}

function textUrl(uid: string): string {
  return `/data/text/${encodeURIComponent(uid)}.json`;
}

function uidFromCacheUrl(url: string): string | null {
  const m = new URL(url).pathname.match(/^\/data\/text\/(.+)\.json$/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function fetchManifest(signal: AbortSignal | undefined): Promise<ShardManifest> {
  const res = await fetch(MANIFEST_URL, { signal });
  if (!res.ok) throw new Error(`Failed to fetch shard manifest: ${res.status}`);
  return res.json();
}

// Resolves to `false` the moment `signal` fires abort — whether that's from SHARD_FETCH_TIMEOUT_MS
// elapsing or the caller cancelling — without waiting for whatever it's racing against to notice.
// The Cache API's put() takes no cancellation mechanism of its own, so this is what lets a stuck
// cache.put() actually be abandoned instead of blocking.
function abortedAsFailure(signal: AbortSignal): Promise<false> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    signal.addEventListener('abort', () => resolve(false), { once: true });
  });
}

// Fetches one shard bundle and writes each of its suttas directly into the sutta-text Cache
// Storage cache, under the exact same per-uid URL the reactive CacheFirst rule (vite.config.ts)
// uses at read time — so a bulk download and an ordinary "open this sutta" populate the same
// cache entries, and the reader never knows which path put something there. Written directly
// from the page rather than trusting a resolved fetch() to imply the Service Worker's own
// CacheFirst rule succeeded — Workbox swallows cache-write errors internally, which previously
// let a failed cache.put() on the SW side report as "success" for items never actually persisted.
async function fetchAndCacheShard(cache: Cache, shard: ShardEntry, signal: AbortSignal | undefined): Promise<boolean> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  if (signal?.aborted) controller.abort();
  // Also aborts `controller` on timeout (not just rejecting independently of it) — so a stuck
  // fetch() is actually cancelled rather than abandoned to keep consuming network in the
  // background once this function has moved on.
  const timer = setTimeout(() => controller.abort(), SHARD_FETCH_TIMEOUT_MS);
  try {
    const work = (async () => {
      const res = await fetch(`/data/${shard.file}`, { signal: controller.signal });
      if (!res.ok) return false;
      const bundle = (await res.json()) as Record<string, unknown>;
      for (const uid of shard.uids) {
        // Re-checked on every iteration, not just at the top — abortedAsFailure below can already
        // have won the race by the time this loop is partway through, in which case
        // fetchAndCacheShard has already returned `false` to its caller. Writing more entries to
        // the cache anyway at that point would silently cache uids this function already reported
        // as failed — the exact "reported state and real cache state disagree" problem this
        // module exists to avoid. A retry re-fetches and overwrites the whole shard regardless, so
        // any entries written before the abort are harmless, just redundant.
        if (controller.signal.aborted) return false;
        const segs = bundle[uid];
        if (segs === undefined) return false; // malformed/stale shard — don't silently under-cache
        await cache.put(new Request(textUrl(uid)), new Response(JSON.stringify(segs), { headers: { 'Content-Type': 'application/json' } }));
      }
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

// A shard can only be fetched whole — there's no per-sutta resumability within one anymore (the
// tradeoff for cutting ~4000 requests down to a few dozen). "Satisfied" means every uid this
// caller actually wants out of that shard is already individually cached, so the shard can be
// skipped entirely rather than re-downloaded.
function shardSatisfied(shard: ShardEntry, wanted: Set<string>, cached: Set<string>): boolean {
  return shard.uids.every((u) => !wanted.has(u) || cached.has(u));
}

function failedUidsOf(shards: ShardEntry[], wanted: Set<string>): string[] {
  return [...new Set(shards.flatMap((s) => s.uids.filter((u) => wanted.has(u))))];
}

// Three full batches' worth of failures in a row, at the default concurrency — past this point,
// it's no longer plausible this is ordinary flakiness. Observed on-device (back when this was a
// per-sutta fetch): a download that consistently, reproducibly capped at the same point even
// across full app restarts, most likely because the device is genuinely low on free storage and
// every new cache.put() from here on is doomed.
const SHARD_CONCURRENCY = 4;
const MAX_CONSECUTIVE_FAILURES = SHARD_CONCURRENCY * 3;

async function runShardPass(
  cache: Cache,
  shards: ShardEntry[],
  concurrency: number,
  signal: AbortSignal | undefined,
  onProgress: ((doneBytes: number, totalBytes: number) => void) | undefined,
  doneBytes: { n: number },
  totalBytes: number
): Promise<{ failed: ShardEntry[]; circuitTripped: boolean }> {
  const failed: ShardEntry[] = [];
  let consecutiveFailures = 0;
  for (let i = 0; i < shards.length; i += concurrency) {
    if (signal?.aborted) break;
    const batch = shards.slice(i, i + concurrency);
    const results = await Promise.all(batch.map((shard) => fetchAndCacheShard(cache, shard, signal)));
    results.forEach((ok, idx) => {
      if (ok) {
        doneBytes.n += batch[idx].bytes;
        consecutiveFailures = 0;
      } else {
        failed.push(batch[idx]);
        consecutiveFailures++;
      }
    });
    onProgress?.(doneBytes.n, totalBytes);
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      // Whatever's left is presumed doomed too — reported as failed without spending another
      // SHARD_FETCH_TIMEOUT_MS on each to prove it.
      failed.push(...shards.slice(i + concurrency));
      return { failed, circuitTripped: true };
    }
  }
  return { failed, circuitTripped: false };
}

export async function prefetchAllSuttas(
  uids: string[],
  opts: { concurrency?: number; signal?: AbortSignal; onProgress?: (doneBytes: number, totalBytes: number) => void } = {}
): Promise<{ failed: string[]; circuitTripped: boolean }> {
  const { concurrency = SHARD_CONCURRENCY, signal, onProgress } = opts;
  if (signal?.aborted) return { failed: [], circuitTripped: false };

  const [manifest, cache] = await Promise.all([fetchManifest(signal), caches.open(SUTTA_TEXT_CACHE)]);
  const wanted = new Set(uids);
  const cached = await cachedUidSet(cache, uids);

  // Restricted to shards that actually contain at least one wanted uid — irrelevant in practice
  // ("download all suttas" always wants everything the manifest has), but keeps this correct if
  // that ever changes without needing to special-case "download everything".
  const relevantShards = manifest.shards.filter((s) => s.uids.some((u) => wanted.has(u)));
  const totalBytes = relevantShards.reduce((n, s) => n + s.bytes, 0);
  const doneBytes = { n: relevantShards.filter((s) => shardSatisfied(s, wanted, cached)).reduce((n, s) => n + s.bytes, 0) };
  onProgress?.(doneBytes.n, totalBytes);

  const remaining = relevantShards.filter((s) => !shardSatisfied(s, wanted, cached));
  const first = await runShardPass(cache, remaining, concurrency, signal, onProgress, doneBytes, totalBytes);
  if (signal?.aborted || first.failed.length === 0 || first.circuitTripped) {
    return { failed: failedUidsOf(first.failed, wanted), circuitTripped: first.circuitTripped };
  }

  // Retry through the same onProgress callback — no more silent second pass leaving the UI
  // looking frozen while it's actually still working.
  const second = await runShardPass(cache, first.failed, concurrency, signal, onProgress, doneBytes, totalBytes);
  return { failed: failedUidsOf(second.failed, wanted), circuitTripped: second.circuitTripped };
}

export async function estimateOfflineStatus(uids: string[]): Promise<{ cached: number; total: number }> {
  if (!('caches' in window)) return { cached: 0, total: uids.length };
  const cache = await caches.open(SUTTA_TEXT_CACHE);
  const cached = await cachedUidSet(cache, uids);
  return { cached: cached.size, total: uids.length };
}
