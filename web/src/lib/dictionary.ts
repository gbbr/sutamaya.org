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
