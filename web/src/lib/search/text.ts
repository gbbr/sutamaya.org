// Full-text search over the sutta text — see docs/search.md, which is the spec.
//
// The corpus ships as two line-per-segment blobs, one per language, and a map of sutta offsets;
// there is no index, no stemmer and nothing to keep in step with the build. **The text is the
// index**: a brute-force regular-expression scan of the whole canon costs a few milliseconds, so
// the whole of matching and ranking is done on the keystroke, synchronously, once the blobs are in
// memory.
//
// The query is folded by searchKey and the folding is inverted per character when the expression
// is built, so a typed ASCII letter matches its Pali forms against the **unfolded** text — one copy
// in memory, and exact offsets. English matches whole words with an optional plural; Pali matches
// a prefix, because it inflects at the end.
//
// Text hits extend searchCorpus's bucket ladder rather than replacing it: buckets 0–3 stay the
// metadata behaviour, 4–6 are the text. Nothing here is required for search to work — until the
// blobs arrive, and if they never do, searchCorpus answers alone.
//
// Everything here is a pure function over a TextIndex. The blobs live in a Web Worker
// (lib/search/worker.ts) and lib/search/textClient.ts is what the app talks to; this module holds no
// state and never learns which side of the message boundary it is running on.
import { searchCorpus, searchKey, SEARCH_RESULTS_CAP, SEARCH_SCOPE_NOTE, type SearchHit } from './metadata';
import { expandQuery } from './expansion';
import type { Corpus, HighlightsMap, ListDef } from '../types';

// Opens each paragraph, and each sutta, on a line of its own — see build-corpus.mjs. Being neither
// a letter nor whitespace, it is also what stops a phrase match running across a paragraph.
const PARA_MARK = '\x1e';

// Text rank buckets, continuing searchCorpus's 0–3.
export const RANK_TEXT_PHRASE = 4;
export const RANK_TEXT_PARAGRAPH = 5;
export const RANK_TEXT_ANYWHERE = 6;

// ── Matching ────────────────────────────────────────────────────────────────

// Query characters mapped back to every form the unfolded text spells them with, so a typed "a"
// finds "ā". searchKey has already stripped the diacritics that produced them.
const UNFOLD: Record<string, string> = {
  a: '[aā]',
  i: '[iī]',
  u: '[uū]',
  m: '[mṁṃ]',
  n: '[nñṅṇ]',
  t: '[tṭ]',
  d: '[dḍ]',
  l: '[lḷ]',
  "'": "['‘’]",
};

const RE_ESCAPE = /[.*+?^${}()|[\]\\]/g;

// `\b` is ASCII-only in JavaScript — it reads "ā" as a non-word character, so "nibbāna" would match
// inside "mahānibbāna". These are the boundaries instead, and they need the `u` flag.
const BEFORE = '(?<!\\p{L})';
const AFTER = '(?!\\p{L})';

function charPattern(ch: string): string {
  return UNFOLD[ch] ?? ch.replace(RE_ESCAPE, '\\$&');
}

function bodyPattern(word: string): string {
  return [...word].map(charPattern).join('');
}

// Without it, "four noble truths" misses "the noble truth of…" and the results look broken.
const PLURAL = '(?:s|es)?';

// A typed plural is dropped before the optional one is added back, so the query and the text may
// each be either: "truths" finds "the noble truth of", "truth" finds "the noble truths".
function englishStem(word: string): string {
  return word.length >= 4 && word.endsWith('s') ? word.slice(0, -1) : word;
}

function englishBody(word: string): string {
  return `${bodyPattern(englishStem(word))}${PLURAL}`;
}

function englishWordRe(word: string): RegExp {
  return new RegExp(`${BEFORE}${englishBody(word)}${AFTER}`, 'giu');
}

function englishPhraseRe(words: string[]): RegExp {
  return new RegExp(`${BEFORE}${words.map(englishBody).join('\\s+')}${AFTER}`, 'giu');
}

// English function words, dropped from a query's required words and from its occurrence count.
// "not" and "no" are deliberately absent — they are the whole of "not-self".
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'for', 'from', 'had', 'has',
  'have', 'he', 'her', 'him', 'his', 'i', 'in', 'into', 'is', 'it', 'its', 'me', 'my', 'of', 'on',
  'or', 'our', 'she', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this',
  'those', 'to', 'was', 'we', 'were', 'what', 'when', 'which', 'who', 'whom', 'will', 'with',
  'you', 'your',
]);

// The words of `words` a sutta must carry, and whose occurrences order it — the whole query when
// it holds nothing but function words, so `the` still searches for "the".
function contentWords(words: string[]): string[] {
  const kept = words.filter((w) => !STOPWORDS.has(w));
  return kept.length ? kept : words;
}

// Shortest prefix that may match Pali as a prefix. Below it a query is too broad to be useful —
// "sa" is in 3,770 suttas — so short words match whole instead, which keeps "ko" and "na" working.
const PALI_PREFIX_MIN = 4;

// Readers type English plurals of Pali words. "arahants" matches nothing against *arahanto*, and
// the corpus has no English plural of a Pali noun to protect.
function paliStem(word: string): string {
  return word.length >= 5 && word.endsWith('s') ? word.slice(0, -1) : word;
}

// A long enough stem is a prefix — Pali inflects at the end, so the headword a reader knows opens
// most of its forms; a short one has to match whole.
function paliTail(stem: string): string {
  return stem.length >= PALI_PREFIX_MIN ? '' : AFTER;
}

function paliWordRe(word: string): RegExp {
  const stem = paliStem(word);
  return new RegExp(`${BEFORE}${bodyPattern(stem)}${paliTail(stem)}`, 'giu');
}

function paliPhraseRe(words: string[]): RegExp {
  const stems = words.map(paliStem);
  const tail = paliTail(stems[stems.length - 1]);
  return new RegExp(`${BEFORE}${stems.map(bodyPattern).join('\\s+')}${tail}`, 'giu');
}

// ── The blobs ───────────────────────────────────────────────────────────────

export interface TextIndex {
  // Suttas in canonical order, and where each starts in each blob.
  uids: string[];
  enStarts: number[];
  paStarts: number[];
  en: string;
  pa: string;
  // Every paragraph-opening offset, ascending, per blob.
  enParas: number[];
  paParas: number[];
}

// One entry per sutta: its uid and its offset into each blob.
export type SearchMap = Array<[string, number, number]>;

function paragraphStarts(text: string): number[] {
  const out: number[] = [];
  for (let i = text.indexOf(PARA_MARK); i !== -1; i = text.indexOf(PARA_MARK, i + 1)) out.push(i);
  return out;
}

export function buildTextIndex(en: string, pa: string, map: SearchMap): TextIndex {
  return {
    uids: map.map((m) => m[0]),
    enStarts: map.map((m) => m[1]),
    paStarts: map.map((m) => m[2]),
    en,
    pa,
    enParas: paragraphStarts(en),
    paParas: paragraphStarts(pa),
  };
}

export function searchTextUrls(searchVersion: string): string[] {
  return [
    `/data/search/en.${searchVersion}.txt`,
    `/data/search/pa.${searchVersion}.txt`,
    `/data/search/map.${searchVersion}.json`,
  ];
}

export async function fetchTextIndex(searchVersion: string, signal?: AbortSignal): Promise<TextIndex> {
  const [enUrl, paUrl, mapUrl] = searchTextUrls(searchVersion);
  const get = async (url: string) => {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`Failed to load ${url} (${res.status})`);
    return res;
  };
  const [en, pa, map] = await Promise.all([
    get(enUrl).then((r) => r.text()),
    get(paUrl).then((r) => r.text()),
    get(mapUrl).then((r) => r.json() as Promise<SearchMap>),
  ]);
  return buildTextIndex(en, pa, map);
}

// ── Scanning ────────────────────────────────────────────────────────────────

// The index of the last entry of `starts` at or before `offset` — which sutta, or which paragraph,
// a match fell in.
function slotOf(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= offset) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

function offsetsOf(text: string, re: RegExp): number[] {
  re.lastIndex = 0;
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(m.index);
    if (m[0].length === 0) re.lastIndex += 1;
  }
  return out;
}

interface LangScore {
  bucket: number;
  count: number;
  // The paragraph the snippet is drawn from: the one holding the most of the query's words.
  para: number;
  // Which sutta, as an index into the map — what the snippet counts segments from.
  doc: number;
}

// One language's result per sutta index: the best bucket the query reaches it in, and how often its
// rarest word occurs there — the smallest count, not the sum, so a sutta has to carry every word of
// the query rather than many of its commonest one.
function scoreLanguage(
  text: string,
  suttaStarts: number[],
  paraStarts: number[],
  wordRes: RegExp[],
  phraseRe: RegExp | null
): Map<number, LangScore> {
  const perSutta = new Map<number, { counts: number[]; paras: Array<Set<number> | null> }>();
  wordRes.forEach((re, wi) => {
    for (const off of offsetsOf(text, re)) {
      const si = slotOf(suttaStarts, off);
      let rec = perSutta.get(si);
      if (!rec) {
        rec = { counts: wordRes.map(() => 0), paras: wordRes.map(() => null) };
        perSutta.set(si, rec);
      }
      rec.counts[wi] += 1;
      (rec.paras[wi] ??= new Set()).add(slotOf(paraStarts, off));
    }
  });

  // A one-word query makes the phrase and the word the same scan, so it is not run twice. The
  // earliest paragraph the phrase fell in is the one worth showing.
  const phrasePara = new Map<number, number>();
  if (phraseRe) {
    for (const off of offsetsOf(text, phraseRe)) {
      const si = slotOf(suttaStarts, off);
      if (!phrasePara.has(si)) phrasePara.set(si, slotOf(paraStarts, off));
    }
  }

  const out = new Map<number, LangScore>();
  for (const [si, rec] of perSutta) {
    if (rec.paras.some((p) => p === null)) continue;

    // The paragraph holding the most of the query's distinct words; the earliest of them wins ties,
    // so a one-word query lands on the first occurrence.
    const distinct = new Map<number, number>();
    for (const set of rec.paras as Array<Set<number>>) {
      for (const p of set) distinct.set(p, (distinct.get(p) ?? 0) + 1);
    }
    let para = Infinity;
    let most = -1;
    for (const [p, n] of distinct) {
      if (n > most || (n === most && p < para)) {
        most = n;
        para = p;
      }
    }

    let bucket = most === wordRes.length ? RANK_TEXT_PARAGRAPH : RANK_TEXT_ANYWHERE;
    const phraseAt = phraseRe ? phrasePara.get(si) : para;
    if (phraseAt !== undefined) {
      bucket = RANK_TEXT_PHRASE;
      para = phraseAt;
    }
    out.set(si, { bucket, count: Math.min(...rec.counts), para, doc: si });
  }
  return out;
}

export interface TextScore {
  bucket: number;
  // Occurrences of the query's rarest word in this sutta — the within-bucket order.
  count: number;
  // The paragraph the snippet comes from, counted the same way in both blobs.
  para: number;
  // Which sutta, as an index into the map — what the snippet counts segments from.
  doc: number;
  // Which blob matched there, and so which line the snippet leads with.
  lang: 'en' | 'pa';
  // The query that found it, which may be one the expansion table added rather than what was typed.
  query: string;
}

// Every sutta whose text answers `query`, keyed by uid. English and Pali are scanned and scored
// independently and a sutta keeps its better result: a query is written in one language or the
// other, and mixing a word from each would match noise.
export function searchSuttaText(index: TextIndex, query: string): Map<string, TextScore> {
  const q = searchKey(query.trim());
  const out = new Map<string, TextScore>();
  if (!q) return out;
  const words = q.split(/\s+/);
  const multi = words.length > 1;
  // Function words are dropped from the required words, but not from the phrase: "mind is
  // luminous" is scored on "mind" and "luminous", and still ranks the sutta saying it as typed
  // above them.
  const content = contentWords(words);

  const en = scoreLanguage(
    index.en,
    index.enStarts,
    index.enParas,
    content.map(englishWordRe),
    multi ? englishPhraseRe(words) : null
  );
  const pa = scoreLanguage(
    index.pa,
    index.paStarts,
    index.paParas,
    content.map(paliWordRe),
    multi ? paliPhraseRe(words) : null
  );
  // The corpus writes compounds joined — "mahākassapa", never "mahā kassapa" — so a multi-word
  // query is scanned again as one Pali word, which is the only way that sutta is found at all.
  const joined =
    content.length > 1
      ? scoreLanguage(index.pa, index.paStarts, index.paParas, [paliWordRe(content.join(''))], null)
      : null;

  for (const [si, score] of en) out.set(index.uids[si], { ...score, lang: 'en', query: q });
  for (const pass of joined ? [pa, joined] : [pa]) {
    for (const [si, langScore] of pass) {
      const score = { ...langScore, lang: 'pa' as const, query: q };
      const uid = index.uids[si];
      if (better(score, out.get(uid))) out.set(uid, score);
    }
  }
  return out;
}

// Whether `next` is the better result for a sutta than `prev`: the better bucket, then English,
// then the occurrence count. English wins a tie of buckets because a count in one language says
// nothing about a count in the other, and because the reader is reading the language they typed —
// the Pali is shown only where it is the only thing that answered the query, or answered it better.
function better(next: TextScore, prev: TextScore | undefined): boolean {
  if (!prev) return true;
  if (next.bucket !== prev.bucket) return next.bucket < prev.bucket;
  if (next.lang !== prev.lang) return next.lang === 'en';
  return next.count > prev.count;
}

// ── Snippets ────────────────────────────────────────────────────────────────

// The line a result shows under its title, and the English underneath it when the query was
// answered by the Pali.
export interface Snippet {
  text: string;
  under?: string;
  // The words to mark in the two lines: what the reader typed, and the query that found the row
  // where the expansion table is what found it.
  query: string;
  // The first and last segment this line was drawn from, indexing the array in text/{uid}.json —
  // what the reader opens at, and washes, when the row is clicked.
  segments: [number, number];
}

// How much of a paragraph a snippet shows, and how much of it precedes the matched word. A
// paragraph can run to several hundred words, and the row clamps to three lines: without a window
// the match itself scrolls off the end and the reader is shown a snippet with nothing marked in it.
const SNIPPET_MAX = 220;
const SNIPPET_LEAD = 60;

// One paragraph of a blob, its segments run together as the reader sees them. The newlines become
// spaces rather than being collapsed away, so an offset into `text` is `start` plus that offset in
// the blob — which is what locates the segments to open at.
function paragraphAt(blob: string, paras: number[], p: number): { text: string; start: number } {
  // Past the mark and the newline ending its line, so offset 0 is the paragraph's first character
  // and not the line break above it.
  const start = paras[p] + 2;
  const end = p + 1 < paras.length ? paras[p + 1] : blob.length;
  return { text: blob.slice(start, end).replace(/\n/g, ' '), start };
}

// The index, within its sutta, of the segment holding `offset` — the line it falls on, less the
// paragraph markers above it, each of which occupies a line of its own.
function segmentAt(blob: string, suttaStart: number, paras: number[], para: number, offset: number): number {
  let lines = 0;
  for (let i = blob.indexOf('\n', suttaStart); i !== -1 && i < offset; i = blob.indexOf('\n', i + 1)) lines += 1;
  return Math.max(0, lines - (para - slotOf(paras, suttaStart) + 1));
}

// Where in `text` the snippet should centre: the phrase as typed if it is there, else the rarest
// of the query's content words — never simply the earliest word matched, which would pin every
// snippet to the top of the paragraph. -1 when the query is nowhere in `text`, as happens on the
// English line paired with a Pali hit.
function firstMatch(text: string, query: string, lang: 'en' | 'pa'): number {
  const words = query.split(/\s+/);
  const wordRe = (w: string) => (lang === 'en' ? englishWordRe(w) : paliWordRe(w));

  if (words.length > 1) {
    const phrase = (lang === 'en' ? englishPhraseRe(words) : paliPhraseRe(words)).exec(text);
    if (phrase) return phrase.index;
  }

  let at = -1;
  let rarest = Infinity;
  for (const word of contentWords(words)) {
    const hits = offsetsOf(text, wordRe(word));
    if (hits.length && hits.length < rarest) {
      rarest = hits.length;
      at = hits[0];
    }
  }
  return at;
}

// `text` cut to a window opening one lead before `at`, broken on spaces, marked with an ellipsis at
// each end it trims, and with the runs of space an empty segment leaves squeezed out; `start` and
// `end` are the half-open range of `text` it was cut from, which is what locates the segments it
// spans. A window near the end of a paragraph is shorter than the rest, since the match holds its
// place at the top rather than the snippet holding its length.
function windowAround(text: string, at: number): { text: string; start: number; end: number } {
  const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();
  if (at <= SNIPPET_LEAD && text.length <= SNIPPET_MAX) return { text: tidy(text), start: 0, end: text.length };
  let start = Math.max(0, at - SNIPPET_LEAD);
  if (start > 0) start = text.indexOf(' ', start) + 1 || start;
  let end = Math.min(text.length, start + SNIPPET_MAX);
  if (end < text.length) end = text.lastIndexOf(' ', end) + 1 || end;
  const cut = `${start > 0 ? '…' : ''}${tidy(text.slice(start, end))}${end < text.length ? '…' : ''}`;
  return { text: cut, start, end };
}

// The paragraph a text hit was found in, windowed around the match, with the segments the window
// spans — what the reader opens at and washes, so the passage it lands on is the one the row
// showed. The two blobs hold the same paragraphs in the same order, so a Pali hit can show its
// Pali with that paragraph's English beneath it.
//
// `typed` is the reader's own query, which is not `score.query` where an expansion is what found
// the row: the Pali line is windowed and marked on the query that found it, the English line on
// what was typed.
export function snippetOf(index: TextIndex, score: TextScore, typed: string): Snippet | null {
  const pali = score.lang === 'pa';
  const blob = pali ? index.pa : index.en;
  const paras = pali ? index.paParas : index.enParas;
  const para = paragraphAt(blob, paras, score.para);
  if (!para.text.trim()) return null;
  const query = score.query === typed ? typed : `${typed} ${score.query}`;

  const at = Math.max(0, firstMatch(para.text, score.query, score.lang));
  const window = windowAround(para.text, at);
  const suttaStart = (pali ? index.paStarts : index.enStarts)[score.doc];
  const segmentOf = (offset: number) => segmentAt(blob, suttaStart, paras, score.para, para.start + offset);
  // `end` is exclusive, so the last segment is the one holding the character before it.
  const segments: [number, number] = [segmentOf(window.start), segmentOf(Math.max(window.start, window.end - 1))];
  const text = window.text;
  if (!pali) return { text, query, segments };

  const english = paragraphAt(index.en, index.enParas, score.para);
  if (!english.text.trim()) return { text, query, segments };
  const enAt = firstMatch(english.text, typed, 'en');
  const under = windowAround(english.text, Math.max(0, enAt >= 0 ? enAt : firstMatch(english.text, score.query, 'en')));
  return { text, under: under.text, query, segments };
}

// ── The whole search ────────────────────────────────────────────────────────

// A sutta's best result across the query and its expansions.
function keepBest(into: Map<string, TextScore>, from: Map<string, TextScore>): void {
  for (const [uid, score] of from) {
    if (better(score, into.get(uid))) into.set(uid, score);
  }
}

// A query and every query the expansion table adds for it.
function variantsOf(query: string, q: string): string[] {
  return [query, ...expandQuery(q)];
}

// The metadata hits for `query` and its expansions, each sutta keeping its best bucket, ordered as
// searchCorpus orders one query's own hits. Sorted here rather than left to the merge, because this
// is the whole result until the sutta text answers, and where it never does.
export function searchCorpusVariants(
  corpus: Corpus,
  query: string,
  notes: Record<string, string>,
  lists: ListDef[],
  highlights: HighlightsMap
): SearchHit[] {
  const q = searchKey(query.trim());
  if (!q) return [];
  const best = new Map<string, SearchHit>();
  for (const variant of variantsOf(query, q)) {
    for (const hit of searchCorpus(corpus, variant, notes, lists, highlights)) {
      const prev = best.get(hit.id);
      if (!prev || hit.rank < prev.rank) best.set(hit.id, hit);
    }
  }
  return [...best.values()].sort((a, b) => a.rank - b.rank || Number(b.saved) - Number(a.saved));
}

// The text hits for `query` and its expansions, each sutta keeping its best result.
export function searchTextVariants(index: TextIndex, query: string): Map<string, TextScore> {
  const q = searchKey(query.trim());
  const text = new Map<string, TextScore>();
  if (!q) return text;
  for (const variant of variantsOf(query, q)) keepBest(text, searchSuttaText(index, variant));
  return text;
}

// A hit as the merge orders it, with no corpus behind it — everything ranking and rendering need,
// and nothing the worker doesn't hold. `SearchHit` is this plus the sutta itself.
export interface RankedHit {
  id: string;
  rank: number;
  saved: boolean;
  snippet?: Snippet;
}

// Metadata hits and text hits merged into one ordered result, best first. A sutta keeps its best
// bucket across both passes; within a bucket the order is occurrence count in the sutta text, then
// the saved tie-break, then the corpus's build order.
//
// `make` builds the hit for a sutta reached by its text alone, and returns null where the caller
// has no such sutta; `typed` is the folded query, which the snippets are cut and marked on.
export function mergeSearchHits<T extends RankedHit>(
  meta: T[],
  text: Map<string, TextScore>,
  index: TextIndex | null,
  typed: string,
  make: (uid: string, bucket: number) => T | null
): T[] {
  const best = new Map<string, T>();
  for (const hit of meta) best.set(hit.id, hit);

  for (const [uid, score] of text) {
    if (best.has(uid)) continue;
    const hit = make(uid, score.bucket);
    if (hit) best.set(uid, hit);
  }

  const hits = [...best.values()];
  const countOf = (id: string) => text.get(id)?.count ?? 0;
  // Stable, so suttas alike on every key keep the order the map was filled in: the corpus's own.
  hits.sort(
    (a, b) =>
      a.rank - b.rank || countOf(b.id) - countOf(a.id) || Number(b.saved) - Number(a.saved)
  );

  // Snippets for the rows that render, rather than for every hit: a broad query matches thousands
  // of suttas and only the capped head of them is ever drawn.
  if (index) {
    for (const hit of hits.slice(0, SEARCH_RESULTS_CAP)) {
      const score = text.get(hit.id);
      const snippet = score && snippetOf(index, score, typed);
      if (snippet) hit.snippet = snippet;
    }
  }
  return hits;
}

// Returns every sutta matching `query`, best first — the metadata hits searchCorpus finds and the
// suttas whose text matches, merged. The whole search in one call, over an index this thread holds:
// what the tests and the offline evaluation harness run, and what the worker path assembles from
// the three functions above.
export function searchCorpusAndText(
  corpus: Corpus,
  query: string,
  notes: Record<string, string>,
  lists: ListDef[],
  highlights: HighlightsMap,
  index: TextIndex | null
): SearchHit[] {
  const q = searchKey(query.trim());
  if (!q) return [];
  const meta = searchCorpusVariants(corpus, query, notes, lists, highlights);
  const text = index ? searchTextVariants(index, query) : new Map<string, TextScore>();
  return mergeSearchHits(meta, text, index, q, (uid, bucket) => {
    const sutta = corpus.suttas[uid];
    return sutta ? { id: uid, sutta, rank: bucket, saved: false } : null;
  });
}

// ── Doing without ───────────────────────────────────────────────────────────

// 'idle' before anything asked for the text, 'unavailable' where it was asked for and didn't
// arrive — offline, the fetch failed, or the device gave no worker to scan it in. All read the same
// on screen: today's behaviour, labelled honestly. lib/search/textClient.ts owns the transitions.
export type TextSearchStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

// Said in place of the results while the text is on its way and there is nothing to rank without it.
export const SEARCH_TEXT_LOADING_NOTE = 'Searching sutta text…';

// The line in the empty state. Null while the text is loading — that state says its own line — and
// once it is searchable, when there is nothing left to say.
export function searchScopeNote(state: TextSearchStatus): string | null {
  if (state === 'ready' || state === 'loading') return null;
  return SEARCH_SCOPE_NOTE;
}

// The empty state, which carries the same line.
export function searchNoMatches(state: TextSearchStatus): string {
  const note = searchScopeNote(state);
  return note ? `No matches. ${note}` : 'No matches.';
}
