import { loadDictShardManifest } from './dictionaryShards';
import { OFFLINE_DATA_VERSION_KEY, OFFLINE_DICTIONARY_VERSION_KEY } from './storageKeys';

const SUTTA_TEXT_CACHE = 'sutta-text';
const MANIFEST_URL = '/data/text-shards/manifest.json';
// Must match vite.config.ts's runtimeCaching cacheName/urlPattern for these URLs, or the Service
// Worker's CacheFirst rule can't find what this module writes.
const DICTIONARY_CACHE = 'dictionary';
const HELP_IMAGE_CACHE = 'help-images';

// Every screenshot on the help page. Globbed rather than listed so it can't drift from what
// HelpPage.tsx imports. Vite resolves the glob at build time to the same content-hashed URLs the
// page requests, so a cache entry written here satisfies the page's own <img>.
const HELP_IMAGE_URLS = Object.values(
  import.meta.glob('../assets/help/*.webp', { eager: true, query: '?url', import: 'default' })
) as string[];

// Generous, because a shard is a ~1MB bundle of many suttas (scripts/build-corpus.mjs's
// SHARD_TARGET_BYTES), not the single small file a reactive per-sutta read fetches. Exported so
// tests can advance fake timers by the real value.
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

// Resolves to `false` the moment `signal` aborts, without waiting for whatever it is racing to
// notice. The Cache API's put() has no cancellation of its own, so this is what lets a stuck
// cache.put() be abandoned.
function abortedAsFailure(signal: AbortSignal): Promise<false> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    signal.addEventListener('abort', () => resolve(false), { once: true });
  });
}

// Fetches one shard bundle and writes each of its suttas into the sutta-text cache under the exact
// per-uid URL the reactive CacheFirst rule (vite.config.ts) reads, so a bulk download and an
// ordinary "open this sutta" produce identical entries. Written from the page rather than left to
// the Service Worker: Workbox swallows cache-write errors internally, so a resolved fetch() there
// doesn't mean the entry persisted.
async function fetchAndCacheShard(cache: Cache, shard: ShardEntry, signal: AbortSignal | undefined): Promise<boolean> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  if (signal?.aborted) controller.abort();
  // Aborts `controller` on timeout, so a stuck fetch() is cancelled rather than left consuming
  // network after this function has moved on.
  const timer = setTimeout(() => controller.abort(), SHARD_FETCH_TIMEOUT_MS);
  try {
    const work = (async () => {
      const res = await fetch(`/data/${shard.file}`, { signal: controller.signal });
      if (!res.ok) return false;
      const bundle = (await res.json()) as Record<string, unknown>;
      for (const uid of shard.uids) {
        // Re-checked every iteration: abortedAsFailure can win the race partway through this loop,
        // by which point this shard has already been reported as failed. Writing on would cache
        // uids the caller was told about as failures. Entries written before the abort are
        // harmless — a retry refetches and overwrites the whole shard.
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

// A shard can only be fetched whole, so resumability is per shard rather than per sutta.
// "Satisfied" means every uid this caller wants out of that shard is already individually cached,
// and the shard can be skipped.
function shardSatisfied(shard: ShardEntry, wanted: Set<string>, cached: Set<string>): boolean {
  return shard.uids.every((u) => !wanted.has(u) || cached.has(u));
}

function failedUidsOf(shards: ShardEntry[], wanted: Set<string>): string[] {
  return [...new Set(shards.flatMap((s) => s.uids.filter((u) => wanted.has(u))))];
}

// Three full batches' worth of failures in a row at the default concurrency, past which this is no
// longer ordinary flakiness — a device out of storage, say, where every further cache.put() is
// doomed. The circuit trips rather than burning a SHARD_FETCH_TIMEOUT_MS on every remaining shard.
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
      // Whatever is left is presumed doomed too, and reported as failed without being attempted.
      failed.push(...shards.slice(i + concurrency));
      return { failed, circuitTripped: true };
    }
  }
  return { failed, circuitTripped: false };
}

// `force` refetches every shard instead of skipping uids already present, overwriting each cache
// entry in place. That is how a device whose cached text can't be vouched for is brought up to
// date: clearing the cache first would leave a failed or cancelled run with less offline text than
// it started with.
export async function prefetchAllSuttas(
  uids: string[],
  opts: {
    concurrency?: number;
    signal?: AbortSignal;
    force?: boolean;
    onProgress?: (doneBytes: number, totalBytes: number) => void;
  } = {}
): Promise<{ failed: string[]; circuitTripped: boolean }> {
  const { concurrency = SHARD_CONCURRENCY, signal, force = false, onProgress } = opts;
  if (signal?.aborted) return { failed: [], circuitTripped: false };

  const [manifest, cache] = await Promise.all([fetchManifest(signal), caches.open(SUTTA_TEXT_CACHE)]);
  const wanted = new Set(uids);
  const cached = force ? new Set<string>() : await cachedUidSet(cache, uids);

  // Only shards holding at least one wanted uid. Today's caller wants everything the manifest has,
  // but this keeps a narrower `uids` correct.
  const relevantShards = manifest.shards.filter((s) => s.uids.some((u) => wanted.has(u)));
  const totalBytes = relevantShards.reduce((n, s) => n + s.bytes, 0);
  const doneBytes = { n: relevantShards.filter((s) => shardSatisfied(s, wanted, cached)).reduce((n, s) => n + s.bytes, 0) };
  onProgress?.(doneBytes.n, totalBytes);

  const remaining = relevantShards.filter((s) => !shardSatisfied(s, wanted, cached));
  const first = await runShardPass(cache, remaining, concurrency, signal, onProgress, doneBytes, totalBytes);
  if (signal?.aborted || first.failed.length === 0 || first.circuitTripped) {
    return { failed: failedUidsOf(first.failed, wanted), circuitTripped: first.circuitTripped };
  }

  // One retry pass over whatever failed, reporting through the same onProgress callback so the UI
  // keeps moving.
  const second = await runShardPass(cache, first.failed, concurrency, signal, onProgress, doneBytes, totalBytes);
  return { failed: failedUidsOf(second.failed, wanted), circuitTripped: second.circuitTripped };
}

// Pulls every dictionary shard into Cache Storage. The reader only fetches the shard a tap needs,
// so without this an offline device holds whatever words it happened to look up online. Written
// directly into Cache Storage, for the same reason fetchAndCacheShard above is.
//
// `force` refetches shards already present, overwriting them in place — see prefetchAllSuttas.
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

// Pulls the help page's screenshots into Cache Storage alongside the canon, so "download all
// content" leaves a device that can still read the guide offline. Written into the same cache the
// Service Worker's CacheFirst rule reads (vite.config.ts), like the two prefetchers above.
//
// Best-effort, with no failure state of its own in Settings: these illustrate a page that reads
// fine as text, so a missing one isn't worth a banner beside the ones that mean no sutta text.
//
// No `force` parameter — the filenames are content-hashed, so a re-captured screenshot is a new URL
// and one already cached can never be stale.
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

// The corpus versions this device last completed a full download at. Written only on a clean finish
// (SettingsPage's handleDownloadOffline): a partial download leaves the previous value, since a
// half-updated cache is the stale state this reports. Absent for anyone who has never
// bulk-downloaded, who is also who the update nudge skips.
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

export function recordCachedCorpusVersion(which: 'data' | 'dictionary', version: string): void {
  try {
    localStorage.setItem(which === 'data' ? OFFLINE_DATA_VERSION_KEY : OFFLINE_DICTIONARY_VERSION_KEY, version);
  } catch {
    // storage unavailable — ignore
  }
}

// True once the text cached on this device is older than what this build serves. Only ever true
// for a device that finished a bulk download, per cachedCorpusVersions above.
export function isOfflineTextStale(dataVersion: string): boolean {
  const cached = cachedCorpusVersions().data;
  return cached !== null && cached !== dataVersion;
}

export async function estimateOfflineStatus(uids: string[]): Promise<{ cached: number; total: number }> {
  if (!('caches' in window)) return { cached: 0, total: uids.length };
  const cache = await caches.open(SUTTA_TEXT_CACHE);
  const cached = await cachedUidSet(cache, uids);
  return { cached: cached.size, total: uids.length };
}
