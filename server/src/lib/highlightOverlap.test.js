import { describe, expect, it } from 'vitest';
import { rangesOverlap } from './highlightOverlap.js';

describe('rangesOverlap', () => {
  it('is true for an exact match', () => {
    expect(rangesOverlap({ i: 0, s: 5, e: 10 }, 0, 5, 10)).toBe(true);
  });

  it('is true for a partial overlap on either side', () => {
    expect(rangesOverlap({ i: 0, s: 5, e: 10 }, 0, 8, 15)).toBe(true);
    expect(rangesOverlap({ i: 0, s: 5, e: 10 }, 0, 0, 7)).toBe(true);
  });

  it('is true when one range fully contains the other', () => {
    expect(rangesOverlap({ i: 0, s: 0, e: 20 }, 0, 5, 10)).toBe(true);
  });

  it('is false for ranges that only touch at an edge', () => {
    expect(rangesOverlap({ i: 0, s: 5, e: 10 }, 0, 10, 15)).toBe(false);
    expect(rangesOverlap({ i: 0, s: 5, e: 10 }, 0, 0, 5)).toBe(false);
  });

  it('is false for a different segment even with the same offsets', () => {
    expect(rangesOverlap({ i: 0, s: 5, e: 10 }, 1, 5, 10)).toBe(false);
  });
});
