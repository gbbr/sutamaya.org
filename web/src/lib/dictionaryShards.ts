import { lookupWord, stripPunct } from './dictionary';
import type { Dictionary } from './types';

export const DICT_MANIFEST_URL = '/data/dict-shards/manifest.json';

// One shard's key range, lowercased — see build-corpus.mjs, which packs the headwords into
// ~256KB range shards so a word tap fetches ~30KB instead of the whole ~20MB dictionary.
export interface DictShard {
  file: string;
  first: string;
  last: string;
}

let manifest: Promise<DictShard[]> | null = null;
// The settled manifest, so peekHeadword can pick a shard without awaiting.
let manifestValue: DictShard[] | null = null;

export function loadDictShardManifest(): Promise<DictShard[]> {
  if (!manifest) {
    manifest = fetch(DICT_MANIFEST_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load dictionary manifest (${res.status})`);
        return res.json() as Promise<{ shards: DictShard[] }>;
      })
      .then((m) => {
        manifestValue = m.shards;
        return m.shards;
      })
      .catch((error) => {
        // A cached rejection would make the first failure permanent for the session, where the
        // next tap is exactly when the user wants it retried.
        manifest = null;
        throw error;
      });
  }
  return manifest;
}

// The shard whose range covers `key`, or null when none does. Ranges are contiguous but not
// exhaustive — a tapped word the dictionary simply doesn't have (most of them, given inflected
// Pali) falls past the last shard's `last` or between two shards, and is answered without a fetch.
// Plain `<=` reproduces build-corpus.mjs's own comparator; anything locale-aware would not.
export function shardFor(shards: DictShard[], key: string): DictShard | null {
  let lo = 0;
  let hi = shards.length - 1;
  let found: DictShard | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (shards[mid].first <= key) {
      found = shards[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found && key <= found.last ? found : null;
}

// Parsed shards are kept, but only a few: holding every shard a long reading session touches
// would rebuild the whole dictionary in memory, which is the cost sharding exists to avoid. The
// Map is insertion-ordered, so re-inserting on a hit and dropping from the front is a plain LRU.
// `value` is the settled body, kept alongside the promise so peekHeadword can answer without
// awaiting — a lookup that has to go through a microtask makes the reader's dock repaint.
const MAX_RESIDENT_SHARDS = 8;
interface ResidentShard {
  body: Promise<Dictionary>;
  value?: Dictionary;
}
const resident = new Map<string, ResidentShard>();

function touch(file: string, entry: ResidentShard): ResidentShard {
  resident.delete(file);
  resident.set(file, entry);
  return entry;
}

function shardBody(file: string): Promise<Dictionary> {
  const cached = resident.get(file);
  if (cached) return touch(file, cached).body;
  const entry: ResidentShard = {
    body: fetch(`/data/${file}`).then((res) => {
      if (!res.ok) throw new Error(`Failed to load ${file} (${res.status})`);
      return res.json() as Promise<Dictionary>;
    }),
  };
  entry.body.then(
    (dict) => {
      // Only if this entry is still the resident one — an eviction in between must not resurrect it.
      if (resident.get(file) === entry) entry.value = dict;
    },
    // Don't leave a failure resident — the next tap on that shard should refetch, not replay it.
    () => {
      if (resident.get(file) === entry) resident.delete(file);
    }
  );
  resident.set(file, entry);
  while (resident.size > MAX_RESIDENT_SHARDS) {
    const oldest = resident.keys().next().value;
    if (oldest === undefined) break;
    resident.delete(oldest);
  }
  return entry.body;
}

// Definitions for one tapped Pali word, or null when the dictionary has no entry for it. Rejects
// only when the manifest or a shard could not be fetched — "no such word" is a null, not an error,
// since the two mean very different things to the reader (see DictionaryDock).
export async function lookupHeadword(raw: string): Promise<string[] | null> {
  const key = stripPunct(raw).toLowerCase();
  if (!key) return null;
  const shard = shardFor(await loadDictShardManifest(), key);
  if (!shard) return null;
  return lookupWord(await shardBody(shard.file), raw);
}

// The same answer as lookupHeadword when it can be given without waiting — `undefined` means "not
// known yet, go async". Lets the reader render a tap in the very commit that handled it, so the
// dock doesn't paint a loading state and resize twice for a word that was already in memory.
export function peekHeadword(raw: string): string[] | null | undefined {
  const key = stripPunct(raw).toLowerCase();
  if (!key) return null;
  if (!manifestValue) return undefined;
  const shard = shardFor(manifestValue, key);
  if (!shard) return null;
  const entry = resident.get(shard.file);
  if (!entry?.value) return undefined;
  return lookupWord(touch(shard.file, entry).value!, raw);
}

// Warms the shard a word would need, ignoring failures. Consecutive words in a sutta are unrelated
// alphabetically, so stepping through them with the dock open almost always crosses a shard
// boundary; warming the neighbours is what keeps that stepping on peekHeadword's synchronous path.
export function prefetchHeadwordShard(raw: string): void {
  const key = stripPunct(raw).toLowerCase();
  if (!key) return;
  const warm = (shards: DictShard[]) => {
    const shard = shardFor(shards, key);
    if (shard) shardBody(shard.file).catch(() => {});
  };
  if (manifestValue) warm(manifestValue);
  else loadDictShardManifest().then(warm).catch(() => {});
}

// Test seam: the resident shards and the memoized manifest outlive any one component, so a test
// that stubs fetch has to be able to start from nothing.
export function resetDictShardCache(): void {
  manifest = null;
  manifestValue = null;
  resident.clear();
}
