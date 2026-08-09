import { describe, expect, it } from 'vitest';
import { findAdjacentWord } from './dictionary';

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
