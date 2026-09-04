// The build's copy of what the reader does with a tapped Pali word: the tokenizer from
// web/src/lib/dictionary.ts and the shard binary search from web/src/lib/dictionaryShards.ts,
// in plain JS because nothing is shared across the two npm workspaces.
//
// build-corpus.mjs ships only the headwords one of these tokens can reach, so splitting differently
// from the reader would silently drop entries a tap can still ask for.
// web/src/lib/paliWordsParity.test.ts runs both copies over the same inputs and diffs them.

export const PUNCT = /[.,;:""''"'?!­‘’“”…()]/g;

export function stripPunct(raw) {
  return raw.replace(PUNCT, '');
}

export const WORD_BOUNDARY = /(\s+|—|-)/;

export function isWordBoundary(token) {
  return token.trim() === '' || token === '—' || token === '-';
}

export function splitPaliWords(pali) {
  return pali.split(WORD_BOUNDARY).filter((t) => !isWordBoundary(t));
}

export function lookupWord(dict, raw) {
  const word = stripPunct(raw);
  return dict[word] || dict[word.toLowerCase()] || null;
}

// The shard whose lowercased key range covers `key`, or null. Plain `<=`, never localeCompare.
export function shardFor(shards, key) {
  let lo = 0;
  let hi = shards.length - 1;
  let found = null;
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
