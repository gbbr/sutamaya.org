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
import type { ChapterRow, Corpus, HighlightsMap, ListDef, Nikaya, Sutta } from '../types';
import type { Mark } from './match';

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
  // Which line of the row carries the query, where something written *about* the sutta does: the
  // reader's own note, or the group description. That line leads the row and is what answers for
  // it. Unset where nothing the row writes matched — a title or list-name hit, or a text-only one.
  //
  // `query` is what the line is marked with, which is not always what was typed: where the
  // expansion table is what matched, it carries both.
  explains?: { line: 'note' | 'blurb'; query: string };
  // The paragraph of sutta text the query was found in, its English where that paragraph was Pali,
  // what the search matched in each, and the first and last segment it was drawn from. Filled in by
  // lib/search/text.ts for the hits that render, and kept only on the rows that open at it
  // (opensAtPassage).
  snippet?: { text: string; marks: Mark[]; under?: string; underMarks?: Mark[]; segments: [number, number] };
  // Every passage holding the query, on the sutta being read, in reading order.
  passages?: Array<NonNullable<SearchHit['snippet']>>;
}

// How many hits a caller renders; searchCorpus still returns every match, so a total can be shown.
export const SEARCH_RESULTS_CAP = 80;

// The search inputs' placeholders and the note naming what search doesn't cover.
export const SEARCH_PLACEHOLDER = 'Search suttas, text and lists';
export const READER_SEARCH_PLACEHOLDER = 'Search suttas and text';
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

// English function words, dropped from a query's required words and from its occurrence count, and
// from what counts as a line carrying the query — a blurb holding "the" answers nothing.
// "not" and "no" are deliberately absent — they are the whole of "not-self".
// Here rather than in lib/search/text.ts, which is where they are used most, because this module is
// the one both sides of the search import.
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'for', 'from', 'had', 'has',
  'have', 'he', 'her', 'him', 'his', 'i', 'in', 'into', 'is', 'it', 'its', 'me', 'my', 'of', 'on',
  'or', 'our', 'she', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this',
  'those', 'to', 'was', 'we', 'were', 'what', 'when', 'which', 'who', 'whom', 'will', 'with',
  'you', 'your',
]);

// The words of `words` a sutta must carry, and whose occurrences order it — the whole query when
// it holds nothing but function words, so `the` still searches for "the".
export function contentWords(words: string[]): string[] {
  const kept = words.filter((w) => !STOPWORDS.has(w));
  return kept.length ? kept : words;
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

// Whether a row shows the passage the query was found in and opens the sutta there. A hit reached
// through the row's own lines — its number, title, Pali title, summary, the reader's note — answers
// with the sutta itself and opens at the top instead; one reached through the name of a list, or
// through the text alone, says nothing about itself and the passage is its answer.
// See docs/search.md's "Snippets".
export function opensAtPassage(hit: SearchHit): boolean {
  return hit.rank > RANK_WORDS || !!hit.listOnly;
}

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
  // Whether a line of the row holds the query. Word by word as well as whole, since bucket 3 spreads
  // the query across fields and one of its words is enough for the line to mark something — but not
  // a function word, which every line holds and which would put an unmarked line on the row.
  const content = contentWords(words);
  const carries = (haystack: string) =>
    !!haystack && (haystack.includes(q) || content.some((w) => haystack.includes(w)));
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
    // The note before the description, which is the order a row prefers them in anyway. Marked with
    // this call's own query; searchCorpusVariants widens it where an expansion is what matched.
    const line: 'note' | 'blurb' | undefined = carries(note) ? 'note' : carries(blurb) ? 'blurb' : undefined;
    const explains = line ? { line, query: q } : undefined;
    hits.push({ id, sutta: s, matchedId, listOnly, rank, saved: saved.has(id), explains });
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

// A browse group whose name matches the query, drawn in the lists block after the lists.
export interface GroupHit {
  group: Nikaya | ChapterRow;
}

// A row of the lists block.
export type ListBlockHit = ListHit | GroupHit;

// Returns the node id a lists-block row selects.
export function listBlockHitId(hit: ListBlockHit): string {
  return 'group' in hit ? hit.group.id : hit.list.id;
}

// Returns the lists block's heading, naming the kinds it holds and counting every row, the hidden
// ones included: "Lists (2)", "Collections (4)", "Lists & collections (5)".
export function listBlockHeading(hits: ListBlockHit[]): string {
  const hasList = hits.some((h) => 'list' in h);
  const hasGroup = hits.some((h) => 'group' in h);
  return `${hasList && hasGroup ? 'Lists & collections' : hasGroup ? 'Collections' : 'Lists'} (${hits.length})`;
}

// Returns the heading over the sutta hits, counting them; past the cap it reads "80+".
export function suttaHitsHeading(total: number): string {
  return `Suttas (${total > SEARCH_RESULTS_CAP ? `${SEARCH_RESULTS_CAP}+` : total})`;
}

// Returns the lists block's rows counted by kind, one entry per kind present, in the order the
// block ranks them: ["2 lists", "1 collection"].
export function listBlockCounts(hits: ListBlockHit[]): string[] {
  const lists = hits.filter((h) => 'list' in h).length;
  const groups = hits.length - lists;
  const plural = (n: number, noun: string) => (n ? `${n} ${noun}${n === 1 ? '' : 's'}` : '');
  return [plural(lists, 'list'), plural(groups, 'collection')].filter(Boolean);
}

// Returns the browse groups, in tree order, that the query names:
//   by name      – each query word, or all of them run together as Pali writes "sutta nipāta",
//                  starts a word of the English or Pali name; never for under three letters or
//                  function words alone, which would name half the tree
//   by reference – the whole query is the group's reference, as "sn 35" is SN35; never a range
//                  like SN35.1–10
export function searchGroups(corpus: Corpus | null, query: string): GroupHit[] {
  const q = searchKey(query.trim());
  const words = q.split(/\s+/).filter((w) => w && !STOPWORDS.has(w));
  const joined = words.join('');
  // The query as a reference, function words kept, as "an 11" is AN11.
  const ref = q.replace(/\s+/g, '');
  if (!corpus || !ref) return [];
  const byName = joined.length >= 3;
  const hits: GroupHit[] = [];
  const visit = (group: Nikaya | ChapterRow) => {
    const name = searchKey(`${group.label} ${group.sub ?? ''}`).split(/[^a-z0-9']+/);
    const starts = (w: string) => name.some((n) => n.startsWith(w));
    const refMatch = 'ref' in group && !group.ref.includes('–') && searchKey(group.ref) === ref;
    if (refMatch || (byName && (words.every(starts) || starts(joined)))) hits.push({ group });
    group.chapters?.forEach(visit);
  };
  corpus.nikayas.forEach(visit);
  return hits;
}
