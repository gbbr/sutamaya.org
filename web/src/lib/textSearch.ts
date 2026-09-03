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
import { searchCorpus, searchKey, SEARCH_RESULTS_CAP, SEARCH_SCOPE_NOTE, type SearchHit } from './corpus';
import { expandQuery } from './searchExpansion';
import type { Corpus, HighlightsMap, ListDef } from './types';

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

export function searchTextUrls(dataVersion: string): string[] {
  return [
    `/data/search/en.${dataVersion}.txt`,
    `/data/search/pa.${dataVersion}.txt`,
    `/data/search/map.${dataVersion}.json`,
  ];
}

export async function fetchTextIndex(dataVersion: string, signal?: AbortSignal): Promise<TextIndex> {
  const [enUrl, paUrl, mapUrl] = searchTextUrls(dataVersion);
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
    out.set(si, { bucket, count: Math.min(...rec.counts), para });
  }
  return out;
}

export interface TextScore {
  bucket: number;
  // Occurrences of the query's rarest word in this sutta — the within-bucket order.
  count: number;
  // The paragraph the snippet comes from, counted the same way in both blobs.
  para: number;
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

  const en = scoreLanguage(
    index.en,
    index.enStarts,
    index.enParas,
    words.map(englishWordRe),
    multi ? englishPhraseRe(words) : null
  );
  const pa = scoreLanguage(
    index.pa,
    index.paStarts,
    index.paParas,
    words.map(paliWordRe),
    multi ? paliPhraseRe(words) : null
  );
  // The corpus writes compounds joined — "mahākassapa", never "mahā kassapa" — so a multi-word
  // query is scanned again as one Pali word, which is the only way that sutta is found at all.
  const joined = multi
    ? scoreLanguage(index.pa, index.paStarts, index.paParas, [paliWordRe(words.join(''))], null)
    : null;

  for (const [si, score] of en) out.set(index.uids[si], { ...score, lang: 'en', query: q });
  for (const pass of joined ? [pa, joined] : [pa]) {
    for (const [si, langScore] of pass) {
      const score = { ...langScore, lang: 'pa' as const, query: q };
      const uid = index.uids[si];
      const prev = out.get(uid);
      if (!prev || score.bucket < prev.bucket || (score.bucket === prev.bucket && score.count > prev.count)) {
        out.set(uid, score);
      }
    }
  }
  return out;
}

// ── Snippets ────────────────────────────────────────────────────────────────

// The line a result shows under its title, and the English underneath it when the query was
// answered by the Pali.
export interface Snippet {
  text: string;
  under?: string;
}

// How much of a paragraph a snippet shows, and how much of it precedes the matched word. A
// paragraph can run to several hundred words, and the row clamps to three lines: without a window
// the match itself scrolls off the end and the reader is shown a snippet with nothing marked in it.
const SNIPPET_MAX = 220;
const SNIPPET_LEAD = 60;

// One paragraph of a blob, its segments run together as the reader sees them.
function paragraphAt(blob: string, paras: number[], p: number): string {
  const end = p + 1 < paras.length ? paras[p + 1] : blob.length;
  return blob.slice(paras[p] + 1, end).replace(/\n/g, ' ');
}

// Where in `text` the snippet should centre: the phrase as typed if it is there, else the query's
// rarest word — never simply the earliest word, because "the" and "of" are in every opening line
// and would pin every snippet to the top of the paragraph. 0 when nothing is found, as happens on
// the English line paired with a Pali hit.
function firstMatch(text: string, query: string, lang: 'en' | 'pa'): number {
  const words = query.split(/\s+/);
  const wordRe = (w: string) => (lang === 'en' ? englishWordRe(w) : paliWordRe(w));

  if (words.length > 1) {
    const phrase = (lang === 'en' ? englishPhraseRe(words) : paliPhraseRe(words)).exec(text);
    if (phrase) return phrase.index;
  }

  let at = 0;
  let rarest = Infinity;
  for (const word of words) {
    const hits = offsetsOf(text, wordRe(word));
    if (hits.length && hits.length < rarest) {
      rarest = hits.length;
      at = hits[0];
    }
  }
  return at;
}

// `text` cut to a window around `at`, broken on spaces, marked with an ellipsis at each end it
// trims, and with the runs of space an empty segment leaves squeezed out.
function windowAround(text: string, at: number): string {
  const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();
  if (text.length <= SNIPPET_MAX) return tidy(text);
  let start = Math.max(0, Math.min(at - SNIPPET_LEAD, text.length - SNIPPET_MAX));
  if (start > 0) start = text.indexOf(' ', start) + 1 || start;
  let end = Math.min(text.length, start + SNIPPET_MAX);
  if (end < text.length) end = text.lastIndexOf(' ', end) + 1 || end;
  return `${start > 0 ? '…' : ''}${tidy(text.slice(start, end))}${end < text.length ? '…' : ''}`;
}

// The paragraph a text hit was found in, windowed around the match. The two blobs hold the same
// paragraphs in the same order, so a Pali hit can show its Pali with that paragraph's English
// beneath it.
export function snippetOf(index: TextIndex, score: TextScore): Snippet | null {
  const pali = score.lang === 'pa';
  const para = paragraphAt(pali ? index.pa : index.en, pali ? index.paParas : index.enParas, score.para);
  if (!para.trim()) return null;

  const text = windowAround(para, firstMatch(para, score.query, score.lang));
  if (!pali) return { text };

  const english = paragraphAt(index.en, index.enParas, score.para);
  if (!english.trim()) return { text };
  return { text, under: windowAround(english, firstMatch(english, score.query, 'en')) };
}

// ── The whole search ────────────────────────────────────────────────────────

// A sutta's best result across the query and its expansions.
function keepBest(into: Map<string, TextScore>, from: Map<string, TextScore>): void {
  for (const [uid, score] of from) {
    const prev = into.get(uid);
    if (!prev || score.bucket < prev.bucket || (score.bucket === prev.bucket && score.count > prev.count)) {
      into.set(uid, score);
    }
  }
}

// Returns every sutta matching `query`, best first — the metadata hits searchCorpus finds, the
// suttas whose text matches, and both again for each query the expansion table adds. A sutta keeps
// its best bucket across all of them; within a bucket the order is occurrence count in the sutta
// text, then the saved tie-break, then the corpus's build order.
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
  const queries = [query, ...expandQuery(q)];

  const best = new Map<string, SearchHit>();
  const text = new Map<string, TextScore>();
  for (const variant of queries) {
    for (const hit of searchCorpus(corpus, variant, notes, lists, highlights)) {
      const prev = best.get(hit.id);
      if (!prev || hit.rank < prev.rank) best.set(hit.id, hit);
    }
    if (index) keepBest(text, searchSuttaText(index, variant));
  }

  for (const [uid, score] of text) {
    const prev = best.get(uid);
    if (prev) continue;
    const sutta = corpus.suttas[uid];
    if (!sutta) continue;
    best.set(uid, { id: uid, sutta, rank: score.bucket, saved: false });
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
      const snippet = score && snippetOf(index, score);
      if (snippet) hit.snippet = snippet;
    }
  }
  return hits;
}

// ── Loading, and doing without ──────────────────────────────────────────────

// 'idle' before anything asked for the text, 'unavailable' where it was asked for and didn't
// arrive — offline, or the fetch failed. Both read the same on screen: today's behaviour, labelled
// honestly.
export type TextSearchStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

let status: TextSearchStatus = 'idle';
let loaded: TextIndex | null = null;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

// Recreated only when something changed, so useSyncExternalStore doesn't re-render on every read.
let snapshot: { status: TextSearchStatus; index: TextIndex | null } = { status, index: loaded };

function publish(next: TextSearchStatus, index: TextIndex | null): void {
  status = next;
  loaded = index;
  snapshot = { status: next, index };
  for (const fn of listeners) fn();
}

export function subscribeTextSearch(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function textSearchSnapshot(): { status: TextSearchStatus; index: TextIndex | null } {
  return snapshot;
}

// Starts the one fetch of the search text, if it hasn't been started. Called when a search field is
// focused, and again on the first keystroke — never on app start, since this is ~1.7 MB compressed
// that a reader who doesn't search should not pay for.
export function beginTextSearchLoad(corpus: Corpus | null): void {
  if (!corpus || inFlight || status === 'ready') return;
  publish('loading', null);
  inFlight = fetchTextIndex(corpus.dataVersion)
    .then((index) => publish('ready', index))
    // Cleared on failure, so the next search tries again: a reader who searched offline gets the
    // sutta text as soon as they are back, rather than at the next app start.
    .catch(() => {
      inFlight = null;
      publish('unavailable', null);
    });
}

// Forgets the loaded text, back to the state before anything asked for it. The next search fetches
// again, and gets it from Cache Storage rather than the network.
export function resetTextSearch(): void {
  inFlight = null;
  publish('idle', null);
}

// Drops the text once the app has been out of sight for `IDLE_RELEASE_MS`. It is ~34 MB of strings,
// which is worth holding while the reader is searching and not worth holding while they are
// elsewhere — an idle tab carrying it is a bigger target for iOS to discard outright, and that
// costs a whole reload rather than the re-read this costs.
const IDLE_RELEASE_MS = 60_000;
let releaseTimer: ReturnType<typeof setTimeout> | undefined;

// Starts releasing the text when the page is hidden, and stops if it comes back first.
export function watchTextSearchIdle(): () => void {
  const onChange = () => {
    clearTimeout(releaseTimer);
    if (document.visibilityState === 'hidden' && status === 'ready') {
      releaseTimer = setTimeout(resetTextSearch, IDLE_RELEASE_MS);
    }
  };
  document.addEventListener('visibilitychange', onChange);
  return () => {
    clearTimeout(releaseTimer);
    document.removeEventListener('visibilitychange', onChange);
  };
}

// Said while the text is on its way, in the place the scope note otherwise sits.
export const SEARCH_TEXT_LOADING_NOTE = 'Searching sutta text…';

// The line under the results. Null once the text is searchable — there is nothing left to say.
export function searchScopeNote(state: TextSearchStatus): string | null {
  if (state === 'ready') return null;
  if (state === 'loading') return SEARCH_TEXT_LOADING_NOTE;
  return SEARCH_SCOPE_NOTE;
}

// The empty state, which carries the same line.
export function searchNoMatches(state: TextSearchStatus): string {
  const note = searchScopeNote(state);
  return note ? `No matches. ${note}` : 'No matches.';
}
