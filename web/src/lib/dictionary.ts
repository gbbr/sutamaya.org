import type { Dictionary } from './types';

const PUNCT = /[.,;:""''"'?!—­‘’“”]/g;

export function lookupWord(dict: Dictionary, raw: string): string[] | null {
  const word = raw.replace(PUNCT, '');
  return dict[word] || dict[word.toLowerCase()] || null;
}
