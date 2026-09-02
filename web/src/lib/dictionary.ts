import type { Dictionary } from './types';

const PUNCT = /[.,;:""''"'?!­‘’“”…()]/g;

// Strips the punctuation off a tapped Pali token, for lookup and for the dock's headword alike.
// Not dashes, which WORD_BOUNDARY below handles at the splitting level instead.
export function stripPunct(raw: string): string {
  return raw.replace(PUNCT, '');
}

export function lookupWord(dict: Dictionary, raw: string): string[] | null {
  const word = stripPunct(raw);
  return dict[word] || dict[word.toLowerCase()] || null;
}

// What separates two Pali words: whitespace, or a dash, which this dataset uses to join separate
// words with no space around it ("Todeyya-kappā" is two words). Exported so SegmentedText's own
// render-time split agrees on the word indices this file produces.
export const WORD_BOUNDARY = /(\s+|—|-)/;

// True for a token WORD_BOUNDARY split out rather than a word.
export function isWordBoundary(token: string): boolean {
  return token.trim() === '' || token === '—' || token === '-';
}

// A segment's Pali words in order, matching the tappable spans SegmentedText renders, so an index
// here is the `wordIndex` a tap reports.
export function splitPaliWords(pali: string): string[] {
  return pali.split(WORD_BOUNDARY).filter((t) => !isWordBoundary(t));
}

export interface AdjacentWord {
  segIndex: number;
  wordIndex: number;
  word: string;
}

// The next Pali word in `dir` from a given position, crossing into the adjacent segment — skipping
// any with no Pali — once the current one runs out. `segWords` is each segment's words in document
// order; null once the walk passes either end of the sutta.
export function findAdjacentWord(segWords: string[][], fromSegIndex: number, fromWordIndex: number, dir: 1 | -1): AdjacentWord | null {
  let si = fromSegIndex;
  let wi = fromWordIndex + dir;
  while (si >= 0 && si < segWords.length) {
    const words = segWords[si];
    if (wi >= 0 && wi < words.length) {
      return { segIndex: si, wordIndex: wi, word: words[wi] };
    }
    si += dir;
    wi = dir === 1 ? 0 : (segWords[si]?.length ?? 1) - 1;
  }
  return null;
}
