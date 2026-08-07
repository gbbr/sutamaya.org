import { describe, expect, it } from 'vitest';
import { ancestorsOf, compareIds, searchCorpus, sortByIdAsc } from './corpus';
import type { Corpus, Sutta } from './types';

// Only the fields compareIds/sortByIdAsc actually touch (the id key) matter here; the rest
// of Sutta is irrelevant filler to satisfy the type.
const stub = (id: string): Sutta => ({ ref: id, node: 'x', en: id, pali: id, blurb: '', min: 1 });

describe('compareIds', () => {
  it('sorts a double-digit chapter after a single-digit one numerically, not lexically', () => {
    expect(compareIds('mn9', 'mn10')).toBeLessThan(0);
  });

  it('sorts a double-digit sutta number after a single-digit one within the same chapter', () => {
    expect(compareIds('an1.2', 'an1.10')).toBeLessThan(0);
  });

  it('treats equal ids as equal', () => {
    expect(compareIds('sn22.11', 'sn22.11')).toBe(0);
  });

  it('falls back to lexical comparison for non-numeric runs', () => {
    expect(compareIds('dn1', 'mn1')).toBeLessThan(0);
  });

  it('sorts an id that is a strict prefix of another before the longer one', () => {
    // Tokenizes to ['an', '1'] vs ['an', '1', '.', '1'] — the shorter array's missing
    // trailing token falls back to '' via the `ta[i] ?? ''` guard.
    expect(compareIds('an1', 'an1.1')).toBeLessThan(0);
    expect(compareIds('an1.1', 'an1')).toBeGreaterThan(0);
  });
});

describe('sortByIdAsc', () => {
  it('sorts entries by numeric-aware id order without mutating the input array', () => {
    const input: Array<[string, Sutta]> = [
      ['an1.10', stub('an1.10')],
      ['an1.2', stub('an1.2')],
      ['an1.1', stub('an1.1')],
    ];
    const original = [...input];
    expect(sortByIdAsc(input).map(([id]) => id)).toEqual(['an1.1', 'an1.2', 'an1.10']);
    expect(input).toEqual(original);
  });
});

describe('ancestorsOf', () => {
  const corpus: Corpus = {
    nikayas: [
      { id: 'dn', label: 'Long Discourses', sub: '', count: 1 },
      {
        id: 'an',
        label: 'Numbered Discourses',
        sub: '',
        count: 1,
        chapters: [
          {
            id: 'an1',
            ref: 'AN 1',
            label: 'Book of Ones',
            count: 1,
            chapters: [{ id: 'an1-v1', ref: 'AN 1.1–10', label: 'Vagga One', count: 1 }],
          },
        ],
      },
    ],
    suttas: {},
  };

  it('returns every ancestor chapter id up to (not including) the found node', () => {
    expect(ancestorsOf(corpus, 'an1-v1')).toEqual({ an: true, an1: true });
  });

  it('returns an empty object for a nikaya id (no chapter ancestors)', () => {
    expect(ancestorsOf(corpus, 'an')).toEqual({});
  });

  it('returns an empty object when nodeId or corpus is missing', () => {
    expect(ancestorsOf(corpus, undefined)).toEqual({});
    expect(ancestorsOf(null, 'an1-v1')).toEqual({});
  });

  it('returns an empty object for an id not found in the corpus', () => {
    expect(ancestorsOf(corpus, 'sn1')).toEqual({});
  });
});

describe('searchCorpus', () => {
  const corpus: Corpus = {
    nikayas: [],
    suttas: {
      'mn1': { ref: 'MN 1', node: 'x', en: 'The Root of All Things', pali: 'Mūlapariyāyasutta', blurb: 'The Buddha analyzes how the mind relates to experience.', min: 30 },
      'mn10': { ref: 'MN 10', node: 'x', en: 'The Establishment of Mindfulness', pali: 'Satipaṭṭhānasutta', blurb: 'On the four kinds of mindfulness meditation.', min: 20 },
    },
  };

  it('is case- and diacritic-insensitive', () => {
    expect(searchCorpus(corpus, 'MULAPARIYAYA', {}).map((h) => h.id)).toEqual(['mn1']);
  });

  it('ranks a ref/title/Pali match above a blurb-only match', () => {
    // "mindfulness" is in mn10's own title, but only in mn1's blurb ("mind" appears in both,
    // so use a query that's a title match for one and a blurb-only match for the other).
    expect(searchCorpus(corpus, 'mind', {}).map((h) => h.id)).toEqual(['mn10', 'mn1']);
  });

  it('matches the user\'s own note on a sutta even when nothing else does', () => {
    expect(searchCorpus(corpus, 'apple', { mn1: 'tastes like an apple' }).map((h) => h.id)).toEqual(['mn1']);
  });

  it('returns nothing for a blank query', () => {
    expect(searchCorpus(corpus, '   ', {})).toEqual([]);
  });
});
