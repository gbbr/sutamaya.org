import { loadDictShardManifest } from './dictionaryShards';
import { searchTextUrls } from './search/text';
import { OFFLINE_DATA_VERSION_KEY, OFFLINE_DICTIONARY_VERSION_KEY } from './storageKeys';

// Settings' bulk offline download: the whole canon fetched as ~1MB shard bundles and unpacked into
// the same caches an ordinary read writes, so both paths produce identical entries.
//
// It never deletes. Where the device can't vouch for what it holds being current, every shard is
// refetched and overwritten in place, so a cancelled or failed run can't leave less offline text
// than it started with; where it can, an interrupted run resumes, skipping the shards already
// satisfied. Failures are tolerated per shard, and a long enough run of them trips a circuit
// rather than spending a timeout on every shard left.
const SUTTA_TEXT_CACHE = 'sutta-text';
const MANIFEST_URL = '/data/text-shards/manifest.json';
// The cache names, which must match vite.config.ts's runtimeCaching for these URLs, or the Service
// Worker can't find what this module writes.
const DICTIONARY_CACHE = 'dictionary';
const HELP_IMAGE_CACHE = 'help-images';
const SEARCH_TEXT_CACHE = 'search-text';

// Every screenshot on the help page, globbed so it can't drift from what HelpPage.tsx imports.
const HELP_IMAGE_URLS = Object.values(
  import.meta.glob('../assets/help/*.webp', { eager: true, query: '?url', import: 'default' })
) as string[];

// How long one ~1MB shard bundle may take before its fetch is abandoned. Exported so tests can
// advance fake timers by the real value.
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

// Resolves to `false` the moment `signal` aborts, so a stuck `cache.put()` — which has no
// cancellation of its own — can be abandoned rather than waited on.
function abortedAsFailure(signal: AbortSignal): Promise<false> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    signal.addEventListener('abort', () => resolve(false), { once: true });
  });
}

// Fetches one shard bundle and writes each of its suttas under the exact per-uid URL an ordinary
// read uses. Written from the page rather than left to the Service Worker, which swallows
// cache-write errors, so a resolved fetch there wouldn't mean the entry persisted.
async function fetchAndCacheShard(cache: Cache, shard: ShardEntry, signal: AbortSignal | undefined): Promise<boolean> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  if (signal?.aborted) controller.abort();
  // Cancels a stuck fetch rather than leaving it consuming network after this has moved on.
  const timer = setTimeout(() => controller.abort(), SHARD_FETCH_TIMEOUT_MS);
  try {
    const work = (async () => {
      const res = await fetch(`/data/${shard.file}`, { signal: controller.signal });
      if (!res.ok) return false;
      const bundle = (await res.json()) as Record<string, unknown>;
      for (const uid of shard.uids) {
        // Re-checked each iteration: an abort partway through has already reported this shard as
        // failed, and writing on would cache uids the caller was told failed.
        if (controller.signal.aborted) return false;
        const segs = bundle[uid];
        // A malformed or stale shard, failed rather than silently under-cached.
        if (segs === undefined) return false;
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

// Which of `uids` the cache already holds.
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

// True when every wanted uid in a shard is already cached, so the shard can be skipped. A shard
// can only be fetched whole, which is why resuming is per shard rather than per sutta.
function shardSatisfied(shard: ShardEntry, wanted: Set<string>, cached: Set<string>): boolean {
  return shard.uids.every((u) => !wanted.has(u) || cached.has(u));
}

// The wanted uids inside a set of shards, for reporting what a failed run didn't cache.
function failedUidsOf(shards: ShardEntry[], wanted: Set<string>): string[] {
  return [...new Set(shards.flatMap((s) => s.uids.filter((u) => wanted.has(u))))];
}

// How many shards are fetched at once.
const SHARD_CONCURRENCY = 4;
// Failures in a row before the circuit trips — three full batches, past which this is no longer
// flakiness but a device out of storage, where every further write is doomed.
const MAX_CONSECUTIVE_FAILURES = SHARD_CONCURRENCY * 3;

// Fetches a list of shards, in batches, until they are done or the circuit trips.
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
      // Whatever is left is reported as failed without being attempted.
      failed.push(...shards.slice(i + concurrency));
      return { failed, circuitTripped: true };
    }
  }
  return { failed, circuitTripped: false };
}

// Pulls the two search blobs and their map into Cache Storage, so a device that has downloaded the
// canon can search inside it offline rather than falling back to metadata alone. Best effort: the
// blobs are an addition to search, never a requirement, so a failure here is not reported.
export async function prefetchSearchText(dataVersion: string, signal?: AbortSignal): Promise<boolean> {
  if (!('caches' in window)) return false;
  try {
    const cache = await caches.open(SEARCH_TEXT_CACHE);
    const results = await Promise.all(
      searchTextUrls(dataVersion).map(async (url) => {
        if (signal?.aborted) return false;
        try {
          // The URLs carry dataVersion, so a cached one can never be stale and is never refetched.
          if (await cache.match(url)) return true;
          const res = await fetch(url, { signal });
          if (!res.ok) return false;
          await cache.put(new Request(url), res);
          return true;
        } catch {
          return false;
        }
      })
    );
    return results.every(Boolean);
  } catch {
    return false;
  }
}

// Downloads the sutta text for `uids`, one failed pass retried once. `dataVersion` also brings the
// search blobs down, so a downloaded canon is searchable offline as well as readable.
export async function prefetchAllSuttas(
  uids: string[],
  opts: {
    concurrency?: number;
    signal?: AbortSignal;
    // Refetch every shard rather than skipping what is cached, overwriting each entry in place.
    force?: boolean;
    onProgress?: (doneBytes: number, totalBytes: number) => void;
    // The corpus version whose search text to fetch alongside; omitted, none is.
    dataVersion?: string;
  } = {}
): Promise<{ failed: string[]; circuitTripped: boolean }> {
  const { concurrency = SHARD_CONCURRENCY, signal, force = false, onProgress, dataVersion } = opts;
  if (signal?.aborted) return { failed: [], circuitTripped: false };
  const searchText = dataVersion ? prefetchSearchText(dataVersion, signal) : null;

  const [manifest, cache] = await Promise.all([fetchManifest(signal), caches.open(SUTTA_TEXT_CACHE)]);
  const wanted = new Set(uids);
  const cached = force ? new Set<string>() : await cachedUidSet(cache, uids);

  // Only the shards holding at least one wanted uid.
  const relevantShards = manifest.shards.filter((s) => s.uids.some((u) => wanted.has(u)));
  const totalBytes = relevantShards.reduce((n, s) => n + s.bytes, 0);
  const doneBytes = { n: relevantShards.filter((s) => shardSatisfied(s, wanted, cached)).reduce((n, s) => n + s.bytes, 0) };
  onProgress?.(doneBytes.n, totalBytes);

  const remaining = relevantShards.filter((s) => !shardSatisfied(s, wanted, cached));
  const first = await runShardPass(cache, remaining, concurrency, signal, onProgress, doneBytes, totalBytes);
  if (signal?.aborted || first.failed.length === 0 || first.circuitTripped) {
    await searchText;
    return { failed: failedUidsOf(first.failed, wanted), circuitTripped: first.circuitTripped };
  }

  // One retry pass over whatever failed, through the same onProgress so the bar keeps moving.
  const second = await runShardPass(cache, first.failed, concurrency, signal, onProgress, doneBytes, totalBytes);
  await searchText;
  return { failed: failedUidsOf(second.failed, wanted), circuitTripped: second.circuitTripped };
}

// Pulls every dictionary shard into Cache Storage; the reader itself only fetches the shard a tap
// needs. `force` refetches what is already there, overwriting in place.
export async function prefetchDictionary(signal?: AbortSignal, force = false): Promise<boolean> {
  if (!('caches' in window)) return false;
  try {
    const [shards, cache] = await Promise.all([loadDictShardManifest(), caches.open(DICTIONARY_CACHE)]);
    let ok = true;
    for (let i = 0; i < shards.length; i += SHARD_CONCURRENCY) {
      if (signal?.aborted) return false;
      const batch = shards.slice(i, i + SHARD_CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (shard) => {
          const url = `/data/${shard.file}`;
          if (!force && (await cache.match(url))) return true;
          try {
            const res = await fetch(url, { signal });
            if (!res.ok) return false;
            await cache.put(new Request(url), new Response(await res.arrayBuffer(), { headers: { 'Content-Type': 'application/json' } }));
            return true;
          } catch {
            return false;
          }
        })
      );
      if (results.some((r) => !r)) ok = false;
    }
    return ok;
  } catch {
    return false;
  }
}

// Pulls the help page's screenshots in alongside the canon, so the guide reads offline too.
// Best-effort, with no failure state in Settings, and no `force`: the filenames are
// content-hashed, so a cached one can never be stale.
export async function prefetchHelpImages(signal?: AbortSignal): Promise<boolean> {
  if (!('caches' in window)) return false;
  try {
    const cache = await caches.open(HELP_IMAGE_CACHE);
    const results = await Promise.all(
      HELP_IMAGE_URLS.map(async (url) => {
        if (signal?.aborted) return false;
        try {
          if (await cache.match(url)) return true;
          const res = await fetch(url, { signal });
          if (!res.ok) return false;
          await cache.put(new Request(url), res);
          return true;
        } catch {
          return false;
        }
      })
    );
    return results.every(Boolean);
  } catch {
    return false;
  }
}

// The corpus versions this device last completed a full download at, absent for anyone who has
// never bulk-downloaded. Written only on a clean finish, a half-updated cache being exactly the
// stale state this reports.
export function cachedCorpusVersions(): { data: string | null; dictionary: string | null } {
  try {
    return {
      data: localStorage.getItem(OFFLINE_DATA_VERSION_KEY),
      dictionary: localStorage.getItem(OFFLINE_DICTIONARY_VERSION_KEY),
    };
  } catch {
    return { data: null, dictionary: null };
  }
}

// Records one half's version, after a clean download of it.
export function recordCachedCorpusVersion(which: 'data' | 'dictionary', version: string): void {
  try {
    localStorage.setItem(which === 'data' ? OFFLINE_DATA_VERSION_KEY : OFFLINE_DICTIONARY_VERSION_KEY, version);
  } catch {
    // storage unavailable — ignore
  }
}

// True when the text cached on this device is older than what this build serves; only ever true
// for a device that finished a bulk download.
export function isOfflineTextStale(dataVersion: string): boolean {
  const cached = cachedCorpusVersions().data;
  return cached !== null && cached !== dataVersion;
}

// How many of `uids` are cached, for Settings' offline-availability line.
export async function estimateOfflineStatus(uids: string[]): Promise<{ cached: number; total: number }> {
  if (!('caches' in window)) return { cached: 0, total: uids.length };
  const cache = await caches.open(SUTTA_TEXT_CACHE);
  const cached = await cachedUidSet(cache, uids);
  return { cached: cached.size, total: uids.length };
}
