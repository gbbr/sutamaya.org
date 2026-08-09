import { describe, expect, it } from 'vitest';
import { findAdjacentWord, splitPaliWords, stripPunct } from './dictionary';

describe('splitPaliWords', () => {
  it('splits on whitespace', () => {
    expect(splitPaliWords('ekaṁ samayaṁ bhagavā')).toEqual(['ekaṁ', 'samayaṁ', 'bhagavā']);
  });

  it('collapses multiple spaces without producing empty entries', () => {
    expect(splitPaliWords('alpha   beta')).toEqual(['alpha', 'beta']);
  });

  // Regression coverage for a real bug: SuttaCentral joins some Pali words with a bare "—" (em
  // dash), no surrounding space — e.g. MN17 (segment mn17:26.6 and ~400 other suttas) has
  // "samudānetabbā—cīvarapiṇḍapātasenāsanagilānappaccayabhesajjaparikkhārā—te", three separate
  // dictionary words. Treating the whole run as one "word" (splitting on whitespace only) meant
  // clicking it looked up the mangled concatenation instead of any real word.
  it('also splits on a bare "—" with no surrounding space, treating it as a word boundary', () => {
    expect(splitPaliWords('samudānetabbā—cīvarapiṇḍapātasenāsanagilānappaccayabhesajjaparikkhārā—te')).toEqual([
      'samudānetabbā',
      'cīvarapiṇḍapātasenāsanagilānappaccayabhesajjaparikkhārā',
      'te',
    ]);
  });

  it('splits on "—" the same way whether or not it has surrounding space', () => {
    expect(splitPaliWords('alpha — beta')).toEqual(['alpha', 'beta']);
    expect(splitPaliWords('alpha—beta')).toEqual(['alpha', 'beta']);
  });

  it('does not produce an empty entry for a trailing "—" at the end of a segment', () => {
    // e.g. "Evaṁ me sutaṁ—" (mn17:1.1) — the dash here trails off into the next segment.
    expect(splitPaliWords('Evaṁ me sutaṁ—')).toEqual(['Evaṁ', 'me', 'sutaṁ']);
  });

  // Regression coverage for the same bug class as "—" above, found by scanning the corpus for
  // other problematic separators: a handful of suttas join two dictionary words with a bare
  // regular hyphen instead of an em dash, e.g. "Todeyya-kappā".
  it('also splits on a bare "-" (regular hyphen), the same as "—"', () => {
    expect(splitPaliWords('Todeyya-kappā')).toEqual(['Todeyya', 'kappā']);
  });
});

describe('stripPunct', () => {
  it('no longer strips "—" or "-" — word-splitting handles them instead (see splitPaliWords)', () => {
    expect(stripPunct('alpha—beta')).toBe('alpha—beta');
    expect(stripPunct('alpha-beta')).toBe('alpha-beta');
  });

  it('still strips ordinary edge punctuation', () => {
    expect(stripPunct('flood?”')).toBe('flood');
  });

  // Regression coverage for the same bug class as "—", found by scanning the corpus for other
  // problematic separators: an ellipsis or parentheses left attached to a word also broke lookup.
  it('strips a trailing ellipsis', () => {
    expect(stripPunct('Rūpasaññāya…')).toBe('Rūpasaññāya');
  });

  it('strips wrapping parentheses', () => {
    expect(stripPunct('(iti')).toBe('iti');
    expect(stripPunct('bhagavā)')).toBe('bhagavā');
  });
});

describe('findAdjacentWord', () => {
  it('steps to the next word within the same segment', () => {
    const segWords = [['alpha', 'beta', 'gamma']];
    expect(findAdjacentWord(segWords, 0, 0, 1)).toEqual({ segIndex: 0, wordIndex: 1, word: 'beta' });
  });

  it('steps to the previous word within the same segment', () => {
    const segWords = [['alpha', 'beta', 'gamma']];
    expect(findAdjacentWord(segWords, 0, 2, -1)).toEqual({ segIndex: 0, wordIndex: 1, word: 'beta' });
  });

  it('crosses forward into the next segment once the current one runs out', () => {
    const segWords = [['alpha', 'beta'], ['gamma', 'delta']];
    expect(findAdjacentWord(segWords, 0, 1, 1)).toEqual({ segIndex: 1, wordIndex: 0, word: 'gamma' });
  });

  it('crosses backward into the previous segment, landing on its last word', () => {
    const segWords = [['alpha', 'beta'], ['gamma', 'delta']];
    expect(findAdjacentWord(segWords, 1, 0, -1)).toEqual({ segIndex: 0, wordIndex: 1, word: 'beta' });
  });

  it('skips over a segment with no Pali tokens at all when crossing forward', () => {
    const segWords = [['alpha'], [], ['gamma']];
    expect(findAdjacentWord(segWords, 0, 0, 1)).toEqual({ segIndex: 2, wordIndex: 0, word: 'gamma' });
  });

  it('skips over a segment with no Pali tokens at all when crossing backward', () => {
    const segWords = [['alpha'], [], ['gamma']];
    expect(findAdjacentWord(segWords, 2, 0, -1)).toEqual({ segIndex: 0, wordIndex: 0, word: 'alpha' });
  });

  it('skips over several consecutive empty segments', () => {
    const segWords = [['alpha'], [], [], [], ['omega']];
    expect(findAdjacentWord(segWords, 0, 0, 1)).toEqual({ segIndex: 4, wordIndex: 0, word: 'omega' });
  });

  it('returns null when walking forward past the last word of the last segment', () => {
    const segWords = [['alpha', 'beta']];
    expect(findAdjacentWord(segWords, 0, 1, 1)).toBeNull();
  });

  it('returns null when walking backward past the first word of the first segment', () => {
    const segWords = [['alpha', 'beta']];
    expect(findAdjacentWord(segWords, 0, 0, -1)).toBeNull();
  });

  it('returns null when every remaining segment (in the walked direction) is empty', () => {
    const segWords = [['alpha'], [], []];
    expect(findAdjacentWord(segWords, 0, 0, 1)).toBeNull();
  });

  it('returns null for an empty segWords array', () => {
    expect(findAdjacentWord([], 0, 0, 1)).toBeNull();
  });
});
