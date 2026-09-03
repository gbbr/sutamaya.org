// The corpus: loading corpus.json and per-sutta text, walking the browse tree, and search.
//
// **Search** covers a sutta's ref, title, Pali, blurb, the reader's own note, and the names of the
// lists holding it — never the sutta text itself. A query is folded to a diacritic-insensitive key
// (searchKey), and every word must be found, though not adjacent and not in one field, so "raft
// simile" reaches a blurb reading "the simile of the raft". Contiguity and field are ranking
// signals instead, in four buckets: the phrase in the ref/title/Pali, then every word there, then
// the phrase anywhere, then every word anywhere. Within a bucket, a sutta the reader has filed,
// noted or highlighted sorts first, and the rest keep the corpus's build order. The boost never
// crosses buckets, so a title match always beats a blurb match.
//
// A query naming one sutta of a batched document ("dhp325" inside "dhp320-333") matches the batch
// and carries the inner uid as `matchedId`, since the corpus has no entry of its own for it.
//
// The dictionary is not loaded here: it is fetched one range shard at a time by the tap that needs
// it (lib/dictionaryShards.ts).
import { flattenListTree } from './lists';
import type { ChapterRow, Corpus, HighlightsMap, ListDef, Nikaya, Sutta } from './types';

export async function loadCorpus(): Promise<Corpus> {
  const res = await fetch('/data/corpus.json');
  if (!res.ok) throw new Error(`Failed to load corpus.json (${res.status})`);
  return res.json();
}

// A segment's structural role, from SuttaCentral's own markup (build-corpus.mjs's roleFor());
// omitted for plain prose.
export type SegmentRole = 'verse' | 'heading' | 'end' | 'speaker' | 'list-item';

export interface SegmentFile {
  key: string;
  pali: string;
  en: string;
  role?: SegmentRole;
  // The sub-heading's <h2>–<h5> nesting, for role === 'heading' only.
  headingLevel?: 2 | 3 | 4 | 5;
  // Bhikkhu Sujato's translator note, which may contain inline HTML.
  note?: string;
}

// True for a segment left with no English at all — an elided repetition, or an untranslated uddāna
// verse. Around 14,000 of them. Nothing renders for such a segment to tap, so its Pali is never
// revealed and the dictionary's word walk steps over it.
export function isUntranslated(seg: SegmentFile): boolean {
  return seg.en.trim() === '';
}

const textCache = new Map<string, Promise<SegmentFile[]>>();
// The settled values of `textCache`, so an already-loaded sutta reads synchronously — a resolved
// promise still answers a microtask later, which costs a render with no text.
const textResolved = new Map<string, SegmentFile[]>();

export function loadSuttaText(uid: string): Promise<SegmentFile[]> {
  let p = textCache.get(uid);
  if (!p) {
    p = fetch(`/data/text/${encodeURIComponent(uid)}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load ${uid}.json (${r.status})`);
        return r.json();
      })
      .then((segs: SegmentFile[]) => {
        textResolved.set(uid, segs);
        return segs;
      });
    // Evict a failed fetch, so a retry refetches instead of replaying the same rejection.
    p.catch(() => textCache.delete(uid));
    textCache.set(uid, p);
  }
  return p;
}

// The text for `uid` if a previous loadSuttaText has already resolved it, else undefined.
export function peekSuttaText(uid: string | undefined): SegmentFile[] | undefined {
  return uid ? textResolved.get(uid) : undefined;
}

export function suttaEntries(corpus: Corpus): Array<[string, Sutta]> {
  return Object.entries(corpus.suttas);
}

export function suttasFor(corpus: Corpus, nodeId: string): Array<[string, Sutta]> {
  return suttaEntries(corpus).filter(([, s]) => s.node === nodeId);
}

// Splits an id into digit and non-digit runs, for compareIds' natural sort.
const ID_TOKEN = /(\d+)|(\D+)/g;

// Compares two ids naturally, digit runs numerically, so "mn9" sorts before "mn10".
export function compareIds(a: string, b: string): number {
  const ta = a.match(ID_TOKEN) || [];
  const tb = b.match(ID_TOKEN) || [];
  const len = Math.max(ta.length, tb.length);
  for (let i = 0; i < len; i++) {
    const x = ta[i] ?? '';
    const y = tb[i] ?? '';
    if (x === y) continue;
    const nx = /^\d+$/.test(x) ? Number(x) : NaN;
    const ny = /^\d+$/.test(y) ? Number(y) : NaN;
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) return nx - ny;
    return x < y ? -1 : 1;
  }
  return 0;
}

export function sortByIdAsc(entries: Array<[string, Sutta]>): Array<[string, Sutta]> {
  return [...entries].sort((a, b) => compareIds(a[0], b[0]));
}

function collectLeafGroupIds(node: { id: string; chapters?: ChapterRow[] }, acc: string[]): void {
  if (isExpandable(node)) {
    for (const c of node.chapters!) collectLeafGroupIds(c, acc);
  } else {
    acc.push(node.id);
  }
}

// Every sutta in canonical browse order — nikaya by nikaya, leaf group by leaf group, id ascending
// within each — which is the order the reader's Prev/Next walks.
export function flatSuttaOrder(corpus: Corpus): string[] {
  const leafGroupIds: string[] = [];
  for (const n of corpus.nikayas) collectLeafGroupIds(n, leafGroupIds);
  // Bucketed in one pass rather than a suttasFor() per group, which would re-scan every sutta ~440
  // times during LibraryPage's first render.
  const byNode = new Map<string, Array<[string, Sutta]>>();
  for (const entry of suttaEntries(corpus)) {
    let bucket = byNode.get(entry[1].node);
    if (!bucket) byNode.set(entry[1].node, (bucket = []));
    bucket.push(entry);
  }
  const ids: string[] = [];
  for (const groupId of leafGroupIds) {
    for (const [id] of sortByIdAsc(byNode.get(groupId) ?? [])) ids.push(id);
  }
  return ids;
}

// Finds a node anywhere in the browse tree, at any depth. `ancestors` is the top-down chain from
// the nikaya down to, but not including, the node itself.
export function findNode(corpus: Corpus, id: string) {
  for (const n of corpus.nikayas) {
    if (n.id === id) return { kind: 'nikaya' as const, node: n, ancestors: [] as Array<Nikaya | ChapterRow> };
    const found = findInChapters(n.chapters, id, [n]);
    if (found) return found;
  }
  return null;
}

function findInChapters(
  chapters: ChapterRow[] | undefined,
  id: string,
  ancestors: Array<Nikaya | ChapterRow>
): { kind: 'chapter'; node: ChapterRow; ancestors: Array<Nikaya | ChapterRow> } | null {
  if (!chapters) return null;
  for (const c of chapters) {
    if (c.id === id) return { kind: 'chapter' as const, node: c, ancestors };
    const found = findInChapters(c.chapters, id, [...ancestors, c]);
    if (found) return found;
  }
  return null;
}

export interface BreadcrumbEntry {
  id: string;
  label: string;
}

// The path from nikaya down to and including a leaf group, for the reader's breadcrumb.
export function breadcrumbFor(corpus: Corpus, nodeId: string): BreadcrumbEntry[] {
  const found = findNode(corpus, nodeId);
  if (!found) return [];
  const chain = found.kind === 'chapter' ? [...found.ancestors, found.node] : [found.node];
  return chain.map((n) => ({ id: n.id, label: n.label }));
}

// Returns a node's display name, from the corpus or from the user's lists. `ref` ("MN1–10") is
// present only for a chapter-kind node, matching TreeRow's own ref/label split.
export function nodeLabel(corpus: Corpus | null, id: string, lists: ListDef[]): { ref?: string; label: string } {
  const found = corpus ? findNode(corpus, id) : null;
  if (found) {
    if (found.kind === 'chapter') return { ref: found.node.ref, label: found.node.label };
    return { label: found.node.label };
  }
  const list = lists.find((l) => String(l.id) === id);
  return { label: list ? list.label : '' };
}

// True for a node with children, which expands in place and never opens a page.
export function isExpandable(node: { chapters?: unknown }): boolean {
  return Array.isArray(node.chapters) && node.chapters.length > 0;
}

// The description shown above a node's sutta list, and where it came from. The source data writes
// descriptions at inconsistent depths, so a node without one borrows its nearest ancestor's and
// `from` names that ancestor; undefined `from` means the node's own. Some nodes have neither.
export function nodeBlurb(
  corpus: Corpus | null,
  nodeId: string | undefined
): { blurb?: string; from?: string } {
  if (!corpus || !nodeId) return {};
  const found = findNode(corpus, nodeId);
  if (!found) return {};
  // Only a ChapterRow carries a blurb; a nikaya never does.
  const blurbOf = (n: Nikaya | ChapterRow) => ('blurb' in n ? n.blurb : undefined);
  const own = blurbOf(found.node);
  if (own) return { blurb: own };
  if (found.kind !== 'chapter') return {};
  for (let i = found.ancestors.length - 1; i >= 0; i--) {
    const a = found.ancestors[i];
    const blurb = blurbOf(a);
    if (blurb) return { blurb, from: 'ref' in a ? `${a.ref} · ${a.label}` : a.label };
  }
  return {};
}

// The ancestor ids that must be open for `nodeId` to be visible in the browse tree.
export function ancestorsOf(corpus: Corpus | null, nodeId: string | undefined): Record<string, boolean> {
  if (!corpus || !nodeId) return {};
  const found = findNode(corpus, nodeId);
  if (found?.kind !== 'chapter' || !found.ancestors.length) return {};
  const init: Record<string, boolean> = {};
  for (const a of found.ancestors) init[a.id] = true;
  return init;
}

// Every id below `nodeId` at any depth, excluding itself — what TreePane's ⌥-click deep collapse
// closes.
export function descendantIdsOf(corpus: Corpus | null, nodeId: string): string[] {
  const found = corpus ? findNode(corpus, nodeId) : null;
  if (!found) return [];
  const ids: string[] = [];
  (function walk(chapters: ChapterRow[] | undefined) {
    for (const c of chapters || []) {
      ids.push(c.id);
      walk(c.chapters);
    }
  })(found.node.chapters);
  return ids;
}

export interface SearchHit {
  id: string;
  sutta: Sutta;
  // The inner sutta the query named within a batched document, which the caller opens instead of
  // `id`. Unset for a match the data can't attribute to one inner sutta.
  matchedId?: string;
  // True when the query reached this sutta only through the name of a list holding it.
  listOnly?: boolean;
  // The bucket this hit ranked in, so lib/textSearch.ts can extend the ladder past bucket 3.
  rank: number;
  // Whether the reader has filed, noted or highlighted it — the tie-break within a bucket.
  saved: boolean;
  // The paragraph of sutta text the query was found in, its English where that paragraph was Pali,
  // and the segment to open the reader at. Filled in by lib/textSearch.ts for the hits that render;
  // absent on a metadata-only hit.
  snippet?: { text: string; under?: string; segment: number };
}

// How many hits a caller renders; searchCorpus still returns every match, so a total can be shown.
export const SEARCH_RESULTS_CAP = 80;

// The search inputs' placeholders and the note naming what search doesn't cover.
export const SEARCH_PLACEHOLDER = 'Search suttas and lists';
export const READER_SEARCH_PLACEHOLDER = 'Search suttas';
export const SEARCH_SCOPE_NOTE =
  'Search covers sutta numbers, titles, summaries and your own notes — not the text of the suttas.';
export const SEARCH_NO_MATCHES = `No matches. ${SEARCH_SCOPE_NOTE}`;

// Folds text to a case- and diacritic-insensitive key, so a typed "a" matches "ā". Exported for
// lib/searchMatch.ts, which has to fold exactly as the match did.
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

interface UidRange {
  prefix: string;
  start: number;
  end: number;
}

// A batched leaf uid ("dhp320-333") and a query naming one sutta inside such a range ("dhp325").
// `prefix` is everything before the trailing numbers, dotted chapter included ("sn35.", "an1."),
// mirroring scripts/lib/collections.js's suttaNumRange.
const RANGE_UID = /^([a-z][a-z-]*(?:\d+\.)?)(\d+)-(\d+)$/;
const RANGE_QUERY = /^([a-z][a-z-]*(?:\d+\.)?)(\d+)$/;

function parseRangeUid(id: string): UidRange | null {
  const m = id.match(RANGE_UID);
  if (!m) return null;
  return { prefix: m[1], start: Number(m[2]), end: Number(m[3]) };
}

const rangeCache = new WeakMap<Corpus, Map<string, UidRange>>();

function rangesFor(corpus: Corpus): Map<string, UidRange> {
  let cache = rangeCache.get(corpus);
  if (!cache) {
    cache = new Map();
    for (const [id] of suttaEntries(corpus)) {
      const range = parseRangeUid(id);
      if (range) cache.set(id, range);
    }
    rangeCache.set(corpus, cache);
  }
  return cache;
}

// Folds a sutta id arriving from a URL to the lowercase the corpus uses; every reference the app
// displays is capitalized, so a shared link carries capitals.
export function normalizeRouteId(id: string): string {
  return id.toLowerCase();
}

// Folds a `/browse` segment only when it names a corpus node: a list id is opaque, and folding it
// would name a different list. An id arriving before the corpus loads is left alone.
export function normalizeBrowseNodeId(corpus: Corpus | null, id: string): string {
  const lower = normalizeRouteId(id);
  if (lower === id || !corpus) return id;
  return findNode(corpus, lower) ? lower : id;
}

// Resolves an id to the document that actually holds it: the enclosing batch for an id like
// "dhp321", and the id itself where the corpus has an entry, or where nothing matches — so an
// invalid id still resolves to itself and 404s.
export function resolveCanonicalSuttaId(corpus: Corpus, id: string): string {
  const lower = normalizeRouteId(id);
  if (corpus.suttas[lower]) return lower;
  const m = lower.match(RANGE_QUERY);
  if (!m) return lower;
  const num = Number(m[2]);
  for (const [batchId, range] of rangesFor(corpus)) {
    if (range.prefix === m[1] && num >= range.start && num <= range.end) return batchId;
  }
  return lower;
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

// The rows ListPane renders while browsing a node or a user list.
export function listItemsFor(corpus: Corpus, nodeId: string | undefined, lists: ListDef[]): Array<[string, Sutta]> {
  if (!nodeId) return [];
  const list = lists.find((l) => String(l.id) === nodeId);
  if (list) {
    // A list keeps its stored order, the one place the reader's own sequencing wins over id order.
    return list.items
      .map((id) => (corpus.suttas[id] ? ([id, corpus.suttas[id]] as [string, Sutta]) : null))
      .filter((x): x is [string, Sutta] => x !== null);
  }
  return sortByIdAsc(suttasFor(corpus, nodeId));
}
