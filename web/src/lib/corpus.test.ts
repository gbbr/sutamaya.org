import { describe, expect, it } from 'vitest';
import { compareIds, sortByIdAsc } from './corpus';
import type { Sutta } from './types';

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
