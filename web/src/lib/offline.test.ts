import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { estimateOfflineStatus, prefetchAllSuttas, SHARD_FETCH_TIMEOUT_MS, type ShardManifest } from './offline';

// offline.ts targets browser-only behavior that this test's Node environment (see
// vitest.config.ts — .test.ts files run under plain Node, not jsdom) doesn't provide on its own:
// Node's real Request() throws on a bare relative URL (no page to resolve it against — verified
// directly: `new Request('/x')` throws "Failed to parse URL from /x"), and there's no Cache
// Storage at all. The fakes below are the minimal doubles needed to exercise this module's real
// logic — shard-level resumability, retry, timeout handling, cache-verified progress — without a
// browser.
class FakeRequest {
  readonly url: string;
  constructor(input: string) {
    this.url = new URL(input, 'http://localhost/').toString();
  }
}

class FakeCache {
  private store = new Map<string, Response>();
  private key(input: FakeRequest | string): string {
    return typeof input === 'string' ? new URL(input, 'http://localhost/').toString() : input.url;
  }
  async match(input: FakeRequest | string): Promise<Response | undefined> {
    return this.store.get(this.key(input));
  }
  async put(input: FakeRequest | string, response: Response): Promise<void> {
    this.store.set(this.key(input), response);
  }
  async keys(): Promise<FakeRequest[]> {
    return [...this.store.keys()].map((url) => new FakeRequest(url));
  }
  get size(): number {
    return this.store.size;
  }
  has(url: string): boolean {
    return this.store.has(this.key(url));
  }
}

class FakeCacheStorage {
  private named = new Map<string, FakeCache>();
  async open(name: string): Promise<FakeCache> {
    if (!this.named.has(name)) this.named.set(name, new FakeCache());
    return this.named.get(name)!;
  }
}

const MANIFEST_URL = 'http://localhost/data/text-shards/manifest.json';

function shardUrl(file: string): string {
  return new URL(`/data/${file}`, 'http://localhost/').toString();
}

// One shard per uid group, each `bytesPerShard` — uniform size keeps progress-byte assertions
// simple (real shards vary, but nothing here depends on that).
function makeManifest(shardUidGroups: string[][], bytesPerShard = 100): ShardManifest {
  const shards = shardUidGroups.map((uids, i) => ({ file: `text-shards/${i}.json`, bytes: bytesPerShard, uids }));
  return { totalBytes: bytesPerShard * shards.length, totalUids: shardUidGroups.flat().length, shards };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

// Routes fetch() calls to the manifest or one of the given shard bundles (uid -> arbitrary
// segment payload) by URL, the same way the real server does. `overrides` lets a specific shard
// file's response be replaced (e.g. to simulate a failure) without hand-rolling routing per test.
function routedFetch(
  manifest: ShardManifest,
  bundles: Record<string, Record<string, unknown>>,
  overrides: Record<string, () => Response> = {}
) {
  return vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? new URL(input, 'http://localhost/').toString() : (input as Request).url;
    if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    if (url === MANIFEST_URL) return jsonResponse(manifest);
    for (const shard of manifest.shards) {
      if (url === shardUrl(shard.file)) {
        return overrides[shard.file] ? overrides[shard.file]() : jsonResponse(bundles[shard.file] ?? {});
      }
    }
    throw new Error(`unrouted fetch: ${url}`);
  });
}

function bundleFor(uids: string[]): Record<string, unknown> {
  return Object.fromEntries(uids.map((uid) => [uid, [{ key: `${uid}:1.1`, pali: '', en: '' }]]));
}

describe('offline', () => {
  let cacheStorage: FakeCacheStorage;

  beforeEach(() => {
    cacheStorage = new FakeCacheStorage();
    vi.stubGlobal('Request', FakeRequest);
    vi.stubGlobal('caches', cacheStorage);
    vi.stubGlobal('window', globalThis);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('estimateOfflineStatus', () => {
    it('counts only uids that are both cached and among the ones asked about', async () => {
      const cache = await cacheStorage.open('sutta-text');
      await cache.put('/data/text/dn1.json', jsonResponse({}));
      await cache.put('/data/text/dn2.json', jsonResponse({}));
      // Cached but not part of this query — must not inflate the count.
      await cache.put('/data/text/mn1.json', jsonResponse({}));

      const status = await estimateOfflineStatus(['dn1', 'dn2', 'dn3']);
      expect(status).toEqual({ cached: 2, total: 3 });
    });

    it('reports 0/total, not a thrown error, when Cache Storage is unavailable', async () => {
      vi.stubGlobal('window', {});
      const status = await estimateOfflineStatus(['dn1', 'dn2']);
      expect(status).toEqual({ cached: 0, total: 2 });
    });
  });

  describe('prefetchAllSuttas — happy path', () => {
    it('fetches every shard, caches each of its uids under the per-uid URL, and reports full byte progress', async () => {
      const manifest = makeManifest([
        ['dn1', 'dn2'],
        ['dn3'],
      ]);
      const bundles = { 'text-shards/0.json': bundleFor(['dn1', 'dn2']), 'text-shards/1.json': bundleFor(['dn3']) };
      vi.stubGlobal('fetch', routedFetch(manifest, bundles));
      const onProgress = vi.fn();

      const { failed } = await prefetchAllSuttas(['dn1', 'dn2', 'dn3'], { onProgress });

      expect(failed).toEqual([]);
      const cache = await cacheStorage.open('sutta-text');
      expect(cache.size).toBe(3);
      expect(cache.has('/data/text/dn1.json')).toBe(true);
      expect(cache.has('/data/text/dn2.json')).toBe(true);
      expect(cache.has('/data/text/dn3.json')).toBe(true);
      expect(onProgress).toHaveBeenLastCalledWith(200, 200);
    });

    it('skips a shard that is already fully cached, without re-fetching it, and reports it in the first progress call', async () => {
      // One uid per shard — a shard is skippable exactly when every uid it contains is already
      // cached, so this isolates that from the "partially cached shard must be re-fetched whole"
      // case covered separately below.
      const manifest = makeManifest([['dn1'], ['dn2']]);
      const cache = await cacheStorage.open('sutta-text');
      await cache.put('/data/text/dn1.json', jsonResponse([]));
      const fetchSpy = routedFetch(manifest, { 'text-shards/1.json': bundleFor(['dn2']) });
      vi.stubGlobal('fetch', fetchSpy);
      const onProgress = vi.fn();

      const { failed } = await prefetchAllSuttas(['dn1', 'dn2'], { onProgress });

      expect(failed).toEqual([]);
      expect(onProgress).toHaveBeenCalledWith(100, 200); // initial call: shard 0 already satisfied
      // Manifest fetch + exactly one shard fetch (shard 1) — shard 0 never requested.
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('0.json'))).toBe(false);
    });

    it('re-fetches a shard in full when only some of its uids are already cached', async () => {
      const manifest = makeManifest([['dn1', 'dn2']]);
      const cache = await cacheStorage.open('sutta-text');
      await cache.put('/data/text/dn1.json', jsonResponse([]));
      vi.stubGlobal('fetch', routedFetch(manifest, { 'text-shards/0.json': bundleFor(['dn1', 'dn2']) }));

      const { failed } = await prefetchAllSuttas(['dn1', 'dn2']);

      expect(failed).toEqual([]);
      expect(cache.has('/data/text/dn2.json')).toBe(true);
    });
  });

  describe('prefetchAllSuttas — failure and retry', () => {
    it('retries a shard that fails once, and does not report it as failed if the retry succeeds', async () => {
      const manifest = makeManifest([['dn1']]);
      let calls = 0;
      vi.stubGlobal(
        'fetch',
        routedFetch(manifest, {}, {
          'text-shards/0.json': () => {
            calls++;
            if (calls === 1) throw new TypeError('network error');
            return jsonResponse(bundleFor(['dn1']));
          },
        })
      );

      const { failed } = await prefetchAllSuttas(['dn1']);

      expect(failed).toEqual([]);
      expect(calls).toBe(2);
      const cache = await cacheStorage.open('sutta-text');
      expect(cache.has('/data/text/dn1.json')).toBe(true);
    });

    it('reports every wanted uid in a shard as failed, and leaves them uncached, if it fails on both the first pass and the retry', async () => {
      const manifest = makeManifest([['dn1', 'dn2']]);
      vi.stubGlobal(
        'fetch',
        routedFetch(manifest, {}, {
          'text-shards/0.json': () => {
            throw new TypeError('network error');
          },
        })
      );

      const { failed } = await prefetchAllSuttas(['dn1', 'dn2']);

      expect(failed.sort()).toEqual(['dn1', 'dn2']);
      const cache = await cacheStorage.open('sutta-text');
      expect(cache.size).toBe(0);
    });

    it('treats a non-ok shard response as a failure, not a cached entry', async () => {
      const manifest = makeManifest([['dn1']]);
      vi.stubGlobal('fetch', routedFetch(manifest, {}, { 'text-shards/0.json': () => jsonResponse('not found', 404) }));

      const { failed } = await prefetchAllSuttas(['dn1']);

      expect(failed).toEqual(['dn1']);
      const cache = await cacheStorage.open('sutta-text');
      expect(cache.size).toBe(0);
    });

    it('only advances progress on a verified cache write, not merely a resolved fetch', async () => {
      const manifest = makeManifest([['dn1', 'dn2']]);
      vi.stubGlobal('fetch', routedFetch(manifest, { 'text-shards/0.json': bundleFor(['dn1', 'dn2']) }));
      const cache = await cacheStorage.open('sutta-text');
      // Simulates the real on-device bug: a fetch can succeed while the actual cache write
      // silently fails — progress (and the shard's success/failure) must reflect that, not the
      // fetch. dn1's own entry does get written before the failure (writes happen in uid order),
      // but the shard as a whole is still reported failed since it wasn't fully persisted.
      const originalPut = cache.put.bind(cache);
      vi.spyOn(cache, 'put').mockImplementation(async (input, response) => {
        const url = typeof input === 'string' ? input : (input as FakeRequest).url;
        if (url.includes('dn2')) throw new Error('QuotaExceededError');
        return originalPut(input, response);
      });
      const onProgress = vi.fn();

      const { failed } = await prefetchAllSuttas(['dn1', 'dn2'], { onProgress });

      expect(failed.sort()).toEqual(['dn1', 'dn2']);
      expect(cache.has('/data/text/dn1.json')).toBe(true);
      expect(cache.has('/data/text/dn2.json')).toBe(false);
      expect(onProgress).toHaveBeenLastCalledWith(0, 100);
    });
  });

  describe('prefetchAllSuttas — circuit breaker', () => {
    it('gives up early after enough consecutive shard failures, instead of grinding through every remaining shard one at a time', async () => {
      // A real device consistently, reproducibly capping at the same point across full app
      // restarts (observed on iOS Safari, back when this fetched per-sutta) points to a
      // persistent condition — most likely low free storage — where every new cache.put() from
      // that point on is doomed.
      const manyGroups = Array.from({ length: 30 }, (_, i) => [`dn${i + 1}`]);
      const manifest = makeManifest(manyGroups);
      vi.stubGlobal(
        'fetch',
        routedFetch(manifest, {}, Object.fromEntries(manifest.shards.map((s) => [s.file, () => { throw new TypeError('network error'); }])))
      );

      const { failed, circuitTripped } = await prefetchAllSuttas(manyGroups.flat());

      expect(circuitTripped).toBe(true);
      // Every uid ends up reported as failed (the ones past the trip point without their shard
      // ever being individually attempted) — the caller shouldn't have to know the difference.
      expect(failed.sort()).toEqual(manyGroups.flat().sort());
    });

    it('does not trip on occasional, non-consecutive shard failures', async () => {
      const groups = Array.from({ length: 20 }, (_, i) => [`dn${i + 1}`]);
      const manifest = makeManifest(groups);
      let calls = 0;
      const overrides = Object.fromEntries(
        manifest.shards.map((s) => [
          s.file,
          () => {
            calls++;
            // Every 5th call fails — never enough in a row to approach the trip threshold.
            if (calls % 5 === 0) throw new TypeError('network error');
            return jsonResponse(bundleFor(s.uids));
          },
        ])
      );
      vi.stubGlobal('fetch', routedFetch(manifest, {}, overrides));

      const { circuitTripped } = await prefetchAllSuttas(groups.flat());

      expect(circuitTripped).toBe(false);
    });

    it('stops attempting fetches at all once tripped, rather than working through the rest of the first pass or retrying', async () => {
      const groups = Array.from({ length: 20 }, (_, i) => [`dn${i + 1}`]);
      const manifest = makeManifest(groups);
      const fetchSpy = routedFetch(
        manifest,
        {},
        Object.fromEntries(manifest.shards.map((s) => [s.file, () => { throw new TypeError('network error'); }]))
      );
      vi.stubGlobal('fetch', fetchSpy);

      await prefetchAllSuttas(groups.flat());

      // Manifest fetch, plus exactly MAX_CONSECUTIVE_FAILURES (concurrency 4 × 3 = 12) shard
      // fetches — the rest of the first pass's shards, and the entire retry pass, are presumed
      // doomed and reported failed without ever being individually attempted.
      expect(fetchSpy).toHaveBeenCalledTimes(1 + 12);
    });
  });

  describe('prefetchAllSuttas — hang resilience', () => {
    it('treats a shard fetch that never settles as a failure once the timeout elapses, instead of hanging forever', async () => {
      vi.useFakeTimers();
      const manifest = makeManifest([['dn1']]);
      vi.stubGlobal(
        'fetch',
        vi.fn((input: unknown, init?: RequestInit) => {
          const url = typeof input === 'string' ? new URL(input, 'http://localhost/').toString() : (input as Request).url;
          if (url === MANIFEST_URL) return Promise.resolve(jsonResponse(manifest));
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          });
        }) as unknown as typeof fetch
      );

      const resultPromise = prefetchAllSuttas(['dn1']);
      // Two passes (first attempt + one retry), each with its own full timeout.
      await vi.advanceTimersByTimeAsync(SHARD_FETCH_TIMEOUT_MS);
      await vi.advanceTimersByTimeAsync(SHARD_FETCH_TIMEOUT_MS);
      const { failed } = await resultPromise;

      expect(failed).toEqual(['dn1']);
      const cache = await cacheStorage.open('sutta-text');
      expect(cache.size).toBe(0);
    });

    it('treats a cache.put() that never settles as a failure once the timeout elapses — the exact bug reproduced on iOS Safari', async () => {
      vi.useFakeTimers();
      const manifest = makeManifest([['dn1']]);
      vi.stubGlobal('fetch', routedFetch(manifest, { 'text-shards/0.json': bundleFor(['dn1']) }));
      const cache = await cacheStorage.open('sutta-text');
      vi.spyOn(cache, 'put').mockImplementation(() => new Promise(() => {})); // never resolves

      const resultPromise = prefetchAllSuttas(['dn1']);
      await vi.advanceTimersByTimeAsync(SHARD_FETCH_TIMEOUT_MS);
      await vi.advanceTimersByTimeAsync(SHARD_FETCH_TIMEOUT_MS);
      const { failed } = await resultPromise;

      expect(failed).toEqual(['dn1']);
    });

    it('lets a healthy shard in the same batch keep progressing while another shard is timing out', async () => {
      vi.useFakeTimers();
      const manifest = makeManifest([['dn1'], ['dn2'], ['dn3']]);
      vi.stubGlobal(
        'fetch',
        vi.fn((input: unknown, init?: RequestInit) => {
          const url = typeof input === 'string' ? new URL(input, 'http://localhost/').toString() : (input as Request).url;
          if (url === MANIFEST_URL) return Promise.resolve(jsonResponse(manifest));
          if (url === shardUrl('text-shards/1.json')) {
            return new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
            });
          }
          const shard = manifest.shards.find((s) => shardUrl(s.file) === url)!;
          return Promise.resolve(jsonResponse(bundleFor(shard.uids)));
        }) as unknown as typeof fetch
      );

      const onProgress = vi.fn();
      const resultPromise = prefetchAllSuttas(['dn1', 'dn2', 'dn3'], { onProgress });
      await vi.advanceTimersByTimeAsync(SHARD_FETCH_TIMEOUT_MS);
      await vi.advanceTimersByTimeAsync(SHARD_FETCH_TIMEOUT_MS);
      const { failed } = await resultPromise;

      expect(failed).toEqual(['dn2']);
      const cache = await cacheStorage.open('sutta-text');
      expect(cache.has('/data/text/dn1.json')).toBe(true);
      expect(cache.has('/data/text/dn3.json')).toBe(true);
    });
  });

  describe('prefetchAllSuttas — cancellation', () => {
    it('resolves immediately without fetching anything if already aborted before starting', async () => {
      const controller = new AbortController();
      controller.abort();
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);

      const { failed, circuitTripped } = await prefetchAllSuttas(['dn1'], { signal: controller.signal });

      expect(failed).toEqual([]);
      expect(circuitTripped).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('stops starting new shard fetches once aborted, without throwing, and leaves an already-completed shard cached', async () => {
      const manifest = makeManifest([['dn1'], ['dn2'], ['dn3']]);
      let shardFetchCount = 0;
      const fetchSpy = vi.fn(async (input: unknown) => {
        const url = typeof input === 'string' ? new URL(input, 'http://localhost/').toString() : (input as Request).url;
        if (url === MANIFEST_URL) return jsonResponse(manifest);
        shardFetchCount++;
        const shard = manifest.shards.find((s) => shardUrl(s.file) === url)!;
        return jsonResponse(bundleFor(shard.uids));
      });
      vi.stubGlobal('fetch', fetchSpy);
      const controller = new AbortController();

      // concurrency: 1 so batches are processed one shard at a time. Aborts via onProgress, fired
      // only after dn1's shard has already fully settled — this specifically tests "no new batch
      // starts once aborted," decoupled from the separate (also correct, see the next test)
      // behavior of a shard that's still in flight when abort fires.
      const { failed } = await prefetchAllSuttas(['dn1', 'dn2', 'dn3'], {
        concurrency: 1,
        signal: controller.signal,
        onProgress: (done) => {
          if (done === 100) controller.abort();
        },
      });

      expect(shardFetchCount).toBe(1);
      expect(failed).toEqual([]);
      const cache = await cacheStorage.open('sutta-text');
      expect(cache.size).toBe(1);
    });

    it('abandons a shard that is still in flight when abort fires, rather than letting it complete', async () => {
      const manifest = makeManifest([['dn1']]);
      const controller = new AbortController();
      let resolveFetch!: (res: Response) => void;
      const fetchStarted = new Promise<void>((resolveStarted) => {
        vi.stubGlobal(
          'fetch',
          vi.fn((input: unknown) => {
            const url = typeof input === 'string' ? new URL(input, 'http://localhost/').toString() : (input as Request).url;
            if (url === MANIFEST_URL) return Promise.resolve(jsonResponse(manifest));
            resolveStarted();
            return new Promise<Response>((resolve) => {
              resolveFetch = resolve;
            });
          }) as unknown as typeof fetch
        );
      });

      const resultPromise = prefetchAllSuttas(['dn1'], { signal: controller.signal });
      await fetchStarted; // the shard fetch() has genuinely been called and is still pending
      controller.abort();
      resolveFetch(jsonResponse(bundleFor(['dn1']))); // resolves *after* the abort — must no longer matter

      const { failed } = await resultPromise;

      expect(failed).toEqual(['dn1']);
      const cache = await cacheStorage.open('sutta-text');
      expect(cache.size).toBe(0);
    });
  });
});
