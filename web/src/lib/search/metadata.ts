// Search over a sutta's metadata — its ref, title, Pali, blurb, the reader's own note, and the
// names of the lists holding it. The sutta text itself is lib/search/text.ts.
//
// A query is folded to a diacritic-insensitive key (searchKey), and every word must be found,
// though not adjacent and not in one field, so "raft simile" reaches a blurb reading "the simile of
// the raft". Contiguity and field are ranking signals instead, in four buckets: the phrase in the
// ref/title/Pali, then every word there, then the phrase anywhere, then every word anywhere. Within
// a bucket, a sutta the reader has filed, noted or highlighted sorts first, and the rest keep the
// corpus's build order. The boost never crosses buckets, so a title match always beats a blurb
// match.
//
// A query naming one sutta of a batched document ("dhp325" inside "dhp320-333") matches the batch
// and carries the inner uid as `matchedId`, since the corpus has no entry of its own for it.
import { rangesFor, RANGE_QUERY, suttaEntries } from '../corpus';
import { flattenListTree } from '../lists';
import type { Corpus, HighlightsMap, ListDef, Sutta } from '../types';

export interface SearchHit {
  id: string;
  sutta: Sutta;
  // The inner sutta the query named within a batched document, which the caller opens instead of
  // `id`. Unset for a match the data can't attribute to one inner sutta.
  matchedId?: string;
  // True when the query reached this sutta only through the name of a list holding it.
  listOnly?: boolean;
  // The bucket this hit ranked in, so lib/search/text.ts can extend the ladder past bucket 3.
  rank: number;
  // Whether the reader has filed, noted or highlighted it — the tie-break within a bucket.
  saved: boolean;
  // The paragraph of sutta text the query was found in, its English where that paragraph was Pali,
  // and the first and last segment it was drawn from. Filled in by lib/search/text.ts for the hits
  // that render; absent on a metadata-only hit.
  snippet?: { text: string; under?: string; query: string; segments: [number, number] };
}

// How many hits a caller renders; searchCorpus still returns every match, so a total can be shown.
export const SEARCH_RESULTS_CAP = 80;

// The search inputs' placeholders and the note naming what search doesn't cover.
export const SEARCH_PLACEHOLDER = 'Search suttas and lists';
export const READER_SEARCH_PLACEHOLDER = 'Search suttas';
export const SEARCH_SCOPE_NOTE =
  'Search covers sutta numbers, titles, summaries and your own notes — not the text of the suttas.';
export const SEARCH_NO_MATCHES = `No matches. ${SEARCH_SCOPE_NOTE}`;

// Said at the foot of the results when the query matched more than the cap draws.
export const SEARCH_CAP_NOTE = `Showing the first ${SEARCH_RESULTS_CAP} results. Try a more specific search.`;

// Folds text to a case- and diacritic-insensitive key, so a typed "a" matches "ā". Exported for
// lib/search/match.ts, which has to fold exactly as the match did.
// The corpus writes the typographic apostrophe and a keyboard types the straight one, so the two
// fold together — otherwise "elephant's footprint" misses the sutta titled with it.
export function searchKey(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\u2018\u2019\u02bc]/g, "'").toLowerCase();
}

// Each sutta's folded ref/title/Pali and blurb, everything search reads that doesn't change.
// Cached per Corpus object, which is fetched once and never mutated, since searchCorpus runs over
// every sutta on each keystroke. Two strings rather than one, so a hit can be ranked by where it
// matched.
const staticHaystackCache = new WeakMap<Corpus, Map<string, { title: string; blurb: string }>>();

function staticHaystacksFor(corpus: Corpus): Map<string, { title: string; blurb: string }> {
  let cache = staticHaystackCache.get(corpus);
  if (!cache) {
    cache = new Map();
    for (const [id, s] of suttaEntries(corpus)) {
      cache.set(id, { title: searchKey([s.ref, s.en, s.pali].join(' ')), blurb: searchKey(s.blurb) });
    }
    staticHaystackCache.set(corpus, cache);
  }
  return cache;
}

// Each sutta's list-name haystack: the folded path of every list holding it, with the breadcrumb's
// spacing collapsed so "group/list" and "list" both match, several paths joined by a newline that
// nothing in a query can span.
function listHaystacks(lists: ListDef[]): Map<string, string> {
  const byId = new Map<string, string>();
  for (const { list, breadcrumb } of flattenListTree(lists)) {
    if (list.kind === 'group') continue;
    const pathKey = searchKey(breadcrumb).replace(/\s*\/\s*/g, '/');
    for (const itemId of list.items) {
      const prev = byId.get(itemId);
      byId.set(itemId, prev ? `${prev}\n${pathKey}` : pathKey);
    }
  }
  return byId;
}

// The suttas the reader has filed, noted or highlighted, which sort first within a rank bucket.
// The auto-lists are skipped: two restate the records checked here, and "Visited" holds everything
// recently opened, which would mark most of a reader's canon as saved.
function savedIds(lists: ListDef[], notes: Record<string, string>, highlights: HighlightsMap): Set<string> {
  const saved = new Set<string>();
  for (const { list } of flattenListTree(lists)) {
    if (list.kind === 'group' || list.auto) continue;
    for (const itemId of list.items) saved.add(itemId);
  }
  for (const [id, text] of Object.entries(notes)) if (text.trim()) saved.add(id);
  for (const [id, ranges] of Object.entries(highlights)) if (ranges.length) saved.add(id);
  return saved;
}

// Rank buckets, best first — see the search rules at the top of this file.
//   phrase in title – the query as typed, in the ref, title or Pali
//   words in title  – every word there, apart
//   phrase          – the query as typed in a blurb, note or list name
//   words           – every word, anywhere search reads
const RANK_PHRASE_IN_TITLE = 0;
const RANK_WORDS_IN_TITLE = 1;
const RANK_PHRASE = 2;
const RANK_WORDS = 3;

// Returns every sutta matching `query`, best first.
export function searchCorpus(
  corpus: Corpus,
  query: string,
  notes: Record<string, string>,
  lists: ListDef[] = [],
  highlights: HighlightsMap = {}
): SearchHit[] {
  const q = searchKey(query.trim());
  if (!q) return [];
  // A one-word query makes the phrase and word tests identical, collapsing the four buckets to
  // two: title, then everything else.
  const words = q.split(/\s+/);
  const staticHaystacks = staticHaystacksFor(corpus);
  const rangeQuery = q.match(RANGE_QUERY);
  const ranges = rangeQuery ? rangesFor(corpus) : null;
  const listPathsById = listHaystacks(lists);
  const saved = savedIds(lists, notes, highlights);
  const hits: SearchHit[] = [];
  for (const [id, s] of suttaEntries(corpus)) {
    const { title, blurb } = staticHaystacks.get(id)!;
    const note = notes[id] ? searchKey(notes[id]) : '';
    const listPaths = listPathsById.get(id) ?? '';
    let rank = -1;
    if (title.includes(q)) rank = RANK_PHRASE_IN_TITLE;
    else if (words.every((w) => title.includes(w))) rank = RANK_WORDS_IN_TITLE;
    else if (blurb.includes(q) || note.includes(q) || listPaths.includes(q)) rank = RANK_PHRASE;
    else if (words.every((w) => title.includes(w) || blurb.includes(w) || note.includes(w) || listPaths.includes(w))) rank = RANK_WORDS;
    let matchedId: string | undefined;
    // Checked even for a sutta that already ranked, since a query for a batch's first inner uid
    // matches its ref too and still needs the `matchedId` to scroll to.
    if (rangeQuery) {
      const range = ranges!.get(id);
      const num = Number(rangeQuery[2]);
      if (range && range.prefix === rangeQuery[1] && num >= range.start && num <= range.end) {
        rank = RANK_PHRASE_IN_TITLE;
        matchedId = `${rangeQuery[1]}${rangeQuery[2]}`;
      }
    }
    if (rank < 0) continue;
    // Strict and word-level: a sutta sharing even one query word with its own text got here on its
    // own merits.
    const listOnly =
      rank >= RANK_PHRASE &&
      words.every((w) => listPaths.includes(w) && !title.includes(w) && !blurb.includes(w) && !note.includes(w));
    hits.push({ id, sutta: s, matchedId, listOnly, rank, saved: saved.has(id) });
  }
  hits.sort((a, b) => a.rank - b.rank || Number(b.saved) - Number(a.saved));
  return hits;
}

// How many list hits show before "N more lists" expands the block.
export const LIST_RESULTS_CAP = 3;

export interface ListHit {
  list: ListDef;
  // The groups above this list ("Practice / Mornings"), empty for a top-level one. A query matching
  // only up here is still a hit.
  parents: string;
}

// The user's lists whose own name, or an ancestor group's, matches — a list before one reached
// only through its group. Only 'list'-kind rows: a group holds no suttas and can't be opened, and
// the auto-lists sit permanently at the top of the Lists tab.
export function searchLists(lists: ListDef[], query: string): ListHit[] {
  const q = searchKey(query.trim());
  if (!q) return [];
  const words = q.split(/\s+/);
  const own: ListHit[] = [];
  const viaGroup: ListHit[] = [];
  for (const { list, breadcrumb } of flattenListTree(lists)) {
    if (list.kind === 'group') continue;
    // The breadcrumb is `${parents} / ${label}`, so the group path is what remains once the label's
    // own length is trimmed off the end — splitting on ' / ' would break on a list named
    // "Before / After".
    const parents = breadcrumb.slice(0, -list.label.length).replace(/ \/ $/, '');
    const name = searchKey(list.label);
    if (name.includes(q) || words.every((w) => name.includes(w))) own.push({ list, parents });
    else if (words.every((w) => searchKey(breadcrumb).includes(w))) viaGroup.push({ list, parents });
  }
  return [...own, ...viaGroup];
}
