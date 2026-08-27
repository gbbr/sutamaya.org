import type { Dictionary } from './types';

const PUNCT = /[.,;:""''"'?!­‘’“”…()]/g;

// One definition of "punctuation to strip off a tapped Pali token", shared by lookup and by
// ReaderPage's display headword. Dashes are not included: WORD_BOUNDARY below handles those at the
// word-splitting level instead.
export function stripPunct(raw: string): string {
  return raw.replace(PUNCT, '');
}

export function lookupWord(dict: Dictionary, raw: string): string[] | null {
  const word = stripPunct(raw);
  return dict[word] || dict[word.toLowerCase()] || null;
}

// A run of whitespace, or a single em dash or hyphen — all word boundaries in this dataset's Pali,
// where SuttaCentral joins separate words with no surrounding space ("Todeyya-kappā" is two words,
// not one compound). Exported alongside isWordBoundary so SegmentedText's render-time split, which
// keeps the dash visible, agrees on what counts as a word: its word index has to line up with this
// one for goToAdjacentWord.
export const WORD_BOUNDARY = /(\s+|—|-)/;

export function isWordBoundary(token: string): boolean {
  return token.trim() === '' || token === '—' || token === '-';
}

// A segment's Pali word tokens in order, matching the clickable `.pw` spans SegmentedText renders,
// so a word's index here is the `wordIndex` ReaderPage's onWordClick receives.
export function splitPaliWords(pali: string): string[] {
  return pali.split(WORD_BOUNDARY).filter((t) => !isWordBoundary(t));
}

export interface AdjacentWord {
  segIndex: number;
  wordIndex: number;
  word: string;
}

// Walks from (fromSegIndex, fromWordIndex) to the next Pali token in `dir`, crossing into the
// adjacent segment — skipping any with no Pali tokens — once the current one runs out. Drives
// useDictionaryLookup's goToAdjacentWord: the dock's prev/next arrows and the reader's Left/Right
// shortcut. `segWords` is each segment's token list in document order. Returns null once `dir`
// walks past either end of the sutta.
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
