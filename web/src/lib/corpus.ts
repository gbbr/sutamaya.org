// The corpus: loading corpus.json and per-sutta text, walking the browse tree, and folding the ids
// that arrive from a URL. Searching it is lib/search/.
//
// The dictionary is not loaded here: it is fetched one range shard at a time by the tap that needs
// it (lib/dictionaryShards.ts).
import type { ChapterRow, Corpus, ListDef, Nikaya, Sutta } from './types';

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

interface UidRange {
  prefix: string;
  start: number;
  end: number;
}

// A batched leaf uid ("dhp320-333") and a query naming one sutta inside such a range ("dhp325").
// `prefix` is everything before the trailing numbers, dotted chapter included ("sn35.", "an1."),
// mirroring scripts/lib/collections.js's suttaNumRange.
const RANGE_UID = /^([a-z][a-z-]*(?:\d+\.)?)(\d+)-(\d+)$/;
export const RANGE_QUERY = /^([a-z][a-z-]*(?:\d+\.)?)(\d+)$/;

function parseRangeUid(id: string): UidRange | null {
  const m = id.match(RANGE_UID);
  if (!m) return null;
  return { prefix: m[1], start: Number(m[2]), end: Number(m[3]) };
}

const rangeCache = new WeakMap<Corpus, Map<string, UidRange>>();

export function rangesFor(corpus: Corpus): Map<string, UidRange> {
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
