import { flattenListTree } from './lists';
import type { ChapterRow, Corpus, ListDef, Nikaya, Sutta } from './types';

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
  // Only set when role === 'heading' — SuttaCentral's own <h2>–<h5> nesting for this sub-heading
  // (e.g. DN9's internal sections genuinely nest h3s under an h2, DN2's numbered sub-sections nest
  // as deep as h5), preserved so the reader can render the real heading element instead of
  // collapsing every level to one visual weight.
  headingLevel?: 2 | 3 | 4 | 5;
  // Bhikkhu Sujato's own translator note for this segment (data/sujato/notes/), if any — may contain
  // inline HTML (`<i>`/`<em>`/`<b>`/`<span>`); cross-reference links have already been stripped
  // to plain text at build time (see build-corpus.mjs's cleanNote()).
  note?: string;
}

const textCache = new Map<string, Promise<SegmentFile[]>>();

export function loadSuttaText(uid: string): Promise<SegmentFile[]> {
  let p = textCache.get(uid);
  if (!p) {
    p = fetch(`/data/text/${encodeURIComponent(uid)}.json`).then((r) => {
      if (!r.ok) throw new Error(`Failed to load ${uid}.json (${r.status})`);
      return r.json();
    });
    // A failed fetch shouldn't stay cached forever — evict it so a later call (e.g. a retry)
    // re-fetches instead of replaying the same rejection.
    p.catch(() => textCache.delete(uid));
    textCache.set(uid, p);
  }
  return p;
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

// Every sutta in the whole corpus, in canonical browse order (nikaya by nikaya, leaf group by
// leaf group, sutta id ascending within each) — lets the reader's Prev/Next walk across a
// category boundary once the current one runs out, instead of stopping at its edge.
export function flatSuttaOrder(corpus: Corpus): string[] {
  const leafGroupIds: string[] = [];
  for (const n of corpus.nikayas) collectLeafGroupIds(n, leafGroupIds);
  // Bucket every sutta by its node in one pass, rather than calling suttasFor() per leaf group.
  // That would be ~440 leaf groups each re-running Object.entries() over all ~4000 suttas and
  // filtering the result — 1.8M pair allocations, and ~550ms of blocked main thread at app boot,
  // since LibraryPage calls this during its first render.
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

// The path from nikaya down to (and including) a sutta's own leaf group — e.g. "Saṁyutta
// Nikāya > The Group on Feeling > SN36.1–11" — for a location breadcrumb above the reader's
// title. Every entry navigates the same way regardless of depth — to the sutta's own enclosing
// leaf group, with the sutta itself highlighted/scrolled-to there (see ReaderPage's breadcrumb
// onClick) — rather than to that particular entry's own (possibly non-leaf) node, since a
// breadcrumb segment further up the chain has no suttas of its own to land on.
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

// A node "has children to expand" (nikaya rows only ever toggle open/closed, never
// navigate directly) exactly when it carries a `chapters` array — DN/MN don't, so
// clicking them goes straight to their flat sutta list; SN/AN/KN do.
export function isExpandable(node: { chapters?: unknown }): boolean {
  return Array.isArray(node.chapters) && node.chapters.length > 0;
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

export interface SearchHit {
  id: string;
  sutta: Sutta;
  // Set only when the match came from the range-query fallback below (e.g. searching "dhp325"
  // against the "dhp320-333" batch) — the specific inner sutta id a caller should actually open
  // (via resolveCanonicalSuttaId, which resolves back to `id` for the fetch/lookup) instead of
  // `id` itself, so the reader can scroll to/mark that inner sutta rather than just opening the
  // batch at its top. Unset for a plain title/blurb/note match — the source dataset has no
  // per-inner-sutta blurb to attribute a text match to a specific one.
  matchedId?: string;
}

// A short/common query (a single letter, "the") can realistically match hundreds of suttas — every
// searchCorpus consumer (TreePane's own search, ListPane, ReaderSearchOverlay) renders hits as
// unvirtualized DOM rows in a scroll panel, so each caps how many it actually renders to this (same
// AUTO_LIST_CAP pattern as worker/src/lib/userData.js's auto-lists) — searchCorpus itself still
// returns every match so a caller can show an accurate total count.
export const SEARCH_RESULTS_CAP = 80;

// What both search inputs (TreePane's and ReaderSearchOverlay's) offer to match on. Named here,
// beside searchCorpus itself, so the promise and the fields it actually scans can't drift apart —
// note that the sutta *text* is not among them.
export const SEARCH_PLACEHOLDER = 'Search ID, title, blurb, note, list';

// Case- and diacritic-insensitive comparison key — Pali romanization leans heavily on combining
// marks (ā, ī, ū, ñ, ṭ, ḍ, ṇ, ḷ, ṁ, …) that most people don't bother typing, so a search for
// plain "a"/"n" should still match "ā"/"ñ". NFD splits each accented letter into its base letter
// plus a separate combining-mark codepoint (all of which fall in the U+0300–U+036F "combining
// diacritical marks" block), which stripping then discards — cheaper and more general than
// hand-listing every Pali special character.
function searchKey(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// Each sutta's normalized (searchKey'd) "static" haystack — everything except the user's own
// note, which can change independently — cached per Corpus object. searchCorpus runs on every
// keystroke in TreePane's own search, ListPane, and the reader's search overlay; without this, it
// would re-run NFD-normalize + diacritic-strip + lowercase over all ~4000 suttas' ref/title/
// Pali/blurb text on every single keystroke. corpus.json is fetched once and never mutated after
// load, so a WeakMap keyed on the Corpus reference is safe for the app's lifetime. Kept as two
// separate strings, not one joined haystack, so a hit can be ranked by *where* it matched (see
// searchCorpus's `rank`) without re-deriving that from the combined string.
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

// A batched leaf uid (e.g. "dhp320-333", covering Dhp verses 320 through 333 in one document —
// see build-corpus.mjs) has no entry of its own for any individual number inside that range, so
// a query for one of them (e.g. "dhp325") wouldn't otherwise match anything. Mirrors
// scripts/lib/collections.js's suttaNumRange: `prefix` is everything up to the trailing
// `start-end` (including a dotted chapter number, e.g. "sn35." or "an1."), so it lines up with
// how a query for a number in that range would itself be typed ("sn35.181", "an1.5").
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

// A batched leaf uid has no `corpus.suttas` entry of its own for any individual sutta inside it
// (see the doc comment above RANGE_UID) — so a route/deep-link id like "dhp321" (the batch
// dhp320-333's own 4th verse) doesn't resolve directly. This finds the enclosing batch's id the
// same way searchCorpus's own range-query fallback below already does, so `/read/dhp321` and a
// search hit for "dhp321" both land on the right document. Identity for a real id (including one
// that's coincidentally range-uid-shaped but already has its own entry — checked first) or an id
// that matches no range at all (so a genuinely invalid id still resolves to itself and 404s, same
// as today).
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

// Every leaf ('list'-kind) list nested under `groupId`, recursing through any nested groups —
// used to expand a group-name match into the suttas its member lists actually hold, since a
// group's own `items` is always empty (see worker/src/lib/userData.js's schema notes).
function listDescendants(lists: ListDef[], groupId: string): ListDef[] {
  const children = lists.filter((l) => l.parentId === groupId);
  return children.flatMap((c) => (c.kind === 'group' ? listDescendants(lists, c.id) : [c]));
}

// Suttas reachable by matching the query against a list/group's own name, searched at any depth
// (not just top-level lists/groups) via flattenListTree's full "Group / List" breadcrumb —
// collapsed to a bare "group/list" for matching so the breadcrumb's " / " spacing isn't required
// (a query like "group/list" or just "list" both match). A group match expands to every sutta in
// every list nested under it.
function matchingListItemIds(lists: ListDef[], q: string): Set<string> {
  const ids = new Set<string>();
  for (const { list, breadcrumb } of flattenListTree(lists)) {
    const pathKey = searchKey(breadcrumb).replace(/\s*\/\s*/g, '/');
    if (!pathKey.includes(q)) continue;
    for (const l of list.kind === 'group' ? listDescendants(lists, list.id) : [list]) {
      for (const itemId of l.items) ids.add(itemId);
    }
  }
  return ids;
}

// Ranks a ref/title/Pali match above a blurb/note/list-name-only match (e.g. searching "mind"
// should surface a sutta titled "The Mind" before one that merely mentions "mind" in its blurb or
// is filed in a list named "Mind") — ties (same rank) keep the corpus's own build order, since
// `Array.prototype.sort` is a stable sort in every engine this app targets.
export function searchCorpus(corpus: Corpus, query: string, notes: Record<string, string>, lists: ListDef[] = []): SearchHit[] {
  const q = searchKey(query.trim());
  if (!q) return [];
  const staticHaystacks = staticHaystacksFor(corpus);
  const rangeQuery = q.match(RANGE_QUERY);
  const ranges = rangeQuery ? rangesFor(corpus) : null;
  const listMatchIds = matchingListItemIds(lists, q);
  const hits: Array<SearchHit & { rank: number }> = [];
  for (const [id, s] of suttaEntries(corpus)) {
    const { title, blurb } = staticHaystacks.get(id)!;
    const note = notes[id];
    let inTitle = title.includes(q);
    const inRest = blurb.includes(q) || (!!note && searchKey(note).includes(q)) || listMatchIds.has(id);
    let matchedId: string | undefined;
    // Checked unconditionally (not just when `!inTitle`) — a batch's own ref text is always
    // exactly `${prefix}${start}` with no separator (e.g. "Dhp209–220"), so a query for a batch's
    // very first inner uid ("dhp209") already satisfies `inTitle` via that literal substring,
    // same as any other ref/title match. Gating this on `!inTitle` would then skip setting
    // matchedId for that one case (every other inner uid doesn't literally appear in the ref, so
    // only reaches matchedId through this branch), silently losing the sub-uid and opening the
    // batch at its top instead of scrolling/highlighting the actually-requested first sutta.
    if (rangeQuery) {
      const range = ranges!.get(id);
      const num = Number(rangeQuery[2]);
      if (range && range.prefix === rangeQuery[1] && num >= range.start && num <= range.end) {
        inTitle = true;
        matchedId = `${rangeQuery[1]}${rangeQuery[2]}`;
      }
    }
    if (!inTitle && !inRest) continue;
    hits.push({ id, sutta: s, matchedId, rank: inTitle ? 0 : 1 });
  }
  hits.sort((a, b) => a.rank - b.rank);
  return hits;
}

// The exact list of rows ListPane renders while browsing (not searching — see LibraryPage, which
// computes search hits itself and hands them to both TreePane and ListPane so they show one
// consistent result set instead of each re-running searchCorpus independently).
export function listItemsFor(corpus: Corpus, nodeId: string | undefined, lists: ListDef[]): Array<[string, Sutta]> {
  if (!nodeId) return [];
  const list = lists.find((l) => String(l.id) === nodeId);
  if (list) {
    // Stored order (user-arranged, see reorderListItems), not id order — a list is the one
    // place in the corpus tree where the user's own sequencing wins over natural sutta order.
    return list.items
      .map((id) => (corpus.suttas[id] ? ([id, corpus.suttas[id]] as [string, Sutta]) : null))
      .filter((x): x is [string, Sutta] => x !== null);
  }
  return sortByIdAsc(suttasFor(corpus, nodeId));
}
