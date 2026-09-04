import { searchKey } from './metadata';

// Marking a search query's words inside the text a result displays.

// One stretch of a rendered string, matched or not, painted by components/MatchedText.
export interface TextRun {
  text: string;
  hit: boolean;
}

// The same fold search matches on (searchKey), one character at a time so the result can be mapped
// back: `map[i]` is the original index the folded character `i` starts at, with a final entry for
// the end of the string. Folding changes length, so marking needs it. match.test.ts asserts
// this agrees with the whole-string fold, so searchKey can't drift from it unnoticed.
function fold(s: string): { key: string; map: number[] } {
  let key = '';
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    for (const c of searchKey(s[i])) {
      key += c;
      map.push(i);
    }
  }
  map.push(s.length);
  return { key, map };
}

// The forms of a query word to mark: the word, and the singular of a typed plural, which is the
// stemming lib/search/text.ts matched on — "truths" finds "the noble truth of", and the row has to
// show the reader why it is there.
function forms(word: string): string[] {
  return word.length >= 4 && word.endsWith('s') ? [word, word.slice(0, -1)] : [word];
}

// Splits `text` into runs, marking every occurrence of every word in `query`, separately and
// anywhere, as search matched them. One unmarked run where there is nothing to mark — no query, or
// a field holding none of the words, a hit being able to match on its blurb alone.
export function matchRuns(text: string, query: string): TextRun[] {
  const words = searchKey(query.trim()).split(/\s+/).filter(Boolean);
  if (!text || !words.length) return [{ text, hit: false }];
  const { key, map } = fold(text);
  const found: Array<[number, number]> = [];
  for (const w of words.flatMap(forms)) {
    for (let i = key.indexOf(w); i !== -1; i = key.indexOf(w, i + w.length)) found.push([i, i + w.length]);
  }
  if (!found.length) return [{ text, hit: false }];
  // Overlapping matches, abutting ones, and ones separated only by the space between two words all
  // merge into a single mark: a phrase the text carries whole is marked whole, rather than as one
  // mark per word with unmarked gaps punched through it.
  found.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of found) {
    const last = merged[merged.length - 1];
    const onlySpaceBetween = last && start > last[1] && !key.slice(last[1], start).trim();
    if (last && (start <= last[1] || onlySpaceBetween)) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  const runs: TextRun[] = [];
  let at = 0;
  for (const [start, end] of merged) {
    if (start > at) runs.push({ text: text.slice(map[at], map[start]), hit: false });
    runs.push({ text: text.slice(map[start], map[end]), hit: true });
    at = end;
  }
  if (at < key.length) runs.push({ text: text.slice(map[at]), hit: false });
  return runs;
}
