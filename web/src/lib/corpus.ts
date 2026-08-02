import type { Corpus, Dictionary, ListDef, Sutta } from './types';

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

// Every browsable id: nikaya ids, chapter ids, and (for search) sutta ids.
export function findNode(corpus: Corpus, id: string) {
  for (const n of corpus.nikayas) {
    if (n.id === id) return { kind: 'nikaya' as const, node: n };
    const c = n.chapters?.find((c) => c.id === id);
    if (c) return { kind: 'chapter' as const, node: c, parent: n };
  }
  return null;
}

export function nodeLabel(corpus: Corpus, id: string, lists: ListDef[]): string {
  const found = findNode(corpus, id);
  if (found) return found.node.label;
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

export function searchCorpus(corpus: Corpus, query: string, notes: Record<string, string>): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (const [id, s] of suttaEntries(corpus)) {
    const note = (notes[id] || '').toLowerCase();
    const haystack = [s.ref, s.en, s.pali, s.blurb, note].join(' ').toLowerCase();
    if (haystack.includes(q)) hits.push({ id, sutta: s });
  }
  return hits;
}
