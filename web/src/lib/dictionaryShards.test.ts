import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadDictShardManifest,
  lookupHeadword,
  peekHeadword,
  prefetchHeadwordShard,
  resetDictShardCache,
  shardFor,
  type DictShard,
} from './dictionaryShards';

const shards: DictShard[] = [
  { file: 'dict-shards/000.json', first: 'a', last: 'buddha' },
  { file: 'dict-shards/001.json', first: 'buddhi', last: 'nibbana' },
  { file: 'dict-shards/002.json', first: 'nibbida', last: 'yoniso' },
];

describe('shardFor', () => {
  it('finds the shard whose range covers the key', () => {
    expect(shardFor(shards, 'anicca')?.file).toBe('dict-shards/000.json');
    expect(shardFor(shards, 'dhamma')?.file).toBe('dict-shards/001.json');
    expect(shardFor(shards, 'sati')?.file).toBe('dict-shards/002.json');
  });

  it('includes both ends of a range', () => {
    expect(shardFor(shards, 'a')?.file).toBe('dict-shards/000.json');
    expect(shardFor(shards, 'buddha')?.file).toBe('dict-shards/000.json');
    expect(shardFor(shards, 'buddhi')?.file).toBe('dict-shards/001.json');
  });

  // Ranges are contiguous but not exhaustive, so a word the dictionary doesn't have can fall
  // outside every shard — answering that without a fetch is the point.
  it('returns null for a key past the last shard or before the first', () => {
    expect(shardFor(shards, 'zzz')).toBeNull();
    expect(shardFor(shards, 'Anicca')).toBeNull(); // uppercase sorts before 'a' — callers lowercase first
  });

  it('returns null for an empty shard list', () => {
    expect(shardFor([], 'dhamma')).toBeNull();
  });
});

describe('lookupHeadword', () => {
  let fetched: string[];

  beforeEach(() => {
    resetDictShardCache();
    fetched = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        fetched.push(url);
        if (url === '/data/dict-shards/manifest.json') {
          return { ok: true, json: async () => ({ shards }) } as unknown as Response;
        }
        if (url === '/data/dict-shards/001.json') {
          return { ok: true, json: async () => ({ dhamma: ['teaching'], Dhamma: ['the Teaching'] }) } as unknown as Response;
        }
        return { ok: false, status: 404 } as unknown as Response;
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetDictShardCache();
  });

  it('fetches only the shard the word falls in, and returns its definitions', async () => {
    await expect(lookupHeadword('dhamma')).resolves.toEqual(['teaching']);
    expect(fetched).toEqual(['/data/dict-shards/manifest.json', '/data/dict-shards/001.json']);
  });

  it('prefers the exact spelling over the lowercased one', async () => {
    await expect(lookupHeadword('Dhamma')).resolves.toEqual(['the Teaching']);
  });

  // Both spellings have to live in one shard, which is why build-corpus.mjs never splits a run of
  // headwords sharing a sort key — a capitalised word resolving to a shard that only holds the
  // lowercase form still has to find it.
  it('falls back to the lowercase entry when the exact spelling is absent', async () => {
    await expect(lookupHeadword('DHAMMA')).resolves.toEqual(['teaching']);
  });

  it('strips punctuation off the tapped token before looking it up', async () => {
    await expect(lookupHeadword('dhamma,')).resolves.toEqual(['teaching']);
  });

  it('answers a word outside every shard range without fetching a shard', async () => {
    await expect(lookupHeadword('zzz')).resolves.toBeNull();
    expect(fetched).toEqual(['/data/dict-shards/manifest.json']);
  });

  it('returns null — not an error — for a word its shard simply does not contain', async () => {
    await expect(lookupHeadword('nibbana')).resolves.toBeNull();
  });

  it('reuses a resident shard rather than refetching it', async () => {
    await lookupHeadword('dhamma');
    await lookupHeadword('dhamma');
    expect(fetched.filter((u) => u.endsWith('001.json'))).toHaveLength(1);
  });

  it('rejects when the shard cannot be fetched, so the dock can offer a retry', async () => {
    await expect(lookupHeadword('sati')).rejects.toThrow('002.json');
  });

  // A cached rejection would make one failed fetch permanent for the session, where the next tap
  // is exactly when the user wants it tried again.
  it('refetches a shard whose previous fetch failed', async () => {
    await expect(lookupHeadword('sati')).rejects.toThrow();
    await expect(lookupHeadword('sati')).rejects.toThrow();
    expect(fetched.filter((u) => u.endsWith('002.json'))).toHaveLength(2);
  });

  // peekHeadword is what lets the reader answer a tap without a repaint — see useDictionaryLookup.
  describe('peekHeadword', () => {
    it('knows nothing before the manifest has loaded', () => {
      expect(peekHeadword('dhamma')).toBeUndefined();
    });

    it('knows nothing while the shard is loaded but not yet parsed', async () => {
      await loadDictShardManifest();
      const pending = lookupHeadword('dhamma');
      expect(peekHeadword('dhamma')).toBeUndefined();
      await pending;
    });

    it('answers from a resident shard once it has settled', async () => {
      await lookupHeadword('dhamma');
      expect(peekHeadword('dhamma')).toEqual(['teaching']);
      expect(peekHeadword('Dhamma')).toEqual(['the Teaching']);
      // A definite "no entry" too, not just a hit.
      expect(peekHeadword('nibbana')).toBeNull();
    });

    it('answers a word outside every shard range without needing any shard', async () => {
      await loadDictShardManifest();
      expect(peekHeadword('zzz')).toBeNull();
    });
  });

  describe('prefetchHeadwordShard', () => {
    it('warms a shard so a later lookup can be answered synchronously', async () => {
      prefetchHeadwordShard('dhamma');
      // Let the manifest and shard fetches settle.
      await vi.waitFor(() => expect(peekHeadword('dhamma')).toEqual(['teaching']));
      expect(fetched.filter((u) => u.endsWith('001.json'))).toHaveLength(1);
    });

    it('swallows a failing shard rather than rejecting into nothing', async () => {
      prefetchHeadwordShard('sati');
      await vi.waitFor(() => expect(fetched.some((u) => u.endsWith('002.json'))).toBe(true));
      expect(peekHeadword('sati')).toBeUndefined();
    });
  });

  it('refetches the manifest after a failed manifest fetch', async () => {
    resetDictShardCache();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 }) as unknown as Response));
    await expect(lookupHeadword('dhamma')).rejects.toThrow('manifest');
    await expect(lookupHeadword('dhamma')).rejects.toThrow('manifest');
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });
});
