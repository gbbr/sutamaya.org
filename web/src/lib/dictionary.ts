import type { Dictionary } from './types';

const PUNCT = /[.,;:""''"'?!—­‘’“”]/g;

// Also used by ReaderPage to build the DictionaryDock's display headword, and when stepping to
// an adjacent word (see splitPaliWords below) — one definition of "punctuation to strip off a
// tapped Pali token" shared by both lookup and display.
export function stripPunct(raw: string): string {
  return raw.replace(PUNCT, '');
}

export function lookupWord(dict: Dictionary, raw: string): string[] | null {
  const word = stripPunct(raw);
  return dict[word] || dict[word.toLowerCase()] || null;
}

// A segment's Pali word tokens in order, matching what SegmentedText renders as individual
// clickable `.pw` spans (it splits on `/(\s+)/` to keep whitespace for layout, then skips the
// blank entries — same token order, just without the whitespace) — so a word's index here lines
// up with the `wordIndex` ReaderPage's onWordClick receives from it.
export function splitPaliWords(pali: string): string[] {
  return pali.split(/\s+/).filter(Boolean);
}

export interface AdjacentWord {
  segIndex: number;
  wordIndex: number;
  word: string;
}

// Walks from (fromSegIndex, fromWordIndex) to the next Pali token in `dir`, crossing into the
// next/previous segment (skipping any with no Pali tokens at all) once the current one runs out
// — used by ReaderPage's goToAdjacentWord (DictionaryDock's prev/next arrows, and the reader's
// Shift+Arrow shortcut with the dock open). Pure: `segWords` is each segment's own token list, in
// the same order as the sutta itself — no DOM/state involved, so this is the part worth
// unit-testing directly rather than only through the component. Returns null once `dir` walks
// past either end of the sutta with nothing found.
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
