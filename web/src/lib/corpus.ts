import { flattenListTree } from './lists';
import type { ChapterRow, Corpus, HighlightsMap, ListDef, Nikaya, Sutta } from './types';

export async function loadCorpus(): Promise<Corpus> {
  const res = await fetch('/data/corpus.json');
  if (!res.ok) throw new Error(`Failed to load corpus.json (${res.status})`);
  return res.json();
}

// The dictionary is not loaded here at all — it's fetched one range shard at a time, on the tap
// that needs it. See lib/dictionaryShards.ts.

// SuttaCentral's own structural role for this segment, derived at build time from `data/html/`
// (see build-corpus.mjs's roleFor()) — omitted for the common "plain prose" case.
export type SegmentRole = 'verse' | 'heading' | 'end' | 'speaker' | 'list-item';

export interface SegmentFile {
  key: string;
  pali: string;
  en: string;
  role?: SegmentRole;
  // Only set when role === 'heading': SuttaCentral's own <h2>–<h5> nesting for this sub-heading,
  // preserved so the reader renders the real heading element rather than collapsing every level to
  // one visual weight.
  headingLevel?: 2 | 3 | 4 | 5;
  // Bhikkhu Sujato's translator note for this segment (data/sujato/notes/), if any. May contain
  // inline HTML; cross-reference links are stripped to plain text at build time (build-corpus.mjs's
  // cleanNote()).
  note?: string;
}

const textCache = new Map<string, Promise<SegmentFile[]>>();
// The settled values of `textCache`, so an already-loaded sutta can be read synchronously. A
// resolved promise still hands its value back a microtask later, which costs one render with no
// text — enough to break the reader's step animation. See peekSuttaText.
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

// Natural sort: splits an id into digit/non-digit runs and compares digit runs
// numerically, so "mn10" sorts after "mn9" instead of before it.
const ID_TOKEN = /(\d+)|(\D+)/g;

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

// Every sutta in the corpus in canonical browse order — nikaya by nikaya, leaf group by leaf group,
// sutta id ascending within each — so the reader's Prev/Next walks across a category boundary
// rather than stopping at its edge.
export function flatSuttaOrder(corpus: Corpus): string[] {
  const leafGroupIds: string[] = [];
  for (const n of corpus.nikayas) collectLeafGroupIds(n, leafGroupIds);
  // One pass, rather than suttasFor() per leaf group — that would re-scan all ~4000 suttas for each
  // of ~440 groups, and LibraryPage calls this during its first render.
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

// Every browsable id: nikaya ids, chapter/group/category ids (arbitrarily nested — SN goes
// nikaya > group > chapter > category, AN goes nikaya > chapter > category, MN goes nikaya >
// category), and (for search) sutta ids. `ancestors` is the top-down chain from the nikaya
// down to (but not including) the found node itself — used to expand every level of TreePane
// on deep-link/search-driven navigation.
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

// The path from nikaya down to and including a sutta's leaf group — "Saṁyutta Nikāya > The Group on
// Feeling > SN36.1–11" — for the breadcrumb above the reader's title. Every entry navigates to the
// sutta's enclosing leaf group with the sutta highlighted there (ReaderPage's breadcrumb onClick),
// not to that entry's own node: a segment further up the chain has no suttas to land on.
export function breadcrumbFor(corpus: Corpus, nodeId: string): BreadcrumbEntry[] {
  const found = findNode(corpus, nodeId);
  if (!found) return [];
  const chain = found.kind === 'chapter' ? [...found.ancestors, found.node] : [found.node];
  return chain.map((n) => ({ id: n.id, label: n.label }));
}

// `ref` is only present for a chapter-kind node (e.g. "MN1–10"), matching TreeRow's own
// ref/label split so a title bar can style the ref the same way (see ListPane's title header).
// Takes a nullable corpus, like ancestorsOf: callers hold whatever CorpusContext currently has,
// and a user list's label resolves from `lists` whether or not the corpus is loaded.
export function nodeLabel(corpus: Corpus | null, id: string, lists: ListDef[]): { ref?: string; label: string } {
  const found = corpus ? findNode(corpus, id) : null;
  if (found) {
    if (found.kind === 'chapter') return { ref: found.node.ref, label: found.node.label };
    return { label: found.node.label };
  }
  const list = lists.find((l) => String(l.id) === id);
  return { label: list ? list.label : '' };
}

// A node has children to expand exactly when it carries a non-empty `chapters` array. Such a row
// toggles and never navigates.
export function isExpandable(node: { chapters?: unknown }): boolean {
  return Array.isArray(node.chapters) && node.chapters.length > 0;
}

// The description to show above a node's sutta list, and where it came from.
//
// Only leaf groups open a page, but the source data writes its descriptions at inconsistent depths:
// MN's sit on the vagga, SN's on the saṁyutta above it. A leaf without one of its own borrows the
// nearest ancestor's, and `from` names that ancestor, so the reader isn't told a chapter of ten
// discourses is "about" something broader than what's listed. Undefined `from` means the node's
// own; AN's vaggas and four of KN's books have neither and show nothing.
//
// Nearest wins, so SN's five book-level descriptions never surface — every saṁyutta under them has
// one of its own.
export function nodeBlurb(
  corpus: Corpus | null,
  nodeId: string | undefined
): { blurb?: string; from?: string } {
  if (!corpus || !nodeId) return {};
  const found = findNode(corpus, nodeId);
  if (!found) return {};
  // Only ChapterRow carries a blurb; a nikaya never does, and neither does any node the data
  // has nothing for.
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

// The set of ancestor ids (nikaya > group > chapter > category, as deep as it goes) that need
// to be open for `nodeId` to be visible in TreePane's corpus browse tree.
export function ancestorsOf(corpus: Corpus | null, nodeId: string | undefined): Record<string, boolean> {
  if (!corpus || !nodeId) return {};
  const found = findNode(corpus, nodeId);
  if (found?.kind !== 'chapter' || !found.ancestors.length) return {};
  const init: Record<string, boolean> = {};
  for (const a of found.ancestors) init[a.id] = true;
  return init;
}

// Every id below `nodeId` at any depth, excluding `nodeId` itself — the inverse of ancestorsOf.
// TreePane's ⌥-click deep collapse uses it to close a whole subtree rather than hide it with its
// children still flagged open.
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
  // Set only when the match came from the range-query fallback below — searching "dhp325" against
  // the "dhp320-333" batch. It is the inner sutta id the caller opens instead of `id`, so the
  // reader scrolls to and marks that sutta rather than opening the batch at its top. Unset for a
  // plain title/blurb/note match, which the data can't attribute to one inner sutta.
  matchedId?: string;
  // True when the query reached this sutta only through the name of a list it is in — no word of it
  // appears in the sutta's own ref, title, Pali, blurb or note. LibraryPage drops these when the
  // list itself is the one thing that matched, since its row already stands for them.
  listOnly?: boolean;
}

// How many hits a caller renders. A short query can match hundreds of suttas, and every consumer
// (TreePane's search, ListPane, ReaderSearchOverlay) draws hits as unvirtualized DOM rows.
// searchCorpus itself still returns every match, so a caller can show an accurate total.
export const SEARCH_RESULTS_CAP = 80;

// What each search input offers to find. Named for what the reader is looking for rather than for
// the fields searchCorpus scans; the library's also finds lists by name, which the reader's overlay
// deliberately doesn't show. What is *not* searched — the sutta text itself — is said in the
// no-matches line below instead, which is where someone who typed a remembered phrase ends up.
export const SEARCH_PLACEHOLDER = 'Search suttas and lists';
export const READER_SEARCH_PLACEHOLDER = 'Search suttas';
export const SEARCH_SCOPE_NOTE =
  'Search covers sutta numbers, titles, summaries and your own notes — not the text of the suttas.';
export const SEARCH_NO_MATCHES = `No matches. ${SEARCH_SCOPE_NOTE}`;

// Case- and diacritic-insensitive comparison key: Pali romanization leans on combining marks (ā, ī,
// ñ, ṭ, ṁ, …) most people don't type, so plain "a" and "n" match "ā" and "ñ". NFD splits each
// accented letter into its base letter plus a combining mark in U+0300–U+036F, which the replace
// then discards. Exported for lib/searchMatch.ts, which has to fold text exactly as the match did.
export function searchKey(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// Each sutta's searchKey'd static haystack — everything except the user's note, which changes
// independently — cached per Corpus object, since searchCorpus runs on every keystroke across all
// ~4000 suttas. corpus.json is fetched once and never mutated, so a WeakMap keyed on the Corpus
// reference is safe for the app's lifetime. Two strings rather than one joined haystack, so a hit
// can be ranked by where it matched (searchCorpus's `rank`).
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

// A batched leaf uid like "dhp320-333" covers Dhp verses 320–333 in one document and has no entry
// of its own for any number inside the range, so a query for "dhp325" would otherwise match
// nothing. Mirrors scripts/lib/collections.js's suttaNumRange: `prefix` is everything up to the
// trailing `start-end`, including a dotted chapter number ("sn35.", "an1."), so it lines up with
// how such a query is typed.
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

// The enclosing batch's id for a deep-link id like "dhp321", which has no `corpus.suttas` entry of
// its own (see RANGE_UID above), so `/read/dhp321` and a search hit for it land on the same
// document. Identity for an id that already has an entry — checked first — and for one matching no
// range, so a genuinely invalid id still resolves to itself and 404s.
export function resolveCanonicalSuttaId(corpus: Corpus, id: string): string {
  if (corpus.suttas[id]) return id;
  const m = id.match(RANGE_QUERY);
  if (!m) return id;
  const num = Number(m[2]);
  for (const [batchId, range] of rangesFor(corpus)) {
    if (range.prefix === m[1] && num >= range.start && num <= range.end) return batchId;
  }
  return id;
}

// Each sutta's list-name haystack: the normalized paths of every list holding it, at any depth, via
// flattenListTree's "Group / List" breadcrumb collapsed to a bare "group/list" so the breadcrumb's
// spacing isn't required — "group/list" and "list" both match. Only 'list'-kind rows are walked; a
// leaf's breadcrumb already names every ancestor group, and a group's own `items` is always empty.
// A sutta can sit in several lists, so their paths are joined with a newline, which nothing in a
// query can span.
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

// The suttas the reader has made their own: filed in one of their lists, noted, or highlighted.
// They sort ahead of untouched suttas within each rank bucket (see searchCorpus's sort). The three
// auto-lists are skipped — "Notes" and "Highlights" restate the records checked here, and "Visited"
// holds everything recently opened, which would mark most of a reader's canon as saved and leave
// the boost meaning nothing.
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

// Rank buckets, best first. Two things order a hit: whether the query's words were found together
// as typed, and whether they were found in the ref/title/Pali rather than in a blurb, note or list
// name. So a sutta titled "Mindfulness of Breathing" beats one whose title merely holds both words
// apart, which beats one whose blurb says the phrase, which beats one that only has the words
// scattered across its blurb and a list name.
const RANK_PHRASE_IN_TITLE = 0;
const RANK_WORDS_IN_TITLE = 1;
const RANK_PHRASE = 2;
const RANK_WORDS = 3;

// Within a bucket, a saved sutta (savedIds above) comes first; ties beyond that keep the corpus's
// own build order, since `Array.prototype.sort` is a stable sort in every engine this app targets.
// The boost never crosses buckets: a title match still beats a blurb match, saved or not, so the
// reader's own library reorders the results it belongs in rather than burying the obvious answer.
export function searchCorpus(
  corpus: Corpus,
  query: string,
  notes: Record<string, string>,
  lists: ListDef[] = [],
  highlights: HighlightsMap = {}
): SearchHit[] {
  const q = searchKey(query.trim());
  if (!q) return [];
  // Every word has to be found, but not adjacent and not in the same field: "raft simile" and
  // "simile of the raft" both reach a sutta whose blurb calls it "the simile of the raft", and a
  // word from the title plus a word from the reader's note is a good way to remember a sutta.
  // Contiguity is a ranking signal rather than a requirement (see the rank buckets above). For a
  // one-word query the phrase and word tests are identical, collapsing this to two buckets: title,
  // then everything else.
  const words = q.split(/\s+/);
  const staticHaystacks = staticHaystacksFor(corpus);
  const rangeQuery = q.match(RANGE_QUERY);
  const ranges = rangeQuery ? rangesFor(corpus) : null;
  const listPathsById = listHaystacks(lists);
  const saved = savedIds(lists, notes, highlights);
  const hits: Array<SearchHit & { rank: number; saved: boolean }> = [];
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
    // Checked unconditionally, not only when the query missed the title. A batch's ref starts with
    // `${prefix}${start}` ("Dhp209–220"), so a query for its first inner uid already ranks as a
    // title match — gating this on a title miss would leave that one case without a matchedId, and
    // open the batch at its top instead of scrolling to the requested sutta.
    if (rangeQuery) {
      const range = ranges!.get(id);
      const num = Number(rangeQuery[2]);
      if (range && range.prefix === rangeQuery[1] && num >= range.start && num <= range.end) {
        rank = RANK_PHRASE_IN_TITLE;
        matchedId = `${rangeQuery[1]}${rangeQuery[2]}`;
      }
    }
    if (rank < 0) continue;
    // Word-level and strict: a sutta sharing even one query word with its own text got here on its
    // own merits, and isn't a restatement of a list row above it.
    const listOnly =
      rank >= RANK_PHRASE &&
      words.every((w) => listPaths.includes(w) && !title.includes(w) && !blurb.includes(w) && !note.includes(w));
    hits.push({ id, sutta: s, matchedId, listOnly, rank, saved: saved.has(id) });
  }
  hits.sort((a, b) => a.rank - b.rank || Number(b.saved) - Number(a.saved));
  return hits;
}

// How many list hits the results block shows before "N more lists" expands it. The block sits above
// the sutta hits on both surfaces, and on a phone a fourth row pushes the first sutta below the
// fold.
export const LIST_RESULTS_CAP = 3;

export interface ListHit {
  list: ListDef;
  // The groups above this list ("Practice", "Practice / Mornings"), empty for a top-level one.
  // Rendered beside the name, which is what tells apart two lists sharing a name under different
  // groups. The row is also a hit when the query matched only up here.
  parents: string;
}

// The user's lists whose name, or an ancestor group's name, matches — rendered as their own section
// above the sutta hits, since a reader who types a list's name is looking for the list itself.
//
// Only `kind: 'list'` rows: a group holds no suttas, so /browse/<groupId> shows an empty pane and
// can't be a destination; it appears here only as its children's breadcrumb. The auto-lists are out
// too (flattenListTree drops them), since they sit permanently at the top of the Lists tab.
export function searchLists(lists: ListDef[], query: string): ListHit[] {
  const q = searchKey(query.trim());
  if (!q) return [];
  const words = q.split(/\s+/);
  // Same two-tier idea as searchCorpus's rank buckets, one tier shorter: a list whose own name
  // matches beats one reached only through the group it sits in.
  const own: ListHit[] = [];
  const viaGroup: ListHit[] = [];
  for (const { list, breadcrumb } of flattenListTree(lists)) {
    if (list.kind === 'group') continue;
    // flattenListTree builds the breadcrumb as `${parents} / ${label}`, so trimming the list's own
    // label off the end leaves the group path — robust where splitting on ' / ' wouldn't be, since
    // nothing stops a user naming a list "Before / After".
    const parents = breadcrumb.slice(0, -list.label.length).replace(/ \/ $/, '');
    const name = searchKey(list.label);
    if (name.includes(q) || words.every((w) => name.includes(w))) own.push({ list, parents });
    else if (words.every((w) => searchKey(breadcrumb).includes(w))) viaGroup.push({ list, parents });
  }
  return [...own, ...viaGroup];
}

// The rows ListPane renders while browsing. Searching goes through LibraryPage, which computes the
// hits once and hands them to both TreePane and ListPane so they show one consistent result set.
export function listItemsFor(corpus: Corpus, nodeId: string | undefined, lists: ListDef[]): Array<[string, Sutta]> {
  if (!nodeId) return [];
  const list = lists.find((l) => String(l.id) === nodeId);
  if (list) {
    // Stored order (user-arranged, see reorderListItems), not id order — a list is the one place in
    // the tree where the user's own sequencing wins over natural sutta order.
    return list.items
      .map((id) => (corpus.suttas[id] ? ([id, corpus.suttas[id]] as [string, Sutta]) : null))
      .filter((x): x is [string, Sutta] => x !== null);
  }
  return sortByIdAsc(suttasFor(corpus, nodeId));
}
