// Query expansion: what readers type, mapped to what this corpus says — see docs/search.md.
//
// Each entry adds an alternative query, never replaces one, so a term that means something in its
// own right keeps its literal results and gains the corpus's wording alongside them.
//
// Two kinds of entry. **Vocabulary** covers words the editorial layer moved away from what readers
// know: the upstream-to-shipped pairs in scripts/update-data/retranslation.mjs are read from the
// reader's side here, so a query for the word Bhikkhu Sujato used reaches the word this app ships.
// **Sutta names** cover a discourse known by a traditional name that is neither its English title
// nor its Pali one.
//
// Keys are written folded — lowercase, no diacritics — because expandQuery is handed a query that
// searchKey has already folded.
import { searchKey } from './corpus';

interface Expansion {
  // The folded phrase a reader types.
  from: string;
  // The alternative queries it adds, best first.
  to: string[];
}

// Vocabulary. The first group is the retranslated terms, read upstream-to-shipped.
const VOCABULARY: Expansion[] = [
  { from: 'mendicant', to: ['bhikkhu'] },
  { from: 'mendicants', to: ['bhikkhus'] },
  { from: 'immersion', to: ['composure'] },
  { from: 'concentration', to: ['composure'] },
  { from: 'absorption', to: ['jhana'] },
  { from: 'absorptions', to: ['jhanas'] },
  { from: 'textual analysis', to: ['analytical knowledge'] },
  { from: 'mindfulness meditation', to: ['establishment of mindfulness'] },
  { from: 'foundations of mindfulness', to: ['establishments of mindfulness'] },
  { from: 'situational awareness', to: ['attentiveness', 'sampajanna'] },
  { from: 'clear comprehension', to: ['attentiveness', 'sampajanna'] },
  { from: 'origination', to: ['arising', 'samudaya'] },
  { from: 'origin', to: ['arising', 'samudaya'] },
  { from: 'vanishing', to: ['passing away', 'vaya'] },
  { from: 'rise and fall', to: ['arising and passing away', 'udayabbaya'] },
  { from: 'perishing', to: ['passing away'] },
  { from: 'anxiety', to: ['agitation', 'paritassana'] },
  { from: 'placing the mind', to: ['thought', 'vitakka'] },
  { from: 'keeping it connected', to: ['examination', 'vicara'] },
  { from: 'rational application of mind', to: ['proper attention', 'yoniso'] },
  { from: 'wise attention', to: ['proper attention', 'yoniso'] },
  { from: 'choices', to: ['sankhara'] },
  { from: 'formations', to: ['sankhara'] },
  { from: 'volitional formations', to: ['sankhara'] },
  { from: 'mental fabrications', to: ['sankhara'] },
  // Terms readers know from other translations and from ordinary Buddhist English, which this
  // corpus spells another way. A word this corpus already uses gets no entry: it would only add
  // the noise of a second query for nothing.
  { from: 'loving-kindness', to: ['love', 'metta'] },
  { from: 'loving kindness', to: ['love', 'metta'] },
  { from: 'metta', to: ['love'] },
  { from: 'enlightenment', to: ['awakening'] },
  { from: 'enlightened', to: ['awakened'] },
  { from: 'nibbana', to: ['extinguishment'] },
  { from: 'nirvana', to: ['extinguishment', 'nibbana'] },
  { from: 'karma', to: ['deeds', 'kamma'] },
  { from: 'arahant', to: ['perfected'] },
  { from: 'arahants', to: ['perfected'] },
  { from: 'luminous', to: ['radiant'] },
  { from: 'not-self', to: ['not self', 'anatta'] },
  { from: 'sense bases', to: ['sense fields'] },
  { from: 'taints', to: ['defilements'] },
  { from: 'sotapanna', to: ['stream-enterer'] },
  { from: 'mindfulness of breathing', to: ['anapanassati'] },
  { from: 'anapanasati', to: ['anapanassati'] },
];

// Sutta names — a discourse as readers name it to each other.
const SUTTA_NAMES: Expansion[] = [
  { from: 'the fire sermon', to: ['burning'] },
  { from: 'fire sermon', to: ['burning'] },
  { from: 'sigalovada', to: ['advice to sigalaka'] },
  { from: 'karaniya metta', to: ['discourse on love'] },
  { from: 'karaniyametta', to: ['discourse on love'] },
  { from: 'honeyball', to: ['the honey-cake'] },
  { from: 'honey ball', to: ['the honey-cake'] },
  { from: 'ant-hill', to: ['termite mound'] },
  { from: 'anthill', to: ['termite mound'] },
  { from: 'ants nest', to: ['termite mound'] },
  { from: "ant's nest", to: ['termite mound'] },
  { from: 'water snake', to: ['cobra'] },
  { from: 'poisoned arrow', to: ['arrow smeared with poison'] },
  { from: 'turning the wheel of dhamma', to: ['rolling forth the wheel of dhamma'] },
  { from: 'setting in motion the wheel of dhamma', to: ['rolling forth the wheel of dhamma'] },
  { from: 'discourse on the not-self characteristic', to: ['the characteristic of not-self'] },
  { from: 'satipatthana', to: ['establishment of mindfulness'] },
  { from: 'mahasatipatthana', to: ['establishment of mindfulness'] },
];

export const QUERY_EXPANSIONS: Expansion[] = [...VOCABULARY, ...SUTTA_NAMES].map(({ from, to }) => ({
  from: searchKey(from),
  to: to.map(searchKey),
}));

const RE_ESCAPE = /[.*+?^${}()|[\]\\]/g;

// Matches an entry's phrase as whole words. `\b` is ASCII-only and would break on a Pali key, so
// the boundaries are the same lookarounds the matcher uses.
function phraseRe(from: string): RegExp {
  return new RegExp(`(?<!\\p{L})${from.replace(RE_ESCAPE, '\\$&')}(?!\\p{L})`, 'u');
}

// How many alternatives one query may add. Each costs a scan of both blobs, and past a handful the
// results stop being about what was typed.
export const MAX_EXPANSIONS = 4;

// The alternative queries `q` adds, `q` itself excluded. `q` must already be folded by searchKey.
export function expandQuery(q: string, limit = MAX_EXPANSIONS): string[] {
  const out: string[] = [];
  for (const { from, to } of QUERY_EXPANSIONS) {
    const re = phraseRe(from);
    if (!re.test(q)) continue;
    for (const alt of to) {
      const expanded = q.replace(re, alt).replace(/\s+/g, ' ').trim();
      if (expanded && expanded !== q && !out.includes(expanded)) out.push(expanded);
      if (out.length >= limit) return out;
    }
  }
  return out;
}
