import { searchKey } from './corpus';

// One stretch of a rendered string, marked as matched or not — matchRuns' output, painted by
// components/MatchedText.
export interface TextRun {
  text: string;
  hit: boolean;
}

// The same fold searchCorpus matches on (corpus.ts's searchKey), done one character at a time so
// each character of the folded key remembers where it came from in the original: `map[i]` is the
// original index the folded character `i` starts at, with a final entry for the end of the string.
// Highlighting needs that because folding changes length — "ā" decomposes to two codepoints and
// then loses one, so a match found at folded offset 4 is rarely at offset 4 in the text on screen.
// Folding character by character matches the whole-string version because NFD decomposition and
// lowercasing are per-character for everything this corpus contains; searchMatch.test.ts asserts
// the two agree, so a change to searchKey can't silently drift from this.
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

// Splits `text` into runs, marking every occurrence of every word in `query` — the words
// separately and anywhere, exactly as searchCorpus matched them, so what's marked is the reason
// the row is on screen. Returns a single unmarked run when there's nothing to mark (no query, or
// this particular field holds none of the words — a hit can match on its blurb while its title
// shows nothing).
export function matchRuns(text: string, query: string): TextRun[] {
  const words = searchKey(query.trim()).split(/\s+/).filter(Boolean);
  if (!text || !words.length) return [{ text, hit: false }];
  const { key, map } = fold(text);
  const found: Array<[number, number]> = [];
  for (const w of words) {
    for (let i = key.indexOf(w); i !== -1; i = key.indexOf(w, i + w.length)) found.push([i, i + w.length]);
  }
  if (!found.length) return [{ text, hit: false }];
  // Two words can overlap in the text ("mind" and "mindful" both matching "mindfulness") or sit
  // flush against each other; either way that's one mark, not two abutting ones with a seam.
  found.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of found) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
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
