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

export function loadDictShardManifest(): Promise<DictShard[]> {
  if (!manifest) {
    manifest = fetch(DICT_MANIFEST_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load dictionary manifest (${res.status})`);
        return res.json() as Promise<{ shards: DictShard[] }>;
      })
      .then((m) => m.shards)
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
const MAX_RESIDENT_SHARDS = 8;
const resident = new Map<string, Promise<Dictionary>>();

function shardBody(file: string): Promise<Dictionary> {
  const cached = resident.get(file);
  if (cached) {
    resident.delete(file);
    resident.set(file, cached);
    return cached;
  }
  const pending = fetch(`/data/${file}`).then((res) => {
    if (!res.ok) throw new Error(`Failed to load ${file} (${res.status})`);
    return res.json() as Promise<Dictionary>;
  });
  // Don't leave a failure resident — the next tap on that shard should refetch, not replay it.
  pending.catch(() => resident.delete(file));
  resident.set(file, pending);
  while (resident.size > MAX_RESIDENT_SHARDS) {
    const oldest = resident.keys().next().value;
    if (oldest === undefined) break;
    resident.delete(oldest);
  }
  return pending;
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

// Test seam: the resident shards and the memoized manifest outlive any one component, so a test
// that stubs fetch has to be able to start from nothing.
export function resetDictShardCache(): void {
  manifest = null;
  resident.clear();
}
