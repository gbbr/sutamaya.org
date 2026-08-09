import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { estimateOfflineStatus, FETCH_TIMEOUT_MS, prefetchAllSuttas } from './offline';

// offline.ts targets browser-only behavior that this test's Node environment (see
// vitest.config.ts — .test.ts files run under plain Node, not jsdom) doesn't provide on its own:
// Node's real Request() throws on a bare relative URL (no page to resolve it against — verified
// directly: `new Request('/x')` throws "Failed to parse URL from /x"), and there's no Cache
// Storage at all. The fakes below are the minimal doubles needed to exercise this module's real
// logic — resumability, retry, timeout handling, cache-verified progress — without a browser.
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

function okResponse(): Response {
  return new Response('{}', { status: 200 });
}

function notFoundResponse(): Response {
  return new Response('not found', { status: 404 });
}

// A fetch double that respects the real AbortSignal it's given — matches what a genuinely stuck
// network request does (never settles on its own, but does reject once aborted), which is what
// lets fetchAndCache's per-item timeout actually be exercised.
function hangingFetch(): typeof fetch {
  return vi.fn((_input: unknown, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
  }) as unknown as typeof fetch;
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
      await cache.put('/data/text/dn1.json', okResponse());
      await cache.put('/data/text/dn2.json', okResponse());
      // Cached but not part of this query — must not inflate the count.
      await cache.put('/data/text/mn1.json', okResponse());

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
    it('fetches and caches every uid, reporting full progress and no failures', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => okResponse()));
      const onProgress = vi.fn();

      const { failed } = await prefetchAllSuttas(['dn1', 'dn2', 'dn3'], { onProgress });

      expect(failed).toEqual([]);
      const cache = await cacheStorage.open('sutta-text');
      expect(cache.size).toBe(3);
      expect(onProgress).toHaveBeenLastCalledWith(3, 3);
    });

    it('skips uids already cached, without re-fetching them, and reports them in the first progress call', async () => {
      const cache = await cacheStorage.open('sutta-text');
      await cache.put('/data/text/dn1.json', okResponse());
      const fetchSpy = vi.fn(async (_req: FakeRequest) => okResponse());
      vi.stubGlobal('fetch', fetchSpy);
      const onProgress = vi.fn();

      const { failed } = await prefetchAllSuttas(['dn1', 'dn2'], { onProgress });

      expect(failed).toEqual([]);
      expect(onProgress).toHaveBeenCalledWith(1, 2); // initial call, before any new fetch
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0][0].url).toContain('dn2.json');
    });
  });

  describe('prefetchAllSuttas — failure and retry', () => {
    it('retries a fetch that fails once, and does not report it as failed if the retry succeeds', async () => {
      let calls = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          calls++;
          if (calls === 1) throw new TypeError('network error');
          return okResponse();
        })
      );

      const { failed } = await prefetchAllSuttas(['dn1']);

      expect(failed).toEqual([]);
      expect(calls).toBe(2);
      const cache = await cacheStorage.open('sutta-text');
      expect(cache.has('/data/text/dn1.json')).toBe(true);
    });

    it('reports a uid as failed, and leaves it uncached, if it fails on both the first pass and the retry', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new TypeError('network error');
        })
      );

      const { failed } = await prefetchAllSuttas(['dn1', 'dn2']);

      expect(failed.sort()).toEqual(['dn1', 'dn2']);
      const cache = await cacheStorage.open('sutta-text');
      expect(cache.size).toBe(0);
    });

    it('treats a non-ok response as a failure, not a cached entry', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => notFoundResponse()));

      const { failed } = await prefetchAllSuttas(['dn1']);

      expect(failed).toEqual(['dn1']);
      const cache = await cacheStorage.open('sutta-text');
      expect(cache.size).toBe(0);
    });

    it('only advances progress on a verified cache write, not merely a resolved fetch', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => okResponse()));
      const cache = await cacheStorage.open('sutta-text');
      // Simulates the real on-device bug: a fetch can succeed while the actual cache write
      // silently fails — progress (and the cache itself) must reflect that, not the fetch.
      const originalPut = cache.put.bind(cache);
      vi.spyOn(cache, 'put').mockImplementation(async (input, response) => {
        const url = typeof input === 'string' ? input : (input as FakeRequest).url;
        if (url.includes('dn2')) throw new Error('QuotaExceededError');
        return originalPut(input, response);
      });
      const onProgress = vi.fn();

      const { failed } = await prefetchAllSuttas(['dn1', 'dn2'], { onProgress });

      expect(failed).toEqual(['dn2']);
      expect(cache.has('/data/text/dn1.json')).toBe(true);
      expect(cache.has('/data/text/dn2.json')).toBe(false);
      expect(onProgress).toHaveBeenLastCalledWith(1, 2);
    });
  });

  describe('prefetchAllSuttas — circuit breaker', () => {
    it('gives up early after enough consecutive failures, instead of grinding through every remaining uid one at a time', async () => {
      // A real device consistently, reproducibly capping at the same item count across full app
      // restarts (observed on iOS Safari) points to a persistent condition — most likely low
      // free storage — where every new cache.put() from that point on is doomed. Without a
      // circuit breaker, "doomed" still meant burning FETCH_TIMEOUT_MS on each one of potentially
      // thousands of remaining items before reporting failure — technically bounded, practically
      // indistinguishable from hanging forever.
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new TypeError('network error');
        })
      );
      const manyUids = Array.from({ length: 100 }, (_, i) => `dn${i + 1}`);

      const { failed, circuitTripped } = await prefetchAllSuttas(manyUids);

      expect(circuitTripped).toBe(true);
      // Every uid ends up reported as failed (the ones past the trip point without ever being
      // individually attempted) — the caller shouldn't have to know the difference.
      expect(failed.sort()).toEqual([...manyUids].sort());
    });

    it('does not trip on occasional, non-consecutive failures', async () => {
      let calls = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          calls++;
          // Every 5th call fails — never enough in a row to approach the trip threshold.
          if (calls % 5 === 0) throw new TypeError('network error');
          return okResponse();
        })
      );
      const uids = Array.from({ length: 30 }, (_, i) => `dn${i + 1}`);

      const { circuitTripped } = await prefetchAllSuttas(uids);

      expect(circuitTripped).toBe(false);
    });

    it('stops attempting fetches at all once tripped, rather than working through the rest of the first pass or retrying', async () => {
      const fetchSpy = vi.fn(async () => {
        throw new TypeError('network error');
      });
      vi.stubGlobal('fetch', fetchSpy);
      const manyUids = Array.from({ length: 60 }, (_, i) => `dn${i + 1}`);

      await prefetchAllSuttas(manyUids);

      // Exactly MAX_CONSECUTIVE_FAILURES (18) fetches happen — the rest of the first pass's uids,
      // and the entire retry pass, are presumed doomed and reported failed without ever being
      // individually attempted.
      expect(fetchSpy).toHaveBeenCalledTimes(18);
    });
  });

  describe('prefetchAllSuttas — hang resilience', () => {
    it('treats a fetch that never settles as a failure once the timeout elapses, instead of hanging forever', async () => {
      vi.useFakeTimers();
      vi.stubGlobal('fetch', hangingFetch());

      const resultPromise = prefetchAllSuttas(['dn1']);
      // Two passes (first attempt + one retry), each with its own full timeout.
      await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS);
      await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS);
      const { failed } = await resultPromise;

      expect(failed).toEqual(['dn1']);
      const cache = await cacheStorage.open('sutta-text');
      expect(cache.size).toBe(0);
    });

    it('treats a cache.put() that never settles as a failure once the timeout elapses — the exact bug reproduced on iOS Safari', async () => {
      vi.useFakeTimers();
      vi.stubGlobal('fetch', vi.fn(async () => okResponse()));
      const cache = await cacheStorage.open('sutta-text');
      vi.spyOn(cache, 'put').mockImplementation(() => new Promise(() => {})); // never resolves

      const resultPromise = prefetchAllSuttas(['dn1']);
      await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS);
      await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS);
      const { failed } = await resultPromise;

      expect(failed).toEqual(['dn1']);
    });

    it('lets healthy items in the same batch keep progressing while one item is timing out', async () => {
      vi.useFakeTimers();
      vi.stubGlobal(
        'fetch',
        vi.fn((input: FakeRequest, init?: RequestInit) => {
          if (!input.url.includes('dn2')) return Promise.resolve(okResponse());
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          });
        }) as unknown as typeof fetch
      );

      const onProgress = vi.fn();
      const resultPromise = prefetchAllSuttas(['dn1', 'dn2', 'dn3'], { onProgress });
      await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS);
      await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS);
      const { failed } = await resultPromise;

      expect(failed).toEqual(['dn2']);
      const cache = await cacheStorage.open('sutta-text');
      expect(cache.has('/data/text/dn1.json')).toBe(true);
      expect(cache.has('/data/text/dn3.json')).toBe(true);
    });
  });

  describe('prefetchAllSuttas — cancellation', () => {
    it('stops starting new batches once aborted, without throwing, and leaves an already-completed item cached', async () => {
      const controller = new AbortController();
      let fetchCount = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          fetchCount++;
          return okResponse();
        })
      );

      // concurrency: 1 so batches are processed one uid at a time. Aborts via onProgress, fired
      // only after dn1's own fetch-then-cache-put has already fully settled — this specifically
      // tests "no new batch starts once aborted," decoupled from the separate (also correct, see
      // the next test) behavior of an item that's still in flight when abort fires.
      const { failed } = await prefetchAllSuttas(['dn1', 'dn2', 'dn3'], {
        concurrency: 1,
        signal: controller.signal,
        onProgress: (done) => {
          if (done === 1) controller.abort();
        },
      });

      expect(fetchCount).toBe(1);
      expect(failed).toEqual([]);
      const cache = await cacheStorage.open('sutta-text');
      expect(cache.size).toBe(1);
    });

    it('abandons an item that is still in flight when abort fires, rather than letting it complete', async () => {
      const controller = new AbortController();
      let resolveFetch!: (res: Response) => void;
      const fetchStarted = new Promise<void>((resolveStarted) => {
        vi.stubGlobal(
          'fetch',
          vi.fn(() => {
            resolveStarted();
            return new Promise<Response>((resolve) => {
              resolveFetch = resolve;
            });
          }) as unknown as typeof fetch
        );
      });

      const resultPromise = prefetchAllSuttas(['dn1'], { signal: controller.signal });
      await fetchStarted; // fetch() has genuinely been called and is still pending
      controller.abort();
      resolveFetch(okResponse()); // resolves *after* the abort — must no longer matter

      const { failed } = await resultPromise;

      expect(failed).toEqual(['dn1']);
      const cache = await cacheStorage.open('sutta-text');
      expect(cache.size).toBe(0);
    });
  });
});
