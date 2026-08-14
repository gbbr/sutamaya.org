import type { Dictionary } from './types';

const PUNCT = /[.,;:""''"'?!­‘’“”…()]/g;

// Also used by ReaderPage to build the DictionaryDock's display headword, and when stepping to
// an adjacent word (see splitPaliWords below) — one definition of "punctuation to strip off a
// tapped Pali token" shared by both lookup and display. Does NOT include "—"/"-" (dashes) — see
// WORD_BOUNDARY below for why those are handled at the word-splitting level instead.
export function stripPunct(raw: string): string {
  return raw.replace(PUNCT, '');
}

export function lookupWord(dict: Dictionary, raw: string): string[] | null {
  const word = stripPunct(raw);
  return dict[word] || dict[word.toLowerCase()] || null;
}

// A run of whitespace, or a single "—" (em dash) or "-" (hyphen) — all act as word boundaries in
// this dataset's Pali text. SuttaCentral uses these to join what are, for dictionary-lookup
// purposes, separate words with *no* surrounding space (e.g. "samudānetabbā—cīvarapiṇḍapātasenā
// sanagilānappaccayabhesajjaparikkhārā—te" — MN17 and ~400 other suttas — is three words, not one
// run-on compound; "Todeyya-kappā" is two).
// Exported (along with isWordBoundary below) so SegmentedText's own render-time split — which
// needs to keep the dash *visible* in the text, unlike this function — can't drift out of sync on
// what counts as a word; its word index has to line up with this function's for goToAdjacentWord.
export const WORD_BOUNDARY = /(\s+|—|-)/;

export function isWordBoundary(token: string): boolean {
  return token.trim() === '' || token === '—' || token === '-';
}

// A segment's Pali word tokens in order, matching what SegmentedText renders as individual
// clickable `.pw` spans — so a word's index here lines up with the `wordIndex` ReaderPage's
// onWordClick receives from it.
export function splitPaliWords(pali: string): string[] {
  return pali.split(WORD_BOUNDARY).filter((t) => !isWordBoundary(t));
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
