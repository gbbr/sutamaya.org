import type { ChapterRow, Corpus, Dictionary, ListDef, Membership, Nikaya, Sutta } from './types';

export async function loadCorpus(): Promise<Corpus> {
  const res = await fetch('/data/corpus.json');
  return res.json();
}

export async function loadDictionary(): Promise<Dictionary> {
  const res = await fetch('/data/dictionary.json');
  return res.json();
}

export interface SegmentFile {
  key: string;
  pali: string;
  en: string;
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
}

// The path from nikaya down to (and including) a sutta's own leaf group — e.g. "Saṁyutta
// Nikāya > The Group on Feeling > SN36.1–11" — for a location breadcrumb above the reader/
// preview title. Each entry is directly browsable via /browse/{id}.
export function breadcrumbFor(corpus: Corpus, nodeId: string): BreadcrumbEntry[] {
  const found = findNode(corpus, nodeId);
  if (!found) return [];
  const chain = found.kind === 'chapter' ? [...found.ancestors, found.node] : [found.node];
  return chain.map((n) => ({ id: n.id, label: n.label }));
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

export interface SearchHit {
  id: string;
  sutta: Sutta;
}

// Case- and diacritic-insensitive comparison key — Pali romanization leans heavily on combining
// marks (ā, ī, ū, ñ, ṭ, ḍ, ṇ, ḷ, ṁ, …) that most people don't bother typing, so a search for
// plain "a"/"n" should still match "ā"/"ñ". NFD splits each accented letter into its base letter
// plus a separate combining-mark codepoint (all of which fall in the U+0300–U+036F "combining
// diacritical marks" block), which stripping then discards — cheaper and more general than
// hand-listing every Pali special character.
function searchKey(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function searchCorpus(corpus: Corpus, query: string, notes: Record<string, string>): SearchHit[] {
  const q = searchKey(query.trim());
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (const [id, s] of suttaEntries(corpus)) {
    const note = notes[id] || '';
    const haystack = searchKey([s.ref, s.en, s.pali, s.blurb, note].join(' '));
    if (haystack.includes(q)) hits.push({ id, sutta: s });
  }
  return hits;
}

// The exact list of rows ListPane renders for a given browse/search state, factored out so
// LibraryPage can compute the same ordered list independently for keyboard nav.
export function listItemsFor(
  corpus: Corpus,
  nodeId: string | undefined,
  query: string,
  notes: Record<string, string>,
  lists: ListDef[],
  membership: Membership
): Array<[string, Sutta]> {
  const searching = query.trim().length > 0;
  if (searching) return searchCorpus(corpus, query, notes).map((h) => [h.id, h.sutta] as [string, Sutta]);
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
