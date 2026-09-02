import { lookupWord, stripPunct } from './dictionary';
import type { Dictionary } from './types';

export const DICT_MANIFEST_URL = '/data/dict-shards/manifest.json';

// The dictionary, as ~256KB range shards, so a word tap fetches one shard rather than the whole
// map. A binary search over the manifest picks the shard, a few parsed shards stay resident under
// an LRU, and a lookup that can be answered from those is answered without awaiting.

// One shard's key range, lowercased.
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
        // Clear it, so the next tap refetches rather than replaying a cached rejection.
        manifest = null;
        throw error;
      });
  }
  return manifest;
}

// The shard whose range covers `key`, or null when none does — a word the dictionary doesn't have
// falls past the last shard or between two, and is answered without a fetch. Plain `<=`, which
// reproduces the builder's comparator where anything locale-aware would not.
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

// How many parsed shards stay in memory; holding every shard a long session touches would rebuild
// the whole dictionary there.
const MAX_RESIDENT_SHARDS = 8;
interface ResidentShard {
  body: Promise<Dictionary>;
  // The settled body, so peekHeadword can answer without awaiting.
  value?: Dictionary;
}
// The resident shards, insertion-ordered, so re-inserting on a hit and dropping from the front is
// a plain LRU.
const resident = new Map<string, ResidentShard>();

// Marks a shard as most recently used and returns it.
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
      // Only if this entry is still the resident one, so an eviction in between isn't undone.
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

// The definitions for one tapped Pali word, or null where the dictionary has no entry. Rejects
// only when the manifest or a shard couldn't be fetched, which the dock shows differently.
export async function lookupHeadword(raw: string): Promise<string[] | null> {
  const key = stripPunct(raw).toLowerCase();
  if (!key) return null;
  const shard = shardFor(await loadDictShardManifest(), key);
  if (!shard) return null;
  return lookupWord(await shardBody(shard.file), raw);
}

// The same answer as lookupHeadword where it can be given without waiting, and `undefined` where
// it can't — which lets the dock open straight to its definitions rather than resizing twice.
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
// alphabetically, so stepping between them almost always crosses a shard boundary.
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

// Drops the manifest and every resident shard, so a test stubbing fetch can start from nothing.
export function resetDictShardCache(): void {
  manifest = null;
  manifestValue = null;
  resident.clear();
}
