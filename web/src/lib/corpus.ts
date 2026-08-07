import type { ChapterRow, Corpus, Dictionary, ListDef, Nikaya, Sutta } from './types';

export async function loadCorpus(): Promise<Corpus> {
  const res = await fetch('/data/corpus.json');
  return res.json();
}

// Runs the fetch + ~20MB JSON.parse in a Web Worker (see workers/dictionaryWorker.ts) instead of
// blocking the main thread at app boot.
export function loadDictionary(): Promise<Dictionary> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/dictionaryWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ ok: boolean; dictionary?: Dictionary; error?: string }>) => {
      worker.terminate();
      if (e.data.ok && e.data.dictionary) resolve(e.data.dictionary);
      else reject(new Error(e.data.error || 'dictionary worker failed'));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(event.error instanceof Error ? event.error : new Error('dictionary worker failed'));
    };
    worker.postMessage('load');
  });
}

// SuttaCentral's own structural role for this segment (see scripts/fetch-html-structure.mjs and
// build-corpus.mjs's roleFor()) — omitted for the common "plain prose" case.
export type SegmentRole = 'verse' | 'heading' | 'end' | 'speaker';

export interface SegmentFile {
  key: string;
  pali: string;
  en: string;
  role?: SegmentRole;
  // Only set when role === 'heading' — SuttaCentral's own <h2>/<h3> nesting for this sub-heading
  // (e.g. DN9's internal sections genuinely nest h3s under an h2), preserved so the reader can
  // render real <h2>/<h3> elements instead of collapsing them to one visual weight.
  headingLevel?: 2 | 3;
  // Sujato's own translator note for this segment (data/sujato/notes/), if any — may contain
  // inline HTML (`<i>`/`<em>`/`<b>`/`<span>`); cross-reference links have already been stripped
  // to plain text at build time (see build-corpus.mjs's cleanNote()).
  note?: string;
}

const textCache = new Map<string, Promise<SegmentFile[]>>();

export function loadSuttaText(uid: string): Promise<SegmentFile[]> {
  let p = textCache.get(uid);
  if (!p) {
    p = fetch(`/data/text/${encodeURIComponent(uid)}.json`).then((r) => r.json());
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
  const ids: string[] = [];
  for (const groupId of leafGroupIds) {
    for (const [id] of sortByIdAsc(suttasFor(corpus, groupId))) ids.push(id);
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
  // Whether this entry itself holds further sub-categories (`chapters`) rather than suttas
  // directly — i.e. the same test TreeRow uses to decide whether a row expands vs. opens. A
  // breadcrumb navigation needs this to know which pane to land on: an expandable entry has no
  // suttas of its own (`suttasFor` only matches leaf-group nodes), so ListPane would render
  // empty for it on mobile — it should land on the tree pane instead. See ReaderPage's
  // breadcrumb onClick.
  expandable: boolean;
}

// The path from nikaya down to (and including) a sutta's own leaf group — e.g. "Saṁyutta
// Nikāya > The Group on Feeling > SN36.1–11" — for a location breadcrumb above the reader's
// title. Each entry is directly browsable via /browse/{id}.
export function breadcrumbFor(corpus: Corpus, nodeId: string): BreadcrumbEntry[] {
  const found = findNode(corpus, nodeId);
  if (!found) return [];
  const chain = found.kind === 'chapter' ? [...found.ancestors, found.node] : [found.node];
  return chain.map((n) => ({ id: n.id, label: n.label, expandable: isExpandable(n) }));
}

export function nodeLabel(corpus: Corpus, id: string, lists: ListDef[]): string {
  const found = findNode(corpus, id);
  if (found) {
    if (found.kind === 'chapter') return `${found.node.ref} · ${found.node.label}`;
    return found.node.label;
  }
  const list = lists.find((l) => String(l.id) === id);
  return list ? list.label : '';
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
}

// A short/common query (a single letter, "the") can realistically match hundreds of suttas — every
// searchCorpus consumer (TreePane's own search, ListPane, ReaderSearchOverlay) renders hits as
// unvirtualized DOM rows in a scroll panel, so each caps how many it actually renders to this (same
// AUTO_LIST_CAP pattern as server/src/routes/data.js's auto-lists) — searchCorpus itself still
// returns every match so a caller can show an accurate total count.
export const SEARCH_RESULTS_CAP = 80;

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

// Ranks a ref/title/Pali match above a blurb-or-note-only match (e.g. searching "mind" should
// surface a sutta titled "The Mind" before one that merely mentions "mind" in its blurb) — ties
// (same rank) keep the corpus's own build order, since `Array.prototype.sort` is a stable sort in
// every engine this app targets.
export function searchCorpus(corpus: Corpus, query: string, notes: Record<string, string>): SearchHit[] {
  const q = searchKey(query.trim());
  if (!q) return [];
  const staticHaystacks = staticHaystacksFor(corpus);
  const hits: Array<SearchHit & { rank: number }> = [];
  for (const [id, s] of suttaEntries(corpus)) {
    const { title, blurb } = staticHaystacks.get(id)!;
    const note = notes[id];
    const inTitle = title.includes(q);
    const inRest = blurb.includes(q) || (!!note && searchKey(note).includes(q));
    if (!inTitle && !inRest) continue;
    hits.push({ id, sutta: s, rank: inTitle ? 0 : 1 });
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
